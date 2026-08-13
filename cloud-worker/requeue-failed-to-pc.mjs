// Requeue failed cloud-primary Marketplace jobs to the browser connector exactly once.
const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const h={...H,...(prefer?{Prefer:prefer}:{})};const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok)throw new Error(data?.message||data?.hint||`Supabase HTTP ${r.status}`);return data}
const enc=x=>encodeURIComponent(String(x??''));
async function main(){
  const failed=await sb('collector_jobs?source=eq.marketplace&action=eq.scan_set&status=eq.failed&preferred_executor=in.(cloud_worker,server)&order=completed_at.asc&limit=20');
  let n=0;
  for(const job of failed||[]){
    const payload=job.payload_json||{};
    if(payload.pcFallbackQueued)continue;
    const existing=await sb(`collector_jobs?parent_job_id=eq.${enc(job.job_id)}&preferred_executor=eq.browser_connector&limit=1`);
    if(existing?.length)continue;
    const now=new Date().toISOString();
    await sb('collector_jobs',{method:'POST',body:[{
      user_id:job.user_id,source:'marketplace',action:'scan_set',status:'queued',priority:20,
      required_capability:'marketplace_scan',preferred_executor:'browser_connector',parent_job_id:job.job_id,
      payload_json:{...payload,cloudFailureJobId:job.job_id,pcFallback:true},
      progress_json:{stage:'queued',percent:0,detail:'Cloud scan failed; automatically requeued to PC connector',updatedAt:now},
      max_attempts:3
    }],prefer:'return=minimal'});
    await sb(`collector_jobs?job_id=eq.${enc(job.job_id)}`,{method:'PATCH',body:{payload_json:{...payload,pcFallbackQueued:true,pcFallbackQueuedAt:now}},prefer:'return=minimal'});
    n++;
  }
  console.log(n?`Queued ${n} failed cloud Marketplace job(s) to PC fallback.`:'No failed cloud Marketplace jobs need PC fallback.');
}
await main();
