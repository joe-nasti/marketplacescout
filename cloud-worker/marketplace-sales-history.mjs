const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const LIMIT=Math.max(1,Math.min(1000,Number(process.env.COLLECTISH_MARKETPLACE_SALES_LIMIT||process.env.COLLECTISH_SCOUT_SALES_LIMIT||250)));
const INFINITE='https://infinite-api.tcgplayer.com';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const headers={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};

async function rpc(name,body={}){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(body)});
  const text=await r.text();
  if(!r.ok)throw new Error(`${name} failed ${r.status}: ${text}`);
  return text?JSON.parse(text):null;
}
async function jsonFetch(url,retries=3){
  let last;
  for(let i=0;i<=retries;i++){
    const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),20000);
    try{
      const r=await fetch(url,{headers:{Accept:'application/json'},signal:ac.signal});
      const text=await r.text();
      if(!r.ok)throw new Error(`HTTP ${r.status}: ${text.slice(0,180)}`);
      return JSON.parse(text);
    }catch(e){last=e;if(i===retries)throw e;await sleep(500*(2**i)+Math.floor(Math.random()*150));}
    finally{clearTimeout(timer)}
  }
  throw last;
}
async function refreshScout(){
  const aggregate=Number(await rpc('refresh_scout_opportunities_24h'));
  const annotated=Number(await rpc('annotate_scout_sales_confidence'));
  const shadow=Number(await rpc('refresh_scout_v5_shadow'));
  const promotedCache=Number(await rpc('refresh_scout_opportunities_v5_cache'));
  return {aggregate,annotated,shadow,promotedCache};
}

const candidates=await rpc('get_marketplace_sales_collection_candidates',{p_limit:LIMIT})||[];
const reasonCounts={signal:0,scout:0,overlap:0,other:0};
for(const c of candidates){
  const reasons=Array.isArray(c.watch_reasons)?c.watch_reasons:[];
  const hasSignal=reasons.includes('signal'),hasScout=reasons.includes('scout');
  if(hasSignal)reasonCounts.signal++;
  if(hasScout)reasonCounts.scout++;
  if(hasSignal&&hasScout)reasonCounts.overlap++;
  if(!hasSignal&&!hasScout)reasonCounts.other++;
}

let fetched=0,appliedSkuRows=0,failed=0;
const failures=[];
for(const c of candidates){
  try{
    const hist=await jsonFetch(`${INFINITE}/price/history/${encodeURIComponent(c.product_id)}/detailed?range=quarter`);
    const result=Array.isArray(hist?.result)?hist.result:[];
    const n=await rpc('apply_marketplace_sales_history',{
      p_user_id:c.user_id,
      p_product_id:String(c.product_id),
      p_result:result,
      p_source:'shared_sales_worker'
    });
    fetched++;
    appliedSkuRows+=Number(n||0);
  }catch(e){
    failed++;
    failures.push({productId:String(c.product_id),name:c.product_name||'',error:String(e?.message||e).slice(0,240)});
    console.error(`sales ${c.product_id} ${c.product_name||''}: ${e?.message||e}`);
  }
  await sleep(100);
}

const includesScout=candidates.some(c=>Array.isArray(c.watch_reasons)&&c.watch_reasons.includes('scout'));
const refresh=includesScout?await refreshScout():{aggregate:0,annotated:0,shadow:0,promotedCache:0};
console.log(JSON.stringify({
  subsystem:'marketplace-sales-history',
  candidateCount:candidates.length,
  reasonCounts,
  fetched,
  failed,
  appliedSkuRows,
  failures:failures.slice(0,20),
  ...refresh,
  scoringVersion:'scout-v5',
  limit:LIMIT
},null,2));
if(failed)process.exitCode=1;
