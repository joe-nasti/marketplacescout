// Targeted Mana Pool depth for printings with executable CK buylist demand.
// Public /products/singles supplies exact variant quantity. When buyer API
// credentials exist, the optimizer + listing detail endpoints add threshold
// offer count/copies at or below the CK cash bid.
import {beginRun,finishRun,now,observation,qty,rest,upsert} from './vendor-depth-lib.mjs';

const BASE=(process.env.MANAPOOL_API_BASE_URL||'https://manapool.com/api/v1').replace(/\/$/,'');
const EMAIL=process.env.MANAPOOL_API_EMAIL||'';
const TOKEN=process.env.MANAPOOL_API_TOKEN||'';
const LIMIT=Math.max(1,Math.min(1000,Number(process.env.MANAPOOL_DEPTH_TARGET_LIMIT||200)));
const REQUEST_CAP=Math.max(1,Math.min(5000,Number(process.env.MANAPOOL_DEPTH_REQUEST_CAP||999)));
const observedAt=now();
const headers={Accept:'application/json','Content-Type':'application/json',...(EMAIL&&TOKEN?{'X-ManaPool-Email':EMAIL,'X-ManaPool-Access-Token':TOKEN}:{})};
const finishMap={nonfoil:'NF',foil:'FO',etched:'EF'};

async function mp(path,options={}){
  const response=await fetch(`${BASE}${path}`,{...options,headers:{...headers,...options.headers}});
  const raw=await response.text();
  if(!response.ok){
    const error=new Error(`Mana Pool ${response.status}: ${raw.slice(0,500)}`);
    error.status=response.status;
    try{error.payload=JSON.parse(raw)}catch{error.payload=null}
    throw error;
  }
  if((response.headers.get('content-type')||'').includes('ndjson')){
    const lines=raw.trim().split('\n').filter(Boolean);return JSON.parse(lines.at(-1));
  }
  return raw?JSON.parse(raw):null;
}

async function targets(){
  const demand=await rest(`vendor_depth_current?select=source_item_key,price,quantity,finish&source=eq.cardkingdom&lane=eq.buylist_demand&is_executable=eq.true&order=price.desc&limit=${LIMIT}`)||[];
  if(!demand.length)return [];
  const keys=demand.map(x=>`"${String(x.source_item_key).replaceAll('"','')}"`).join(',');
  const identities=await rest(`vendor_item_identities?select=source_item_key,mtgjson_uuid,scryfall_id,card_name,set_code,collector_number&source=eq.cardkingdom&source_item_key=in.(${encodeURIComponent(keys)})`)||[];
  const byKey=new Map(identities.map(x=>[x.source_item_key,x]));
  return demand.map(x=>({...x,...byKey.get(x.source_item_key)})).filter(x=>x.mtgjson_uuid);
}

async function publicVariants(targetsList){
  const out=[];
  for(let i=0;i<targetsList.length;i+=100){
    const params=new URLSearchParams();
    for(const target of targetsList.slice(i,i+100))params.append('mtgjson_uuids',target.mtgjson_uuid);
    const doc=await mp(`/products/singles?${params}`);
    out.push(...(doc.data||[]).map(card=>({...card,source_as_of:doc.meta?.as_of})));
  }
  return out;
}

async function thresholdDepth(target,variant){
  if(!EMAIL||!TOKEN)return null;
  const finish=finishMap[String(target.finish).toLowerCase()]||'NF';
  const requested=Math.max(1,Math.min(REQUEST_CAP,qty(target.quantity)||REQUEST_CAP));
  const request={cart:[{quantity_requested:requested,type:'mtg_single',mtgjson_id:target.mtgjson_uuid,name:target.card_name,
    language_ids:['EN'],finish_ids:[finish],condition_ids:[variant.condition_id]}],model:'lowest_price',destination_country:'US'};
  let optimized;
  try{optimized=await mp('/buyer/optimizer',{method:'POST',body:JSON.stringify(request)})}
  catch(error){
    const available=qty(error?.payload?.details?.[0]?.total_available);
    if(error?.status!==409||!available)throw error;
    request.cart[0].quantity_requested=Math.min(requested,available);
    optimized=await mp('/buyer/optimizer',{method:'POST',body:JSON.stringify(request)});
  }
  const selected=new Map((optimized.cart||[]).map(x=>[x.inventory_id,Number(x.quantity_selected||0)]));
  if(!selected.size)return {listing_count:0,quantity:0,quality:'optimizer_derived',selected_total:0};
  const params=new URLSearchParams();for(const id of selected.keys())params.append('id',id);
  const details=(await mp(`/inventory/listings?${params}`)).inventory_items||[];
  const thresholdCents=Math.round(Number(target.price)*100);
  const eligible=details.filter(x=>Number(x.price_cents)<=thresholdCents);
  const quantity=eligible.reduce((n,x)=>n+Math.min(Number(x.quantity||0),selected.get(x.id)||0),0);
  const selectedTotal=[...selected.values()].reduce((a,b)=>a+b,0);
  return {listing_count:eligible.length,quantity,quality:selectedTotal>=requested?'capped':'optimizer_derived',selected_total:selectedTotal,
    requested,
    inventory_ids:eligible.map(x=>x.id)};
}

