const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const LIMIT=Math.max(1,Math.min(1000,Number(process.env.COLLECTISH_MARKETPLACE_SALES_LIMIT||process.env.COLLECTISH_SCOUT_SALES_LIMIT||250)));
const INFINITE='https://infinite-api.tcgplayer.com';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const headers={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
const started=new Date().toISOString();

async function request(path,{method='GET',body,prefer}={}){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:{...headers,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();
  if(!r.ok)throw new Error(`${path} failed ${r.status}: ${text}`);
  return text?JSON.parse(text):null;
}
async function rpc(name,body={}){return request(`rpc/${name}`,{method:'POST',body})}
async function writeState(status,detail,rowCount=0){
  await request('mtgjson_sync_state?on_conflict=feed',{method:'POST',body:[{feed:'marketplace_sales_history',status,last_started_at:started,last_completed_at:new Date().toISOString(),row_count:rowCount,detail}],prefer:'resolution=merge-duplicates,return=minimal'});
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
  const aggregate=Number(await rpc('refresh_scout_opportunities_24h_core'));
  const shadow=Number(await rpc('refresh_scout_v5_shadow'));
  const promotedCache=Number(await rpc('refresh_scout_opportunities_v5_cache'));
  return {aggregate,annotated_in_core:true,shadow,promotedCache};
}

try{
  await writeState('running',{phase:'candidate_collection',limit:LIMIT});
  const candidates=await rpc('get_marketplace_sales_collection_candidates',{p_limit:LIMIT})||[];
  const reasonCounts={signal:0,scout:0,secretLair:0,overlap:0,other:0};
  for(const c of candidates){
    const reasons=Array.isArray(c.watch_reasons)?c.watch_reasons:[];
    const hasSignal=reasons.includes('signal'),hasScout=reasons.includes('scout'),hasSecretLair=reasons.includes('secret_lair');
    if(hasSignal)reasonCounts.signal++;
    if(hasScout)reasonCounts.scout++;
    if(hasSecretLair)reasonCounts.secretLair++;
    if(hasSignal&&hasScout)reasonCounts.overlap++;
    if(!hasSignal&&!hasScout&&!hasSecretLair)reasonCounts.other++;
  }

  let fetched=0,appliedSkuRows=0,projectedSecretLairRows=0,failed=0;
  const failures=[];
  for(const c of candidates){
    try{
      const hist=await jsonFetch(`${INFINITE}/price/history/${encodeURIComponent(c.product_id)}/detailed?range=quarter`);
      const result=Array.isArray(hist?.result)?hist.result:[];
      const n=await rpc('apply_marketplace_sales_history',{p_user_id:c.user_id,p_product_id:String(c.product_id),p_result:result,p_source:'shared_sales_worker'});
      if(Array.isArray(c.watch_reasons)&&c.watch_reasons.includes('secret_lair')){
        const projected=await rpc('project_secret_lair_marketplace_sales',{p_user_id:c.user_id,p_product_id:String(c.product_id)});
        projectedSecretLairRows+=Number(projected||0);
      }
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
  let refresh={aggregate:0,annotated_in_core:false,shadow:0,promotedCache:0};
  let refreshWarning=null;
  if(includesScout){
    try{refresh=await refreshScout()}
    catch(e){
      refreshWarning=String(e?.message||e).slice(0,500);
      console.warn('Sales history saved; deferred contended Scout cache refresh:',refreshWarning);
    }
  }
  const detail={subsystem:'marketplace-sales-history',candidateCount:candidates.length,reasonCounts,fetched,failed,appliedSkuRows,projectedSecretLairRows,failures:failures.slice(0,20),refreshWarning,...refresh,scoringVersion:'scout-v5',limit:LIMIT};
  const status=candidates.length>0&&fetched===0&&failed>0?'failed':failed>0?'complete_with_warnings':'complete';
  await writeState(status,detail,appliedSkuRows);
  console.log(JSON.stringify({...detail,status},null,2));
  if(status==='failed')process.exitCode=1;
}catch(error){
  await writeState('failed',{phase:'fatal',error:String(error?.stack||error),limit:LIMIT}).catch(()=>{});
  throw error;
}