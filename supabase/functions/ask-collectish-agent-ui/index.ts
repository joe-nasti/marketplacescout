import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const token=(req:Request)=>{const h=req.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const headers=(t:string)=>({apikey:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});
async function rpc(t:string,name:string,args:any={}){const r=await fetch(`${U}/rest/v1/rpc/${name}`,{method:'POST',headers:headers(t),body:JSON.stringify(args)});const x=await r.text();let d:any;try{d=x?JSON.parse(x):null}catch{d=x}if(!r.ok)throw Error(d?.message||`${name} failed (${r.status})`);return d}
async function rest(t:string,path:string){const r=await fetch(`${U}/rest/v1/${path}`,{headers:{apikey:A,Authorization:`Bearer ${t}`,Accept:'application/json'}});const x=await r.text();let d:any;try{d=x?JSON.parse(x):null}catch{d=x}if(!r.ok)throw Error(d?.message||`REST failed (${r.status})`);return d}
const text=(v:any)=>String(v??'').trim();
const lower=(v:any)=>text(v).toLowerCase();
const num=(v:any)=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
const norm=(v:any)=>lower(v).replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();

function requestedRange(q:string){
  const s=lower(q),now=new Date(),to=now.toISOString();let from:Date|null=null,label='All available',explicit=false;
  const m=s.match(/(?:last|past)?\s*(\d+)\s*(day|week|month|year)s?/);
  if(m){explicit=true;const n=Math.max(1,Number(m[1]));from=new Date(now);const unit=m[2];if(unit==='day')from.setUTCDate(from.getUTCDate()-n);if(unit==='week')from.setUTCDate(from.getUTCDate()-n*7);if(unit==='month')from.setUTCMonth(from.getUTCMonth()-n);if(unit==='year')from.setUTCFullYear(from.getUTCFullYear()-n);label=`Last ${n} ${unit}${n===1?'':'s'}`}
  else if(/\b6m\b|six months|6 months/.test(s)){explicit=true;from=new Date(now);from.setUTCMonth(from.getUTCMonth()-6);label='Last 6 months'}
  else if(/\b3m\b|three months|3 months|quarter/.test(s)){explicit=true;from=new Date(now);from.setUTCMonth(from.getUTCMonth()-3);label='Last 3 months'}
  else if(/\b1y\b|one year|12 months|1 year/.test(s)){explicit=true;from=new Date(now);from.setUTCFullYear(from.getUTCFullYear()-1);label='Last year'}
  return {from:from?.toISOString()||null,to,label,anchor:null as any,explicit};
}
function releaseQuery(q:string,ctx:any){
  const s=text(q);if(!/\bsince\b/i.test(s))return null;
  if(/\bsince\s+(?:this\s+)?(?:set\s+)?release\b/i.test(s))return text(ctx?.set_name||ctx?.entity?.set_name)||null;
  const m=s.match(/\bsince\s+(.+?)(?:\s+set)?\s+(?:came\s+out|released|release\b)/i);return m?.[1]?.trim()||null;
}
async function releaseAnchoredRange(range:any,q:string,ctx:any){
  const query=releaseQuery(q,ctx);if(!query)return range;
  try{const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),5000);let d:any;try{const r=await fetch('https://api.scryfall.com/sets',{signal:ac.signal,headers:{Accept:'application/json','User-Agent':'collectish-market-research/1.0'}});if(!r.ok)return range;d=await r.json()}finally{clearTimeout(timer)}const needle=norm(query),sets=Array.isArray(d?.data)?d.data:[],best=sets.map((x:any)=>{const n=norm(x?.name);let score=n===needle?100:n.includes(needle)?80:needle.includes(n)?60:needle.split(' ').filter((w:string)=>w.length>2&&n.includes(w)).length;return{x,score}}).sort((a:any,b:any)=>b.score-a.score)[0];if(!best?.x?.released_at||best.score<=0)return range;return {...range,explicit:true,from:new Date(`${best.x.released_at}T00:00:00Z`).toISOString(),label:`Since ${best.x.name} release`,anchor:{type:'set_release',set_name:best.x.name,set_code:best.x.code,release_date:best.x.released_at}}}catch{return range}
}
async function inheritedRange(t:string,q:string,ctx:any,cid:any){
  let range=await releaseAnchoredRange(requestedRange(q),q,ctx);if(range.explicit||!cid)return range;
  try{const rows=await rest(t,`ask_collectish_messages?select=role,content,created_at&conversation_id=eq.${encodeURIComponent(String(cid))}&role=eq.user&order=created_at.desc&limit=8`);let skipped=false;for(const row of rows||[]){const c=text(row?.content);if(!skipped&&c===text(q)){skipped=true;continue}const candidate=await releaseAnchoredRange(requestedRange(c),c,ctx);if(candidate.explicit)return {...candidate,inherited:true}}}catch{}
  return range;
}
function wantsSales(q:string){const s=lower(q);return /(?:sale|sold|velocity).*(?:history|graph|chart|trend|recent)|(?:history|graph|chart|trend).*(?:sale|sold|velocity)|compare.*sales.*price/.test(s)}
function wantsPrice(q:string){const s=lower(q);return /(?:price|market|direct).*(?:history|graph|chart|trend)|(?:history|graph|chart|trend).*(?:price|market|direct)|compare.*sales.*price|\bsince release\b|\bsince .+ (?:came out|released|release)\b/.test(s)}
function dateOf(x:any){for(const k of ['date','day','observed_at','captured_at','bucket_start_date']){const v=x?.[k];if(v&&Number.isFinite(Date.parse(v)))return new Date(v).toISOString()}return null}
function filterRange(rows:any[],range:any){if(!range?.from&&!range?.to)return rows;const a=range.from?Date.parse(range.from):-Infinity,b=range.to?Date.parse(range.to):Infinity;return rows.filter(x=>{const d=dateOf(x);return !d||(Date.parse(d)>=a&&Date.parse(d)<=b)})}
function summarizePrices(rows:any[]){const vals=rows.map(x=>num(x?.sku_market_price??x?.market_price)).filter((x:any)=>x!=null) as number[];if(!vals.length)return null;const start=vals[0],end=vals.at(-1)!;return {start,end,low:Math.min(...vals),high:Math.max(...vals),change_pct:start?((end-start)/start)*100:null}}
function ctxIds(ctx:any){return {pid:text(ctx?.product_id||ctx?.entity?.product_id),sku:text(ctx?.sku_id||ctx?.entity?.sku_id)}}
async function priceSurface(t:string,ctx:any,q:string,cid:any){
  const {pid,sku}=ctxIds(ctx);if(!pid&&!sku)return null;const range=await inheritedRange(t,q,ctx,cid);
  const d=await rpc(t,'ask_collectish_get_sku_price_history',{p_product_id:pid||null,p_sku_id:sku||null});let observations=filterRange(Array.isArray(d?.observations)?d.observations:[],range);if(!observations.length)return null;
  return {type:'price_history',domain:'scout',title:'Price history',product_id:pid||null,sku_id:sku||null,range,observations,count:observations.length,summary:summarizePrices(observations),evidence:{scope:sku?'exact_sku':'product'},freshness:{source:'collectish_history',observed_at:dateOf(observations.at(-1))},actions:[{type:'ask',label:'What caused the move?',prompt:'Explain the important moves in this exact card price history.'},{type:'ask',label:'Show sales',prompt:'Show sales history over the same period.'}]};
}
async function sharedSalesSurface(t:string,ctx:any,q:string,cid:any){
  const {pid,sku}=ctxIds(ctx);if(!sku)return null;const range=await inheritedRange(t,q,ctx,cid),from=range.from?.slice(0,10),to=range.to?.slice(0,10);let path=`marketplace_sku_sales_buckets?select=bucket_start_date,market_price,low_sale_price,high_sale_price,low_sale_price_with_shipping,high_sale_price_with_shipping,quantity_sold,transaction_count,observed_at,source&sku_id=eq.${encodeURIComponent(sku)}&order=bucket_start_date.asc`;if(from)path+=`&bucket_start_date=gte.${encodeURIComponent(from)}`;if(to)path+=`&bucket_start_date=lte.${encodeURIComponent(to)}`;const buckets=await rest(t,path).catch(()=>[]);if(!Array.isArray(buckets)||!buckets.length)return null;
  const observations=buckets.map((x:any)=>({date:x.bucket_start_date,market_price:num(x.market_price),low_sale_price:num(x.low_sale_price),high_sale_price:num(x.high_sale_price),low_sale_price_with_shipping:num(x.low_sale_price_with_shipping),high_sale_price_with_shipping:num(x.high_sale_price_with_shipping),quantity:num(x.quantity_sold)||0,transaction_count:num(x.transaction_count)||0}));const totalUnits=observations.reduce((n:number,x:any)=>n+x.quantity,0),totalTransactions=observations.reduce((n:number,x:any)=>n+x.transaction_count,0);const days=range.from?Math.max(1,(Date.parse(range.to)-Date.parse(range.from))/86400000):Math.max(1,(Date.parse(`${observations.at(-1)?.date}T00:00:00Z`)-Date.parse(`${observations[0]?.date}T00:00:00Z`))/86400000+3);
  return {type:'sales_history',domain:'market_sales',title:'TCG sales history',product_id:pid||null,sku_id:sku,range,observations,count:observations.length,total_units:totalUnits,total_transactions:totalTransactions,summary:{average_daily_quantity_sold:totalUnits/days,average_daily_transaction_count:totalTransactions/days,market:summarizePrices(observations)},freshness:{source:'shared_tcg_sales',observed_at:buckets.at(-1)?.observed_at||null},evidence:{scope:'exact_sku',direct_identified:false},actions:[{type:'ask',label:'Interpret velocity',prompt:'Interpret this exact SKU sales velocity over the same period.'},{type:'ask',label:'Compare price',prompt:'Compare sales history to exact SKU price history over the same period.'}]};
}
async function repairScoutSurface(t:string,ctx:any,existing:any[]){
  if(String(ctx?.screen||'').toLowerCase()!=='scout')return existing;const {pid,sku}=ctxIds(ctx);if(!pid&&!sku)return existing;let card:any=null;try{const raw=await rpc(t,'ask_collectish_get_scout_card',{p_product_id:pid||null,p_sku_id:sku||null});card=raw?.card||raw}catch{}
  const cleaned=existing.filter((s:any)=>!(s?.type==='opportunity_card'&&(!s?.item?.product_name||s?.item?.found===false)));if(card?.product_name)cleaned.push({type:'opportunity_card',domain:'scout',title:'Scout opportunity',item:{sku_id:card.sku_id,product_id:card.product_id,product_name:card.product_name,set_name:card.set_name,promoted_grade:card.promoted_grade,promoted_score:card.promoted_score,sku_market_price:card.sku_market_price,direct_available:card.direct_available,edhrec_rank:card.edhrec_rank},actions:[{type:'open_card',label:'Open in Scout',product_id:String(card.product_id),primary:true}]});return cleaned;
}
function salesAnswer(s:any){if(!s)return null;const u=Number(s.total_units||0),tx=Number(s.total_transactions||0),d=Number(s.summary?.average_daily_quantity_sold||0),td=Number(s.summary?.average_daily_transaction_count||0);return `For exact SKU ${s.sku_id}, shared TCGplayer history shows ${u.toLocaleString()} units across ${tx.toLocaleString()} transactions over ${s.range?.label||'the requested period'} (${d.toFixed(1)} cards/day, ${td.toFixed(1)} transactions/day). The sales chart shows volume by bucket; Direct vs non-Direct sales are not identified.`}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});if(req.method!=='POST')return json({error:'POST required'},405);const t=token(req);if(!t)return json({error:'Authentication required'},401);let body:any;try{body=await req.json()}catch{return json({error:'Invalid JSON'},400)}
  const r=await fetch(`${U}/functions/v1/ask-collectish-ui`,{method:'POST',headers:headers(t),body:JSON.stringify(body)});const raw=await r.text();let upstream:any;try{upstream=raw?JSON.parse(raw):{}}catch{return new Response(raw,{status:r.status,headers:{...C,'Content-Type':r.headers.get('content-type')||'text/plain'}})}if(!r.ok)return json(upstream,r.status);if(String(body?.action||'chat')!=='chat')return json(upstream,r.status);
  const q=text(body?.message||body?.question),ctx=body?.context||{},cid=upstream?.conversation_id||body?.conversation_id||null,jobs:any[]=[];if(wantsPrice(q))jobs.push(priceSurface(t,ctx,q,cid));if(wantsSales(q))jobs.push(sharedSalesSurface(t,ctx,q,cid));const historical=(await Promise.all(jobs)).filter(Boolean);let existing=await repairScoutSurface(t,ctx,Array.isArray(upstream?.surfaces)?upstream.surfaces:[]);const keys=new Set(historical.map((x:any)=>`${x.type}:${x.domain}`));existing=existing.filter((x:any)=>!keys.has(`${x?.type}:${x?.domain}`));const surfaces=[...historical,...existing].slice(0,6),sales=historical.find((x:any)=>x.type==='sales_history'),answer=salesAnswer(sales);
  const tools=historical.length?historical.map((x:any)=>({name:x.type==='sales_history'?'shared_market_sales_history':'exact_sku_price_history',ok:true,classification:'READ'})):upstream?.tools;
  return json({...upstream,response:answer||upstream?.response,tools,surface_schema:'collectish.ask.surface.v5',surfaces,orchestration:{mode:historical.length?'deterministic+agent':'agent',historical_tools:tools?.map((x:any)=>x.name)||[],response_source:answer?'shared_history':'agent'}},r.status);
});
