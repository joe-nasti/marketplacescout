// Canonical cloud executor for Ask Collectish Scout sales investigation jobs.
const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const MAX_JOBS=Math.max(1,Number(process.env.COLLECTISH_MAX_JOBS||4));
const WORKER_ID='00000000-0000-4000-8000-000000000001';
const INFINITE='https://infinite-api.tcgplayer.com';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){
  const headers={...H,...(prefer?{Prefer:prefer}:{})};
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!r.ok)throw new Error(data?.message||data?.hint||`Supabase HTTP ${r.status}`);
  return data;
}
async function jsonFetch(url){
  const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),20000);
  try{
    const r=await fetch(url,{signal:ac.signal,headers:{Accept:'application/json'}});
    const text=await r.text();
    if(!r.ok)throw new Error(`HTTP ${r.status} ${new URL(url).hostname}: ${text.replace(/\s+/g,' ').slice(0,220)}`);
    return JSON.parse(text);
  }finally{clearTimeout(timer)}
}
async function event(job,type,progress={},message=null){
  await sb('collector_job_events',{method:'POST',body:[{job_id:job.job_id,user_id:job.user_id,event_type:type,collector_id:WORKER_ID,progress_json:progress,message:message||progress.detail||null,metadata_json:{executor:'cloud_worker'}}],prefer:'return=minimal'});
}
async function updateJob(job,patch,type=null){
  if(['claimed','running'].includes(patch.status))patch.lease_expires_at=new Date(Date.now()+5*60*1000).toISOString();
  if(patch.progress_json)patch.progress_json={...patch.progress_json,updatedAt:new Date().toISOString()};
  await sb(`collector_jobs?job_id=eq.${encodeURIComponent(job.job_id)}`,{method:'PATCH',body:patch,prefer:'return=minimal'});
  if(type)await event(job,type,patch.progress_json||{},patch.error_message||null);
}
async function claim(candidate){
  const token=crypto.randomUUID(),now=new Date().toISOString();
  await sb(`collector_jobs?job_id=eq.${encodeURIComponent(candidate.job_id)}&status=eq.queued`,{method:'PATCH',body:{status:'claimed',claimed_at:now,claimed_by:WORKER_ID,lease_expires_at:new Date(Date.now()+5*60*1000).toISOString(),attempt_count:Number(candidate.attempt_count||0)+1,progress_json:{stage:'claimed',percent:0,detail:'Claimed by Ask Collectish cloud worker',claimToken:token,updatedAt:now}},prefer:'return=minimal'});
  const rows=await sb(`collector_jobs?job_id=eq.${encodeURIComponent(candidate.job_id)}&limit=1`);const job=rows?.[0];
  if(job?.status!=='claimed'||job?.progress_json?.claimToken!==token)return null;
  await event(job,'claimed',job.progress_json);return job;
}
async function run(job){
  const productId=String(job.payload_json?.productId||job.payload_json?.product_id||'');
  if(!productId)throw new Error('Ask Collectish Investigate job missing productId');
  await updateJob(job,{status:'running',progress_json:{stage:'sales',percent:15,detail:`Investigating TCG sales history for product ${productId}`}},'running');
  const hist=await jsonFetch(`${INFINITE}/price/history/${encodeURIComponent(productId)}/detailed?range=quarter`);
  const result=Array.isArray(hist?.result)?hist.result:[];
  const applied=await sb('rpc/apply_scout_sales_cache',{method:'POST',body:{p_user_id:job.user_id,p_product_id:productId,p_result:result}});
  await updateJob(job,{status:'completed',completed_at:new Date().toISOString(),lease_expires_at:null,error_message:null,progress_json:{stage:'complete',percent:100,detail:`Investigate complete: ${result.length} sales SKUs refreshed`,productId,appliedRows:Number(applied||0)}},'completed');
}

const jobs=await sb(`collector_jobs?source=eq.ask_collectish&action=eq.scout_sales_enrich&status=eq.queued&preferred_executor=in.(cloud-marketplace-worker,cloud_worker,server)&order=created_at.asc&limit=${MAX_JOBS}`)||[];
for(const candidate of jobs){let job=null;try{job=await claim(candidate);if(job)await run(job)}catch(e){console.error(e);if(job)await updateJob(job,{status:'failed',completed_at:new Date().toISOString(),lease_expires_at:null,error_message:String(e.message||e).slice(0,1000),progress_json:{stage:'failed',percent:0,detail:String(e.message||e).slice(0,500)}},'failed').catch(()=>{})}}
console.log(`Ask Collectish Investigate processed ${jobs.length} queued job(s).`);
