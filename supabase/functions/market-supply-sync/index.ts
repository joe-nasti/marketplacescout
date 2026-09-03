import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const js=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const text=(v:any)=>String(v??'').trim();
const sh=()=>({apikey:S,Authorization:`Bearer ${S}`,'Content-Type':'application/json'});
async function rest(path:string,o:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:o.method||'GET',headers:{...sh(),...(o.prefer?{Prefer:o.prefer}:{})},body:o.body===undefined?undefined:JSON.stringify(o.body)});const raw=await r.text();let d:any=null;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}

function money(v:any){const n=Number(v);return Number.isFinite(n)?n:null}
function exactSku(row:any,sku:string){return text(row?.productConditionId||row?.sku)===sku}
function condition(v:any){const s=text(v).toUpperCase();if(s==='NM'||s==='NEAR MINT')return'NEAR MINT';if(s==='LP'||s==='LIGHTLY PLAYED')return'LIGHTLY PLAYED';return s}
function depth(units:number,sellers:number){if(units<=8||sellers<=3)return'VERY_THIN';if(units<=25&&sellers<=10)return'THIN';if(units>=100&&sellers>=20)return'DEEP';return'MODERATE'}

async function fetchProductListings(productId:string,maxPages:number){
  const pageSize=50,listings:any[]=[];let sourceTotal=0,pages=0,coverage='COMPLETE',from=0;
  for(let page=0;page<maxPages;page++){
    const payload={filters:{term:{sellerStatus:'Live',channelId:0},range:{quantity:{gte:1}},exclude:{channelExclusion:0}},context:{shippingCountry:'US',cart:{}},sort:{field:'price+shipping',order:'asc'},from,size:pageSize,aggregations:['listingType','seller-key','condition','language','printing']};
    const r=await fetch(`https://mp-search-api.tcgplayer.com/v1/product/${productId}/listings`,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json','Origin':'https://www.tcgplayer.com','Referer':'https://www.tcgplayer.com/','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'},body:JSON.stringify(payload)});
    const d:any=await r.json().catch(()=>null);if(!r.ok)throw Error(`TCGplayer listings HTTP ${r.status}: ${text(d?.message||d?.errors?.[0]||'request failed')}`);
    const outer=d?.results?.[0]||{},rows=Array.isArray(outer?.results)?outer.results:[];sourceTotal=Number(outer?.totalResults||sourceTotal||0);pages++;listings.push(...rows);from+=rows.length;
    if(rows.length<pageSize||from>=sourceTotal)break;if(page===maxPages-1)coverage='PARTIAL_PAGE_CAP';
  }
  return{listings,sourceTotal,pages,coverage};
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return js({error:'POST required'},405);
  if(!req.headers.get('authorization'))return js({error:'Authentication required'},401);
  if(!S)return js({error:'Service role unavailable'},500);
  const body=await req.json().catch(()=>({}));
  const rawTargets=Array.isArray(body?.targets)?body.targets:[{product_id:body?.product_id||body?.productId,sku_id:body?.sku_id||body?.skuId}];
  const targets=rawTargets.map((x:any)=>({...x,product_id:text(x?.product_id||x?.productId),sku_id:text(x?.sku_id||x?.skuId),condition:condition(x?.condition)})).filter((x:any)=>/^\d+$/.test(x.product_id)&&/^\d+$/.test(x.sku_id));
  if(!targets.length)return js({error:'at least one numeric product_id and sku_id target is required'},400);
  if(targets.length>80)return js({error:'at most 80 exact-SKU targets per request'},400);
  const maxPages=Math.max(1,Math.min(Number(body?.max_pages||40)||40,80)),productIds=[...new Set(targets.map((x:any)=>x.product_id))];
  const fetched=new Map<string,any>(await Promise.all(productIds.map(async productId=>[productId,await fetchProductListings(productId,maxPages)] as [string,any])));
  const skuIds=[...new Set(targets.map((x:any)=>x.sku_id))];
  const shared=await rest('rpc/ask_collectish_public_internal_sku_evidence_v1',{method:'POST',body:{p_sku_ids:skuIds}}).catch(()=>[]),evidence=new Map((shared||[]).map((x:any)=>[text(x?.sku_id),x]));
  const rows:any[]=[],detail:any[]=[];const sum=(xs:any[])=>xs.reduce((n,x)=>n+Math.max(0,Number(x?.quantity||0)||0),0);
  for(const target of targets){
  const productId=target.product_id,skuId=target.sku_id,{listings,sourceTotal,pages,coverage}=fetched.get(productId);
  const catalog=await rest(`scout_card_catalog?product_id=eq.${encodeURIComponent(productId)}&sku_id=eq.${encodeURIComponent(skuId)}&select=product_id,sku_id,card_name,condition,language,printing,set_code&limit=1`).catch(()=>[]);
  const identity={...(catalog?.[0]||{}),...target};
  const exact=listings.filter((x:any)=>exactSku(x,skuId)&&Number(x?.quantity||0)>0);
  const sellers=new Set(exact.map((x:any)=>text(x?.sellerKey||x?.sellerId)).filter(Boolean));
  const direct=exact.filter((x:any)=>x?.directListing===true),nonDirect=exact.filter((x:any)=>x?.directListing!==true);
  const directSellers=new Set(direct.map((x:any)=>text(x?.sellerKey||x?.sellerId)).filter(Boolean));
  const nonDirectSellers=new Set(nonDirect.map((x:any)=>text(x?.sellerKey||x?.sellerId)).filter(Boolean));
  const lowest=exact.map((x:any)=>money(x?.price)).filter((x:any)=>x!=null).sort((a:number,b:number)=>a-b)[0]??null;
  const lowestShip=exact.map((x:any)=>{const p=money(x?.price),s=money(x?.shippingPrice);return p==null?null:p+(s||0)}).filter((x:any)=>x!=null).sort((a:number,b:number)=>a-b)[0]??null;
  const directInventoryObserved=Math.max(0,...exact.map((x:any)=>Number(x?.directInventory||0)||0));
  const e=evidence.get(skuId)||{};
  const row={
    source:'tcgplayer_marketplace',product_id:productId,sku_id:skuId,observed_at:new Date().toISOString(),coverage_state:coverage,
    listing_count:exact.length,seller_count:sellers.size,unit_count:sum(exact),
    direct_listing_count:direct.length,direct_seller_count:directSellers.size,direct_unit_count:sum(direct),
    non_direct_listing_count:nonDirect.length,non_direct_seller_count:nonDirectSellers.size,non_direct_unit_count:sum(nonDirect),
    custom_listing_count:exact.filter((x:any)=>text(x?.listingType).toLowerCase()==='custom').length,
    lowest_price:lowest,lowest_price_with_shipping:lowestShip,source_query_total_results:sourceTotal,pages_fetched:pages,
    source_method:'tcgplayer_site_listings_search',
    metadata:{
      card_name:identity?.card_name||null,set_code:identity?.set_code||null,condition:identity?.condition||null,language:identity?.language||null,printing:identity?.printing||null,
      query_rows_fetched:listings.length,exact_sku_rows:exact.length,site_direct_inventory_observed:directInventoryObserved,
      collectish_direct_available:e?.direct_available??null,collectish_direct_listings:e?.direct_listings??null,
      family_scope:body?.scope||'EXACT_SKU',methodology:'TCGplayer.com listings search; live channel-0 listings; exact productConditionId/SKU; banned/suspended channel exclusions applied.'
    }
  };
  rows.push(row);detail.push({product_id:productId,sku_id:skuId,card_name:identity.card_name||null,set_code:identity.set_code||null,printing:identity.printing||null,condition:identity.condition||null,language:identity.language||null,coverage_state:coverage,listing_count:row.listing_count,unit_count:row.unit_count,seller_count:row.seller_count,direct_listing_count:row.direct_listing_count,direct_unit_count:row.direct_unit_count,non_direct_listing_count:row.non_direct_listing_count,non_direct_unit_count:row.non_direct_unit_count,classification:coverage==='COMPLETE'?depth(row.unit_count,row.seller_count):'UNPROVEN'});
  }
  const inserted=await rest('market_supply_snapshots',{method:'POST',prefer:'return=representation',body:rows});
  if(targets.length===1)return js({ok:true,snapshot:inserted?.[0]||rows[0],identity:detail[0]});
  const combinedRows=[...fetched.values()].flatMap((x:any)=>x.listings).filter((x:any)=>skuIds.includes(text(x?.productConditionId||x?.sku))&&Number(x?.quantity||0)>0);
  const aggregate=(wanted:string|null)=>{const allowed=new Set(targets.filter((x:any)=>!wanted||x.condition===wanted).map((x:any)=>x.sku_id)),xs=combinedRows.filter((x:any)=>allowed.has(text(x?.productConditionId||x?.sku))),sellers=new Set(xs.map((x:any)=>text(x?.sellerKey||x?.sellerId)).filter(Boolean)),direct=xs.filter((x:any)=>x?.directListing===true),nonDirect=xs.filter((x:any)=>x?.directListing!==true);return{sku_count:allowed.size,listing_count:xs.length,unit_count:sum(xs),unique_seller_count:sellers.size,direct_listing_count:direct.length,direct_unit_count:sum(direct),non_direct_listing_count:nonDirect.length,non_direct_unit_count:sum(nonDirect),classification:depth(sum(xs),sellers.size)}};
  const complete=detail.filter(x=>x.coverage_state==='COMPLETE').length,combined=aggregate(null);
  return js({ok:true,scope:'CARD_FAMILY_NM_LP',conditions:['NEAR MINT','LIGHTLY PLAYED'],language:'ENGLISH',observed_at:rows[0]?.observed_at||null,source_method:'tcgplayer_site_listings_search',coverage:{target_sku_count:targets.length,complete_sku_count:complete,product_count:productIds.length,state:complete===targets.length?'COMPLETE':'PARTIAL'},classification:complete===targets.length?combined.classification:'UNPROVEN',combined,nm:aggregate('NEAR MINT'),lp:aggregate('LIGHTLY PLAYED'),exact_skus:detail,note:'Combined unique sellers are deduplicated from listing rows across SKUs. Direct is a subset, never additive. Exact-SKU exceptions remain visible in exact_skus.',snapshots:inserted});
});
