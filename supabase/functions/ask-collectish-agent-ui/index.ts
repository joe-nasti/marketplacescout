import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const token=(req:Request)=>{const h=req.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const headers=(t:string)=>({apikey:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});
async function rpc(t:string,name:string,args:any={}){const r=await fetch(`${U}/rest/v1/rpc/${name}`,{method:'POST',headers:headers(t),body:JSON.stringify(args)});const text=await r.text();let data:any;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok)throw Error(data?.message||`${name} failed (${r.status})`);return data}
const text=(v:any)=>String(v??'').trim();
const lower=(v:any)=>text(v).toLowerCase();
const num=(v:any)=>Number.isFinite(Number(v))?Number(v):null;

function requestedRange(q:string){
  const s=lower(q),now=new Date(),to=now.toISOString();let from:Date|null=null,label='All available';
  const m=s.match(/(?:last|past)?\s*(\d+)\s*(day|week|month|year)s?/);
  if(m){const n=Math.max(1,Number(m[1]));from=new Date(now);const unit=m[2];if(unit==='day')from.setUTCDate(from.getUTCDate()-n);if(unit==='week')from.setUTCDate(from.getUTCDate()-n*7);if(unit==='month')from.setUTCMonth(from.getUTCMonth()-n);if(unit==='year')from.setUTCFullYear(from.getUTCFullYear()-n);label=`Last ${n} ${unit}${n===1?'':'s'}`}
  else if(/\b6m\b|six months|6 months/.test(s)){from=new Date(now);from.setUTCMonth(from.getUTCMonth()-6);label='Last 6 months'}
  else if(/\b3m\b|three months|3 months|quarter/.test(s)){from=new Date(now);from.setUTCMonth(from.getUTCMonth()-3);label='Last 3 months'}
  else if(/\b1y\b|one year|12 months|1 year/.test(s)){from=new Date(now);from.setUTCFullYear(from.getUTCFullYear()-1);label='Last year'}
  return {from:from?.toISOString()||null,to,label};
}
function wantsPrice(q:string){const s=lower(q);return /(?:price|market|direct).*(?:history|graph|chart|trend)|(?:history|graph|chart|trend).*(?:price|market|direct)|\bsince release\b/.test(s)}
function wantsSales(q:string){const s=lower(q);return /(?:sale|sold|velocity).*(?:history|graph|chart|trend|recent)|(?:history|graph|chart|trend).*(?:sale|sold|velocity)/.test(s)}
function dateOf(x:any){for(const k of ['date','day','observed_at','observedAt','captured_at','capturedAt','orderDate','order_date','timestamp','purchaseDate','purchase_date']){const v=x?.[k];if(v&&Number.isFinite(Date.parse(v)))return new Date(v).toISOString()}return null}
function salePrice(x:any){for(const k of ['price','unitPrice','unit_price','pricePerUnit','price_per_unit','marketPrice','market_price','soldPrice','sold_price']){const v=num(x?.[k]);if(v!=null)return v}return null}
function saleQty(x:any){for(const k of ['quantity','qty','units','count']){const v=num(x?.[k]);if(v!=null)return v}return 1}
function filterRange(rows:any[],from:string|null,to:string|null){if(!from&&!to)return rows;const a=from?Date.parse(from):-Infinity,b=to?Date.parse(to):Infinity;return rows.filter(x=>{const d=dateOf(x);if(!d)return true;const t=Date.parse(d);return t>=a&&t<=b})}
function summarizePrices(rows:any[]){const vals=rows.map(x=>num(x?.sku_market_price??x?.market_price??x?.market)).filter((x:any)=>x!=null) as number[];if(!vals.length)return null;const start=vals[0],end=vals[vals.length-1];return {start,end,low:Math.min(...vals),high:Math.max(...vals),change_pct:start?((end-start)/start)*100:null}}
async function priceSurface(t:string,ctx:any,q:string){
  const pid=ctx?.product_id||ctx?.entity?.product_id;if(!pid)return null;
  const d=await rpc(t,'ask_collectish_get_price_history',{p_product_id:String(pid)});let observations=Array.isArray(d?.observations)?d.observations:[];
  const range=requestedRange(q);observations=filterRange(observations,range.from,range.to);
  if(!observations.length)return null;
  return {type:'price_history',domain:'scout',title:'Price history',product_id:String(pid),range,observations,count:observations.length,summary:summarizePrices(observations),freshness:{source:'collectish_history',observed_at:dateOf(observations.at(-1))},actions:[{type:'ask',label:'What caused the move?',prompt:'Explain the important moves in this price history using Collectish evidence.'},{type:'ask',label:'Show sales',prompt:'Show market sales history for this card over the same period.'}]};
}
async function marketSalesSurface(ctx:any,q:string){
  const pid=ctx?.product_id||ctx?.entity?.product_id;if(!pid)return null;
  const range=requestedRange(q);const months=range.from?Math.max(1,(Date.now()-Date.parse(range.from))/(30.44*86400000)):12;const upstreamRange=months<=3?'quarter':'year';
  const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),12000);
  try{
    const r=await fetch(`https://infinite-api.tcgplayer.com/price/history/${encodeURIComponent(String(pid))}/detailed?range=${upstreamRange}`,{signal:ac.signal,headers:{Accept:'application/json'}});
    if(!r.ok)return null;const d=await r.json();const raw=Array.isArray(d?.result)?d.result:[];const flat:any[]=[];
    for(const bucket of raw){
      const nested=Array.isArray(bucket?.sales)?bucket.sales:Array.isArray(bucket?.results)?bucket.results:null;
      if(nested){for(const sale of nested)flat.push({...sale,sku_id:bucket?.skuId??bucket?.sku_id??sale?.sku_id})}
      else flat.push(bucket);
    }
    const normalized=flat.map(x=>({date:dateOf(x),sku_market_price:salePrice(x),quantity:saleQty(x),sku_id:x?.sku_id??x?.skuId??null})).filter(x=>x.sku_market_price!=null);
    const filtered=filterRange(normalized,range.from,range.to).sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));if(!filtered.length)return null;
    const totalUnits=filtered.reduce((n,x)=>n+Number(x.quantity||1),0);
    return {type:'price_history',domain:'market_sales',title:'Market sales history',product_id:String(pid),range,observations:filtered,count:filtered.length,total_units:totalUnits,summary:summarizePrices(filtered),freshness:{source:'tcgplayer',observed_at:new Date().toISOString()},actions:[{type:'ask',label:'Interpret velocity',prompt:'Interpret the market sales velocity and price distribution over this period.'},{type:'ask',label:'Compare price',prompt:'Compare these market sales with the price history over the same period.'}]};
  }catch{return null}finally{clearTimeout(timer)}
}
async function historicalSurfaces(t:string,body:any){const q=text(body?.message||body?.question),ctx=body?.context||{},jobs=[] as Promise<any>[];if(wantsPrice(q))jobs.push(priceSurface(t,ctx,q));if(wantsSales(q))jobs.push(marketSalesSurface(ctx,q));const out=await Promise.all(jobs);return out.filter(Boolean)}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});if(req.method!=='POST')return json({error:'POST required'},405);
  const t=token(req);if(!t)return json({error:'Authentication required'},401);let body:any;try{body=await req.json()}catch{return json({error:'Invalid JSON'},400)}
  const r=await fetch(`${U}/functions/v1/ask-collectish-ui`,{method:'POST',headers:headers(t),body:JSON.stringify(body)});const raw=await r.text();let upstream:any;try{upstream=raw?JSON.parse(raw):{}}catch{return new Response(raw,{status:r.status,headers:{...C,'Content-Type':r.headers.get('content-type')||'text/plain','Cache-Control':'no-store'}})}if(!r.ok)return json(upstream,r.status);
  if(String(body?.action||'chat')!=='chat')return json(upstream,r.status);
  const historical=await historicalSurfaces(t,body).catch(()=>[]);const existing=Array.isArray(upstream?.surfaces)?upstream.surfaces:[];
  const historicalTypes=new Set(historical.map((x:any)=>`${x.type}:${x.domain||''}`));const surfaces=[...historical,...existing.filter((x:any)=>!historicalTypes.has(`${x?.type}:${x?.domain||''}`))].slice(0,6);
  return json({...upstream,surface_schema:'collectish.ask.surface.v4',surfaces,orchestration:{mode:historical.length?'deterministic+agent':'agent',historical_tools:historical.map((x:any)=>x.domain==='market_sales'?'market_sales_history':x.type)}},r.status);
});