import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const BASE=(Deno.env.get('MANAPOOL_API_BASE_URL')||'https://manapool.com/api/v1').replace(/\/$/,'');
const EMAIL=Deno.env.get('MANAPOOL_API_EMAIL')||'';
const TOKEN=Deno.env.get('MANAPOOL_API_TOKEN')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const js=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const txt=(v:any)=>String(v??'').trim();
const num=(v:any)=>{const n=Number(v);return Number.isFinite(n)?n:null};
const qty=(v:any)=>{const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.trunc(n)):null};
const sh=()=>({apikey:S,Authorization:`Bearer ${S}`,'Content-Type':'application/json'});
async function authorized(req:Request){const h=req.headers.get('authorization')||'',t=h.replace(/^Bearer\s+/i,'');if(!t)return false;if(t===S)return true;const r=await fetch(`${U}/auth/v1/user`,{headers:{apikey:S,Authorization:`Bearer ${t}`}});return r.ok}

async function rest(path:string,o:any={}){
  const r=await fetch(`${U}/rest/v1/${path}`,{method:o.method||'GET',headers:{...sh(),...(o.prefer?{Prefer:o.prefer}:{})},body:o.body===undefined?undefined:JSON.stringify(o.body)});
  const raw=await r.text();let d:any=null;try{d=raw?JSON.parse(raw):null}catch{d=raw}
  if(!r.ok)throw Error(d?.message||`REST ${r.status}: ${raw.slice(0,300)}`);return d;
}
const mh=()=>({Accept:'application/json','Content-Type':'application/json',...(EMAIL&&TOKEN?{'X-ManaPool-Email':EMAIL,'X-ManaPool-Access-Token':TOKEN}:{})});
async function mp(path:string,o:any={}){
  let last:any;
  for(let a=0;a<5;a++){
    const r=await fetch(`${BASE}${path}`,{...o,headers:{...mh(),...(o.headers||{})}});const raw=await r.text();
    if(r.ok){
      if((r.headers.get('content-type')||'').includes('ndjson')){const lines=raw.trim().split('\n').filter(Boolean);return lines.length?JSON.parse(lines.at(-1)!):null}
      return raw?JSON.parse(raw):null;
    }
    last=new Error(`ManaPool ${r.status}: ${raw.slice(0,300)}`);last.status=r.status;try{last.payload=JSON.parse(raw)}catch{}
    if(r.status!==429)throw last;
    await new Promise(x=>setTimeout(x,Math.min(8000,800*(2**a))));
  }
  throw last;
}

async function ckThreshold(mtgjsonUuid:string,finish:string){
  const identities=await rest(`vendor_item_identities?source=eq.cardkingdom&mtgjson_uuid=eq.${encodeURIComponent(mtgjsonUuid)}&finish=eq.${encodeURIComponent(finish)}&select=source_item_key&limit=20`).catch(()=>[]);
  let best=0;
  for(const identity of identities||[]){
    const key=encodeURIComponent(txt(identity.source_item_key));
    const rows=await rest(`vendor_depth_current?source=eq.cardkingdom&lane=eq.buylist_demand&source_item_key=eq.${key}&finish=eq.${encodeURIComponent(finish)}&select=price,quantity,observed_at&order=observed_at.desc&limit=1`).catch(()=>[]);
    best=Math.max(best,Number(rows?.[0]?.price||0));
  }
  return best||null;
}

