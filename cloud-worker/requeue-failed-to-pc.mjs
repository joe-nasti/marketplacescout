// Recover transient Marketplace failures without depending on the PC/browser connector.
const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const h={...H,...(prefer?{Prefer:prefer}:{})};const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok)throw new Error(data?.message||data?.hint||`Supabase HTTP ${r.status}`);return data}
const enc=x=>encodeURIComponent(String(x??''));
const isTransient=m=>/HTTP\s+(408|425|429|500|502|503|504)\b|abort|timeout|timed out|fetch failed|network/i.test(String(m||''));
async function main(){
  let repairedLegacy=0,requeued=0,deferred=0;
  // Any legacy browser fallback still waiting is moved back to cloud immediately.
  const legacy=await sb('collector_jobs?source=eq.marketplace&action=eq.scan_set&status=eq.queued&preferred_executor=eq.browser_connector&limit=100');
  for(const job of legacy||[]){
    const now=new Date().toISOString(),payload=job.payload_json||{};
    await sb(`collector_jobs?job_id=eq.${enc(job.job_id)}&status=eq.queued`,{method:'PATCH',body:{
      priority:40,preferred_executor:'cloud_worker',required_capability:'marketplace_public_api',available_at:now,
      payload_json:{...payload,pcFallback:false,pcFallbackQueued:false,executionClass:'cloud_public',cloudOnly:true},
      progress_json:{stage:'queued',percent:0,detail:'Legacy PC fallback removed; deferred back to Collectish Cloud.',updatedAt:now}
    },prefer:'return=minimal'});repairedLegacy++;
  }
  const failed=await sb('collector_jobs?source=eq.marketplace&action=eq.scan_set&status=eq.failed&preferred_executor=in.(cloud_worker,server)&order=completed_at.asc&limit=100');
  for(const job of failed||[]){
    const payload=job.payload_json||{},attempts=Number(job.attempt_count||0),max=Math.max(1,Number(job.max_attempts||3));
    const error=String(job.error_message||job.progress_json?.detail||'');
    if(!isTransient(error))continue;
    const now=new Date(),backoffMinutes=Math.min(180,Math.max(10,15*Math.max(1,attempts)));
    const availableAt=new Date(now.getTime()+backoffMinutes*60000).toISOString();
    if(attempts<max){
      await sb(`collector_jobs?job_id=eq.${enc(job.job_id)}&status=eq.failed`,{method:'PATCH',body:{
        status:'queued',completed_at:null,claimed_at:null,claimed_by:null,lease_expires_at:null,error_message:null,
        priority:40,preferred_executor:'cloud_worker',required_capability:'marketplace_public_api',available_at:availableAt,
        payload_json:{...payload,pcFallback:false,pcFallbackQueued:false,executionClass:'cloud_public',cloudOnly:true},
        progress_json:{stage:'deferred',percent:0,detail:`Transient upstream failure; cloud retry deferred ${backoffMinutes}m (${attempts}/${max} attempts used).`,updatedAt:now.toISOString()}
      },prefer:'return=minimal'});requeued++;continue;
    }
    // Exhausted transient failures get one fresh cloud child after a longer cool-down.
    const existing=await sb(`collector_jobs?parent_job_id=eq.${enc(job.job_id)}&preferred_executor=eq.cloud_worker&status=in.(queued,claimed,running,completed)&limit=1`);
    if(existing?.length)continue;
    const freshCount=Number(payload.cloudFreshRetryCount||0);
    if(freshCount>=2)continue;
    const childAt=new Date(now.getTime()+60*60000).toISOString();
    await sb('collector_jobs',{method:'POST',body:[{
      user_id:job.user_id,source:'marketplace',action:'scan_set',status:'queued',priority:45,available_at:childAt,
      required_capability:'marketplace_public_api',preferred_executor:'cloud_worker',parent_job_id:job.job_id,
      payload_json:{...payload,pcFallback:false,pcFallbackQueued:false,cloudFreshRetryCount:freshCount+1,cloudFreshRetryOf:job.job_id,executionClass:'cloud_public',cloudOnly:true},
      progress_json:{stage:'deferred',percent:0,detail:'Cloud attempts exhausted on transient upstream errors; fresh cloud retry scheduled after 60m cool-down.',updatedAt:now.toISOString()},
      max_attempts:max
    }],prefer:'return=minimal'});deferred++;
  }
  console.log(`Cloud-only recovery: ${repairedLegacy} legacy PC fallback(s) restored to cloud, ${requeued} same-job retry(s), ${deferred} fresh deferred cloud retry job(s).`);
}
await main();
