// Retry transient cloud-primary Marketplace failures in cloud first, then fall back to browser exactly once.
const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const h={...H,...(prefer?{Prefer:prefer}:{})};const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok)throw new Error(data?.message||data?.hint||`Supabase HTTP ${r.status}`);return data}
const enc=x=>encodeURIComponent(String(x??''));
function isTransient(message=''){
  return /HTTP\s+(408|425|429|500|502|503|504)\b|abort|timeout|timed out|fetch failed|network/i.test(String(message));
}
async function main(){
  const failed=await sb('collector_jobs?source=eq.marketplace&action=eq.scan_set&status=eq.failed&preferred_executor=in.(cloud_worker,server)&order=completed_at.asc&limit=20');
  let retried=0,freshCloud=0,fallback=0;
  for(const job of failed||[]){
    const payload=job.payload_json||{};
    const attempts=Number(job.attempt_count||0),max=Math.max(1,Number(job.max_attempts||3));
    const error=String(job.error_message||job.progress_json?.detail||'');

    // Keep transient public-endpoint failures in the same job while attempts remain.
    // Deprioritize retries slightly so first-attempt coverage for other sets can
    // continue before a flaky endpoint consumes another slot.
    if(attempts<max && isTransient(error)){
      const now=new Date().toISOString();
      await sb(`collector_jobs?job_id=eq.${enc(job.job_id)}&status=eq.failed`,{method:'PATCH',body:{
        status:'queued',completed_at:null,claimed_at:null,claimed_by:null,lease_expires_at:null,error_message:null,
        priority:Math.max(Number(job.priority||30),35),
        preferred_executor:'cloud_worker',required_capability:'marketplace_public_api',
        progress_json:{stage:'queued',percent:0,detail:`Transient cloud failure recovered; retrying after fresh set coverage (${attempts}/${max} attempts used).`,updatedAt:now}
      },prefer:'return=minimal'});
      retried++;
      continue;
    }

    // A large set can encounter a random upstream 500 after hundreds of successful
    // pages. Once the original job exhausts its attempts, allow exactly one brand-new
    // cloud job so it can start with a clean lease/request history. Cancel any still-
    // queued browser fallback first so one-set-per-day coverage cannot duplicate.
    const freshCount=Number(payload.cloudFreshRetryCount||0);
    if(attempts>=max && isTransient(error) && freshCount<1 && !payload.cloudFreshRetryQueued){
      const existingCloud=await sb(`collector_jobs?parent_job_id=eq.${enc(job.job_id)}&preferred_executor=eq.cloud_worker&status=in.(queued,claimed,running,completed)&limit=1`);
      const now=new Date().toISOString();
      if(!existingCloud?.length){
        await sb(`collector_jobs?parent_job_id=eq.${enc(job.job_id)}&preferred_executor=eq.browser_connector&status=eq.queued`,{method:'PATCH',body:{status:'cancelled',completed_at:now,progress_json:{stage:'cancelled',percent:0,detail:'Superseded by one final fresh cloud retry after transient upstream failures',updatedAt:now}},prefer:'return=minimal'});
        await sb('collector_jobs',{method:'POST',body:[{
          user_id:job.user_id,source:'marketplace',action:'scan_set',status:'queued',priority:35,
          required_capability:'marketplace_public_api',preferred_executor:'cloud_worker',parent_job_id:job.job_id,
          payload_json:{...payload,pcFallbackQueued:false,cloudFreshRetryCount:1,cloudFreshRetryOf:job.job_id,executionClass:'cloud_public'},
          progress_json:{stage:'queued',percent:0,detail:'Original cloud job exhausted transient retries; trying one fresh cloud job before browser fallback',updatedAt:now},
          max_attempts:max
        }],prefer:'return=minimal'});
      }
      await sb(`collector_jobs?job_id=eq.${enc(job.job_id)}`,{method:'PATCH',body:{payload_json:{...payload,cloudFreshRetryQueued:true,cloudFreshRetryQueuedAt:now}},prefer:'return=minimal'});
      freshCloud++;
      continue;
    }

    if(payload.pcFallbackQueued)continue;
    const existing=await sb(`collector_jobs?parent_job_id=eq.${enc(job.job_id)}&preferred_executor=eq.browser_connector&status=in.(queued,claimed,running,completed)&limit=1`);
    if(existing?.length)continue;
    const now=new Date().toISOString();
    await sb('collector_jobs',{method:'POST',body:[{
      user_id:job.user_id,source:'marketplace',action:'scan_set',status:'queued',priority:20,
      required_capability:'marketplace_browser_fallback',preferred_executor:'browser_connector',parent_job_id:job.job_id,
      payload_json:{...payload,cloudFailureJobId:job.job_id,pcFallback:true,executionClass:'browser_fallback'},
      progress_json:{stage:'queued',percent:0,detail:'Cloud scan exhausted safe retries; automatically requeued to browser fallback',updatedAt:now},
      max_attempts:3
    }],prefer:'return=minimal'});
    await sb(`collector_jobs?job_id=eq.${enc(job.job_id)}`,{method:'PATCH',body:{payload_json:{...payload,pcFallbackQueued:true,pcFallbackQueuedAt:now}},prefer:'return=minimal'});
    fallback++;
  }
  console.log(`Cloud failure recovery: ${retried} same-job retry(s), ${freshCloud} fresh cloud retry job(s), ${fallback} browser fallback(s).`);
}
await main();