async function thresholdDepth(card:any,variant:any,threshold:number,requestCap:number){
  if(!EMAIL||!TOKEN||!(threshold>0))return null;
  const requested=Math.max(1,Math.min(requestCap,qty(variant.available_quantity)||requestCap));
  const request:any={cart:[{quantity_requested:requested,type:'mtg_single',mtgjson_id:card.card_id,name:card.name,language_ids:[variant.language_id||'EN'],finish_ids:[variant.finish_id||'NF'],condition_ids:[variant.condition_id]}],model:'lowest_price',destination_country:'US'};
  let optimized:any;
  try{optimized=await mp('/buyer/optimizer',{method:'POST',body:JSON.stringify(request)})}
  catch(error:any){
    const available=qty(error?.payload?.details?.[0]?.total_available);
    if(error?.status!==409||!available)throw error;
    request.cart[0].quantity_requested=Math.min(requested,available);
    optimized=await mp('/buyer/optimizer',{method:'POST',body:JSON.stringify(request)});
  }
  const selected=new Map((optimized?.cart||[]).map((x:any)=>[txt(x.inventory_id),Number(x.quantity_selected||0)]));
  if(!selected.size)return {listing_count:0,quantity:0,count_quality:'optimizer_derived',requested,selected_total:0,inventory_ids:[]};
  const p=new URLSearchParams();for(const id of selected.keys())p.append('id',id);
  const details=(await mp(`/inventory/listings?${p}`))?.inventory_items||[];
  const cents=Math.round(threshold*100);
  const eligible=details.filter((x:any)=>Number(x.price_cents)<=cents);
  const quantity=eligible.reduce((n:number,x:any)=>n+Math.min(Number(x.quantity||0),selected.get(txt(x.id))||0),0);
  const selectedTotal=[...selected.values()].reduce((a:number,b:any)=>a+Number(b||0),0);
  return {listing_count:eligible.length,quantity,count_quality:selectedTotal>=requested?'capped':'optimizer_derived',requested,selected_total:selectedTotal,inventory_ids:eligible.map((x:any)=>x.id)};
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return js({error:'POST required'},405);
  if(!S)return js({error:'Service role unavailable'},500);
  if(!(await authorized(req)))return js({error:'Signed-in user required'},401);
  const body=await req.json().catch(()=>({}));
  const productId=txt(body?.product_id||body?.productId),skuId=txt(body?.sku_id||body?.skuId);
  if(!/^\d+$/.test(productId)||!/^\d+$/.test(skuId))return js({error:'numeric product_id and sku_id required'},400);

  const exact=(await rest(`scout_card_catalog?product_id=eq.${encodeURIComponent(productId)}&sku_id=eq.${encodeURIComponent(skuId)}&select=product_id,sku_id,card_name,set_code,collector_number,mtgjson_uuid,scryfall_id,condition,language,printing&limit=1`))?.[0];
  const sibling=!exact?.mtgjson_uuid?(await rest(`scout_card_catalog?product_id=eq.${encodeURIComponent(productId)}&mtgjson_uuid=not.is.null&select=product_id,sku_id,card_name,set_code,collector_number,mtgjson_uuid,scryfall_id,condition,language,printing&order=condition.asc&limit=1`).catch(()=>[]))?.[0]:null;
  const known=body?.known_identity||{},knownScryfall=/^[0-9a-f-]{36}$/i.test(txt(known.scryfall_id))?txt(known.scryfall_id):null;
  const canonical=!exact?.mtgjson_uuid&&!sibling?.mtgjson_uuid&&knownScryfall?(await rest(`mtgjson_cards?scryfall_id=eq.${encodeURIComponent(knownScryfall)}&tcgplayer_product_id=eq.${encodeURIComponent(productId)}&language=eq.English&select=uuid,scryfall_id,name,set_code,collector_number,language,finishes,tcgplayer_product_id&limit=2`).catch(()=>[])):[];
  const canonicalRow=canonical.length===1?canonical[0]:null;
  const cat=exact?.mtgjson_uuid?{...exact,identity_resolution:'exact_sku'}:sibling?.mtgjson_uuid?{...sibling,sku_id:skuId,condition:exact?.condition||known.condition||null,identity_resolution:'same_product_printing_sibling'}:canonicalRow?.uuid?{mtgjson_uuid:canonicalRow.uuid,scryfall_id:canonicalRow.scryfall_id,card_name:canonicalRow.name,set_code:canonicalRow.set_code,collector_number:canonicalRow.collector_number,language:canonicalRow.language,printing:known.printing||null,sku_id:skuId,condition:known.condition||exact?.condition||null,identity_resolution:'trusted_scryfall_product'}:null;
  if(!cat?.mtgjson_uuid)return js({error:'Exact SKU, same-product sibling, and trusted Scryfall/product identity did not resolve one mtgjson_uuid',identity_gap:'MISSING_PRINTING_IDENTITY',product_id:productId,sku_id:skuId},404);
  const observedAt=new Date().toISOString();
  const run=(await rest('vendor_depth_runs',{method:'POST',prefer:'return=representation',body:[{source:'manapool',endpoint:`${BASE}/products/singles`,observed_at:observedAt,started_at:observedAt,detail:{target_strategy:'exact_ask_sku_on_demand',product_id:productId,sku_id:skuId,mtgjson_uuid:cat.mtgjson_uuid}}]}))?.[0];

  try{
    const p=new URLSearchParams();p.append('mtgjson_uuids',cat.mtgjson_uuid);
    const doc=await mp(`/products/singles?${p}`);const cards=doc?.data||[];
    const card=cards.find((x:any)=>txt(x.card_id)===txt(cat.mtgjson_uuid))||cards[0];
    if(!card)throw Error('ManaPool returned no exact printing');
    const variant=(card.variants||[]).find((v:any)=>txt(v.tcgplayer_sku_id)===skuId);
    if(!variant)throw Error('ManaPool returned no variant mapped to exact TCGplayer SKU');
    const item=txt(variant.product_id);
    const finish=variant.finish_id==='FO'?'foil':variant.finish_id==='EF'?'etched':'nonfoil';
    const available=qty(variant.available_quantity)||0;
    const price=(num(variant.low_price)||0)/100;
    const requestedThreshold=Number(body?.threshold_price||0);
    const threshold=requestedThreshold>0?requestedThreshold:await ckThreshold(cat.mtgjson_uuid,finish);
    const depth=await thresholdDepth(card,variant,Number(threshold||0),Math.max(1,Math.min(999,Number(body?.request_cap||999)||999))).catch(()=>null);

    const identity={source:'manapool',source_item_key:item,source_product_id:item,source_sku:item,mtgjson_uuid:cat.mtgjson_uuid,scryfall_id:card.scryfall_id||cat.scryfall_id||null,tcgplayer_product_id:productId,tcgplayer_sku_id:skuId,card_name:card.name||cat.card_name,set_code:card.set_code||cat.set_code,collector_number:card.number||cat.collector_number,finish,language:variant.language_id||'EN',product_url:card.url||null,first_seen_at:observedAt,last_seen_at:observedAt,source_updated_at:observedAt,identity_detail:{condition:variant.condition_id,on_demand:true}};
    await rest('vendor_item_identities?on_conflict=source,source_item_key',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:[identity]});

    const rows:any[]=[{source:'manapool',observation_key:`${item}:retail_supply:${variant.condition_id}`,source_item_key:item,lane:'retail_supply',condition:variant.condition_id,finish,language:variant.language_id||'EN',price,quantity:available,listing_count:null,threshold_price:null,measurement_scope:'exact_printing_finish_condition_language_total_stock',count_quality:'aggregate',is_executable:Boolean(price>0&&available>0),source_as_of:doc?.meta?.as_of||null,source_as_of_raw:doc?.meta?.as_of||null,observed_at:observedAt,first_seen_at:observedAt,last_changed_at:observedAt,run_id:run?.id||null,value_hash:`ask:${observedAt}`,detail:{quantity_field:'variants.available_quantity',price_field:'variants.low_price',exact_tcgplayer_sku:true,on_demand:true}}];
    if(depth&&threshold)rows.push({source:'manapool',observation_key:`${item}:threshold_supply:${Math.round(Number(threshold)*100)}`,source_item_key:item,lane:'threshold_supply',condition:variant.condition_id,finish,language:variant.language_id||'EN',price:null,quantity:depth.quantity,listing_count:depth.listing_count,threshold_price:Number(threshold),measurement_scope:'optimizer_selected_offers_at_or_below_threshold',count_quality:depth.count_quality,is_executable:depth.quantity>0,source_as_of:doc?.meta?.as_of||null,source_as_of_raw:doc?.meta?.as_of||null,observed_at:observedAt,first_seen_at:observedAt,last_changed_at:observedAt,run_id:run?.id||null,value_hash:`ask-threshold:${observedAt}`,detail:{threshold_source:requestedThreshold>0?'request':'cardkingdom_buylist',requested:depth.requested,selected_total:depth.selected_total,inventory_ids:depth.inventory_ids,on_demand:true}});
    await rest('vendor_depth_current?on_conflict=source,observation_key',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:rows});

    if(run?.id)await rest(`vendor_depth_runs?id=eq.${encodeURIComponent(run.id)}`,{method:'PATCH',prefer:'return=minimal',body:{status:'complete',completed_at:new Date().toISOString(),row_count:rows.length,detail:{target_strategy:'exact_ask_sku_on_demand',product_id:productId,sku_id:skuId,mtgjson_uuid:cat.mtgjson_uuid,threshold_probe:Boolean(depth),buyer_credentials_available:Boolean(EMAIL&&TOKEN)}}});
    return js({ok:true,identity:{product_id:productId,sku_id:skuId,mtgjson_uuid:cat.mtgjson_uuid,finish,condition:variant.condition_id,resolution:cat.identity_resolution},retail_supply:{quantity:available,low_price:price,listing_count:null,count_quality:'aggregate'},threshold_supply:depth&&threshold?{threshold_price:Number(threshold),quantity:depth.quantity,listing_count:depth.listing_count,count_quality:depth.count_quality}:null,buyer_credentials_available:Boolean(EMAIL&&TOKEN),observed_at:observedAt});
  }catch(error:any){
    if(run?.id)await rest(`vendor_depth_runs?id=eq.${encodeURIComponent(run.id)}`,{method:'PATCH',prefer:'return=minimal',body:{status:'failed',completed_at:new Date().toISOString(),detail:{target_strategy:'exact_ask_sku_on_demand',product_id:productId,sku_id:skuId,error:String(error?.message||error)}}}).catch(()=>null);
    return js({error:String(error?.message||error),product_id:productId,sku_id:skuId},502);
  }
});