const run=await beginRun('manapool',`${BASE}/products/singles`,observedAt,{target_strategy:'active_cardkingdom_buylist',target_limit:LIMIT,threshold_probe:Boolean(EMAIL&&TOKEN)});
try{
  const targetRows=await targets();const targetByUuid=new Map(targetRows.map(x=>[x.mtgjson_uuid,x]));
  const cards=await publicVariants(targetRows);const identities=[];const observations=[];
  for(const card of cards){
    const target=targetByUuid.get(card.card_id);if(!target)continue;
    for(const variant of card.variants||[]){
      if(variant.language_id!=='EN')continue;
      const f=variant.finish_id==='FO'?'foil':variant.finish_id==='EF'?'etched':'nonfoil';
      if(f!==String(target.finish).toLowerCase())continue;
      const item=String(variant.product_id);
      identities.push({source:'manapool',source_item_key:item,source_product_id:item,mtgjson_uuid:card.card_id,scryfall_id:card.scryfall_id||null,
        tcgplayer_product_id:card.tcgplayer_product_id==null?null:String(card.tcgplayer_product_id),tcgplayer_sku_id:variant.tcgplayer_sku_id==null?null:String(variant.tcgplayer_sku_id),
        card_name:card.name,set_code:card.set_code,collector_number:card.number,finish:f,language:variant.language_id,product_url:card.url,
        first_seen_at:observedAt,last_seen_at:observedAt,source_updated_at:observedAt,identity_detail:{condition:variant.condition_id}});
      const price=Number(variant.low_price||0)/100,quantity=qty(variant.available_quantity);
      observations.push(observation({source:'manapool',observation_key:`${item}:retail_supply:${variant.condition_id}`,source_item_key:item,
        lane:'retail_supply',condition:variant.condition_id,finish:f,language:variant.language_id,price,quantity,listing_count:null,threshold_price:null,
        measurement_scope:'exact_printing_finish_condition_language_total_stock',count_quality:'aggregate',is_executable:Boolean(price>0&&quantity>0),
        source_as_of:card.source_as_of||null,source_as_of_raw:card.source_as_of||null,observed_at:observedAt,first_seen_at:observedAt,last_changed_at:observedAt,run_id:run.id,
        detail:{quantity_field:'variants.available_quantity',price_field:'variants.low_price'}}));
      if(price>0&&quantity>0){
        const depth=await thresholdDepth(target,variant);
        if(depth)observations.push(observation({source:'manapool',observation_key:`${item}:threshold_supply:${Math.round(Number(target.price)*100)}`,source_item_key:item,
          lane:'threshold_supply',condition:variant.condition_id,finish:f,language:variant.language_id,price:null,quantity:depth.quantity,listing_count:depth.listing_count,
          threshold_price:Number(target.price),measurement_scope:'optimizer_selected_offers_at_or_below_cardkingdom_buylist',count_quality:depth.quality,
          is_executable:depth.quantity>0,source_as_of:card.source_as_of||null,source_as_of_raw:card.source_as_of||null,observed_at:observedAt,
          first_seen_at:observedAt,last_changed_at:observedAt,run_id:run.id,detail:{request_cap:REQUEST_CAP,requested:depth.requested,selected_total:depth.selected_total,
            threshold_source:'cardkingdom_buylist',inventory_ids:depth.inventory_ids}}));
      }
    }
  }
  await upsert('vendor_item_identities',identities,'source,source_item_key');
  await upsert('vendor_depth_current',observations,'source,observation_key');
  await finishRun(run.id,{status:'complete',row_count:cards.length,detail:{targets:targetRows.length,cards:cards.length,observations:observations.length,
    threshold_probe:Boolean(EMAIL&&TOKEN),threshold_scope:'optimizer-derived; not claimed as exhaustive public order book'}});
  console.log(JSON.stringify({ok:true,targets:targetRows.length,cards:cards.length,observations:observations.length,thresholdProbe:Boolean(EMAIL&&TOKEN)}));
}catch(error){
  await finishRun(run.id,{status:'failed',detail:{error:String(error?.stack||error)}}).catch(()=>null);
  throw error;
}
