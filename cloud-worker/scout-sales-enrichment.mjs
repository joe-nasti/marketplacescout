const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const LIMIT=Math.max(1,Math.min(500,Number(process.env.COLLECTISH_SCOUT_SALES_LIMIT||150)));
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
    try{
      const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),20000);
      const r=await fetch(url,{headers:{Accept:'application/json'},signal:ac.signal});clearTimeout(timer);
      const text=await r.text();
      if(!r.ok)throw new Error(`HTTP ${r.status}: ${text.slice(0,180)}`);
      return JSON.parse(text);
    }catch(e){last=e;if(i===retries)throw e;await sleep(500*(2**i)+Math.floor(Math.random()*150));}
  }
  throw last;
}
async function refreshV3(){
  let after=0,total=0;
  for(let i=0;i<100;i++){
    const d=await rpc('recalculate_scout_base_v3_batch',{p_after_id:after,p_limit:750});
    const n=Number(d?.count||0),next=Number(d?.last_id||after);total+=n;
    if(!n||next<=after)break;after=next;
  }
  const refreshed=await rpc('refresh_scout_opportunities_24h');
  const annotated=await rpc('annotate_scout_sales_confidence');
  return {rescored:total,refreshed,annotated};
}

const candidates=await rpc('get_scout_sales_enrichment_candidates',{p_limit:LIMIT})||[];
let fetched=0,appliedRows=0,failed=0;
for(const c of candidates){
  try{
    const hist=await jsonFetch(`${INFINITE}/price/history/${encodeURIComponent(c.product_id)}/detailed?range=quarter`);
    const result=Array.isArray(hist?.result)?hist.result:[];
    const n=await rpc('apply_scout_sales_cache',{p_user_id:c.user_id,p_product_id:String(c.product_id),p_result:result});
    fetched++;appliedRows+=Number(n||0);
  }catch(e){failed++;console.error(`sales ${c.product_id} ${c.product_name}: ${e.message}`);}
  await sleep(90);
}
const refresh=await refreshV3();
console.log(JSON.stringify({candidateCount:candidates.length,fetched,failed,appliedRows,...refresh,limit:LIMIT},null,2));
