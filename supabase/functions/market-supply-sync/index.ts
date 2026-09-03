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
async function syncManaPool(productId:string,skuId:string){
  try{
    const r=await fetch(`${U}/functions/v1/manapool-supply-sync`,{method:'POST',headers:sh(),body:JSON.stringify({product_id:productId,sku_id:skuId})});
    const raw=await r.text();let d:any=null;try{d=raw?JSON.parse(raw):null}catch{d=raw}
    return r.ok?{ok:true,...(d||{})}:{ok:false,status:r.status,error:text(d?.error||raw).slice(0,300)};
  }catch(error:any){return {ok:false,error:String(error?.message||error).slice(0,300)}}
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return js({error:'POST required'},405);
  if(!req.headers.get('authorization'))return js({error:'Authentication required'},401);
  if(!S)return js({error:'Service role unavailable'},500);
  const body=await req.json().catch(()=>({}));
  const productId=text(body?.product_id||body?.productId),skuId=text(body?.sku_id||body?.skuId);
  if(!/^\d+$/.test(productId)||!/^\d+$/.test(skuId))return js({error:'numeric product_id and sku_id required'},400);

  const catalog=await rest(`scout_card_catalog?product_id=eq.${encodeURIComponent(productId)}&sku_id=eq.${encodeURIComponent(skuId)}&select=product_id,sku_id,card_name,condition,language,printing,set_code&limit=1`).catch(()=>[]);
  const identity=catalog?.[0]||{};
  // ManaPool is deliberately exact-card/on-demand only. Start it beside the
  // TCGplayer pagination so Delvin gets retailer depth without a batch scan.
  const manapoolPromise=syncManaPool(productId,skuId);
  const pageSize=50,maxPages=Math.max(1,Math.min(Number(body?.max_pages||40)||40,80));
  const listings:any[]=[];
  let sourceTotal=0,pages=0,coverage='COMPLETE',from=0;
  for(let page=0;page<maxPages;page++){
    const term:any={sellerStatus:'Live',channelId:0};
    const payload={filters:{term,range:{quantity:{gte:1}},exclude:{channelExclusion:0}},context:{shippingCountry:'US',cart:{}},sort:{field:'price+shipping',order:'asc'},from,size:pageSize,aggregations:['listingType','seller-key','condition','language','printing']};
    const r=await fetch(`https://mp-search-api.tcgplayer.com/v1/product/${productId}/listings`,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json','Origin':'https://www.tcgplayer.com','Referer':'https://www.tcgplayer.com/','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'},body:JSON.stringify(payload)});
    const d:any=await r.json().catch(()=>null);
    if(!r.ok)throw Error(`TCGplayer listings HTTP ${r.status}: ${text(d?.message||d?.errors?.[0]||'request failed')}`);
    const outer=d?.results?.[0]||{},rows=Array.isArray(outer?.results)?outer.results:[];
    sourceTotal=Number(outer?.totalResults||sourceTotal||0);pages++;listings.push(...rows);from+=rows.length;
    if(rows.length<pageSize||from>=sourceTotal)break;
    if(page===maxPages-1)coverage='PARTIAL_PAGE_CAP';
  }

  const exact=listings.filter((x:any)=>exactSku(x,skuId)&&Number(x?.quantity||0)>0);
  const sellers=new Set(exact.map((x:any)=>text(x?.sellerKey||x?.sellerId)).filter(Boolean));
  const direct=exact.filter((x:any)=>x?.directListing===true),nonDirect=exact.filter((x:any)=>x?.directListing!==true);
  const directSellers=new Set(direct.map((x:any)=>text(x?.sellerKey||x?.sellerId)).filter(Boolean));
  const nonDirectSellers=new Set(nonDirect.map((x:any)=>text(x?.sellerKey||x?.sellerId)).filter(Boolean));
  const sum=(rows:any[])=>rows.reduce((n,x)=>n+Math.max(0,Number(x?.quantity||0)||0),0);
  const lowest=exact.map((x:any)=>money(x?.price)).filter((x:any)=>x!=null).sort((a:number,b:number)=>a-b)[0]??null;
  const lowestShip=exact.map((x:any)=>{const p=money(x?.price),s=money(x?.shippingPrice);return p==null?null:p+(s||0)}).filter((x:any)=>x!=null).sort((a:number,b:number)=>a-b)[0]??null;
  const directInventoryObserved=Math.max(0,...exact.map((x:any)=>Number(x?.directInventory||0)||0));
  const shared=await rest('rpc/ask_collectish_public_internal_sku_evidence_v1',{method:'POST',body:{p_sku_ids:[skuId]}}).catch(()=>[]);
  const e=shared?.[0]||{};
  const row={source:'tcgplayer_marketplace',product_id:productId,sku_id:skuId,observed_at:new Date().toISOString(),coverage_state:coverage,listing_count:exact.length,seller_count:sellers.size,unit_count:sum(exact),direct_listing_count:direct.length,direct_seller_count:directSellers.size,direct_unit_count:sum(direct),non_direct_listing_count:nonDirect.length,non_direct_seller_count:nonDirectSellers.size,non_direct_unit_count:sum(nonDirect),custom_listing_count:exact.filter((x:any)=>text(x?.listingType).toLowerCase()==='custom').length,lowest_price:lowest,lowest_price_with_shipping:lowestShip,source_query_total_results:sourceTotal,pages_fetched:pages,source_method:'tcgplayer_site_listings_search',metadata:{card_name:identity?.card_name||null,set_code:identity?.set_code||null,condition:identity?.condition||null,language:identity?.language||null,printing:identity?.printing||null,query_rows_fetched:listings.length,exact_sku_rows:exact.length,site_direct_inventory_observed:directInventoryObserved,collectish_direct_available:e?.direct_available??null,collectish_direct_listings:e?.direct_listings??null,methodology:'TCGplayer.com listings search; live channel-0 listings; exact productConditionId/SKU; banned/suspended channel exclusions applied.'}};
  const inserted=await rest('market_supply_snapshots',{method:'POST',prefer:'return=representation',body:[row]});
  const manapool=await manapoolPromise;
  return js({ok:true,snapshot:inserted?.[0]||row,identity:{product_id:productId,sku_id:skuId,...identity},manapool});
});
