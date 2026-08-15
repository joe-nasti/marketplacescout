// Recover transient Marketplace failures without depending on the PC/browser connector.
// Also collapse stale duplicate daily retries once a set has completed for the Chicago day.
const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const h={...H,...(prefer?{Prefer:prefer}:{})};const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok)throw new Error(data?.message||data?.hint||`Supabase HTTP ${r.status}`);return data}
const enc=x=>encodeURIComponent(String(x??''));
const isTransient=m=>/HTTP\s+(408|425|429|500|502|503|504)\b|abort|timeout|timed out|fetch failed|network/i.test(String(m||''));
function chicagoDay(value){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
const today=chicagoDay(Date.now());
const daily=job=>Boolean(job?.payload_json?.dailyAutoSync||job?.payload_json?.dailyCatchup);
const setKey=job=>`${job.user_id}|${job?.payload_json?.profile?.setSlug||''}`;
const activeRank=j=>j.status==='running'?0:j.status==='claimed'?1:2;

async function cancelQueued(job,detail){
  const now=new Date().toISOString();
  await sb(`collector_jobs?job_id=eq.${enc(job.job_id)}&status=eq.queued`,{method:'PATCH',body:{status:'cancelled',completed_at:now,error_message:null,progress_json:{stage:'cancelled',percent:100,detail,updatedAt:now}},prefer:'return=minimal'});
}

async function main(){
  let repairedLegacy=0,requeued=0,deferred=0,cancelledRedundant=0,deduped=0;

  const scans=await sb('marketplace_scans?select=user_id,set_slug,captured_at&order=captured_at.desc&limit=1000');
  const completedToday=new Set((scans||[]).filter(s=>s.set_slug&&chicagoDay(s.captured_at)===today).map(s=>`${s.user_id}|${s.set_slug}`));

  // Any legacy browser fallback still waiting is moved back to cloud immediately.
  const legacy=await sb('collector_jobs?source=eq.marketplace&action=eq.scan_set&status=eq.queued&preferred_executor=eq.browser_connector&limit=200');
  for(const job of legacy||[]){
    const now=new Date().toISOString(),payload=job.payload_json||{};
    if(daily(job)&&completedToday.has(setKey(job))){await cancelQueued(job,'Daily set refresh already completed today; redundant legacy fallback cancelled.');cancelledRedundant++;continue;}
    await sb(`collector_jobs?job_id=eq.${enc(job.job_id)}&status=eq.queued`,{method:'PATCH',body:{
      priority:40,preferred_executor:'cloud_worker',required_capability:'marketplace_public_api',available_at:job.available_at||now,
      payload_json:{...payload,pcFallback:false,pcFallbackQueued:false,executionClass:'cloud_public',cloudOnly:true,cloudPrimary:true},
      progress_json:{stage:'queued',percent:0,detail:'Legacy PC fallback removed; restored to Collectish Cloud.',updatedAt:now}
    },prefer:'return=minimal'});repairedLegacy++;
  }

  // Cancel stale queued daily siblings after any successful scan for the same user/set today.
  const queuedDaily=await sb('collector_jobs?source=eq.marketplace&action=eq.scan_set&status=eq.queued&order=created_at.asc&limit=500');
  for(const job of queuedDaily||[]){
    if(!daily(job)||!completedToday.has(setKey(job)))continue;
    await cancelQueued(job,'Daily set refresh already completed today; redundant cloud retry cancelled.');cancelledRedundant++;
  }

  // Before processing failures, collapse parallel active daily retry lineages to one
  // job per user/set. Prefer a running/claimed job; otherwise keep the earliest due.
  const activeRows=await sb('collector_jobs?source=eq.marketplace&action=eq.scan_set&status=in.(queued,claimed,running)&order=created_at.asc&limit=500');
  const groups=new Map();
  for(const job of activeRows||[]){if(!daily(job))continue;const key=setKey(job);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(job)}
  for(const [key,rows] of groups){
    if(rows.length<2)continue;
    rows.sort((a,b)=>activeRank(a)-activeRank(b)||new Date(a.available_at||a.created_at)-new Date(b.available_at||b.created_at)||new Date(a.created_at)-new Date(b.created_at));
    const keep=rows[0];
    for(const job of rows.slice(1)){
      if(job.status!=='queued')continue;
      await cancelQueued(job,`Duplicate daily cloud retry suppressed; ${keep.status} sibling ${keep.job_id} retained for this set.`);cancelledRedundant++;
    }
  }

  const activeAfter=await sb('collector_jobs?source=eq.marketplace&action=eq.scan_set&status=in.(queued,claimed,running)&order=created_at.asc&limit=500');
  const activeDaily=new Set((activeAfter||[]).filter(daily).map(setKey));

  const failed=await sb('collector_jobs?source=eq.marketplace&action=eq.scan_set&status=eq.failed&preferred_executor=in.(cloud_worker,server)&order=completed_at.asc&limit=200');
  for(const job of failed||[]){
    const payload=job.payload_json||{},attempts=Number(job.attempt_count||0),max=Math.max(1,Number(job.max_attempts||3));
    const error=String(job.error_message||job.progress_json?.detail||'');
    if(!isTransient(error))continue;
    const key=setKey(job),isDaily=daily(job);
    if(isDaily&&completedToday.has(key))continue;
    if(isDaily&&activeDaily.has(key)){deduped++;continue;}

    const now=new Date(),backoffMinutes=Math.min(180,Math.max(10,15*Math.max(1,attempts)));
    const availableAt=new Date(now.getTime()+backoffMinutes*60000).toISOString();
    if(attempts<max){
      await sb(`collector_jobs?job_id=eq.${enc(job.job_id)}&status=eq.failed`,{method:'PATCH',body:{
        status:'queued',completed_at:null,claimed_at:null,claimed_by:null,lease_expires_at:null,error_message:null,
        priority:40,preferred_executor:'cloud_worker',required_capability:'marketplace_public_api',available_at:availableAt,
        payload_json:{...payload,pcFallback:false,pcFallbackQueued:false,executionClass:'cloud_public',cloudOnly:true,cloudPrimary:true},
        progress_json:{stage:'deferred',percent:0,detail:`Transient upstream failure; cloud retry deferred ${backoffMinutes}m (${attempts}/${max} attempts used).`,updatedAt:now.toISOString()}
      },prefer:'return=minimal'});requeued++;if(isDaily)activeDaily.add(key);continue;
    }

    const freshCount=Number(payload.cloudFreshRetryCount||0);
    if(freshCount>=2)continue;
    const childAt=new Date(now.getTime()+60*60000).toISOString();
    await sb('collector_jobs',{method:'POST',body:[{
      user_id:job.user_id,source:'marketplace',action:'scan_set',status:'queued',priority:45,available_at:childAt,
      required_capability:'marketplace_public_api',preferred_executor:'cloud_worker',parent_job_id:job.job_id,
      payload_json:{...payload,pcFallback:false,pcFallbackQueued:false,cloudFreshRetryCount:freshCount+1,cloudFreshRetryOf:job.job_id,executionClass:'cloud_public',cloudOnly:true,cloudPrimary:true},
      progress_json:{stage:'deferred',percent:0,detail:'Cloud attempts exhausted on transient upstream errors; fresh cloud retry scheduled after 60m cool-down.',updatedAt:now.toISOString()},
      max_attempts:max
    }],prefer:'return=minimal'});deferred++;if(isDaily)activeDaily.add(key);
  }
  console.log(`Cloud-only recovery ${today} Chicago: ${repairedLegacy} legacy PC fallback(s) restored, ${cancelledRedundant} redundant daily retry(s) cancelled, ${requeued} same-job retry(s), ${deferred} fresh cloud retry job(s), ${deduped} duplicate lineage retry(s) suppressed.`);
}
await main();
