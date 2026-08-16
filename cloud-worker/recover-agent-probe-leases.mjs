// Recover expired authenticated Android read-only probe leases without changing
// endpoint contracts or routing work to any PC/browser connector.
// Also recover transient Seller History failures when no equivalent Android job
// is already active and the order still needs detail.
const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const h={...H,...(prefer?{Prefer:prefer}:{})};const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok)throw new Error(data?.message||data?.hint||`Supabase HTTP ${r.status}`);return data}
const enc=v=>encodeURIComponent(String(v??''));
const now=new Date();
const cutoff=enc(now.toISOString());
function sellerKind(job){return String(job?.payload_json?.sellerHistoryKind||'')}
function sellerKey(job){
  const kind=sellerKind(job),user=String(job?.user_id||'');
  if(!user||!kind)return '';
  if(kind==='order_detail')return `${user}:detail:${String(job?.payload_json?.orderNumber||'')}`;
  if(kind==='order_search')return `${user}:search:${String(job?.payload_json?.windowFrom||'')}:${String(job?.payload_json?.windowTo||'')}:${Number(job?.payload_json?.pageFrom||0)}`;
  if(kind==='auth_detail')return `${user}:auth_detail`;
  return '';
}
function isTransient(message){return /failed to fetch|timed out|timeout|network|HTTP\s+(408|425|429|500|502|503|504)\b/i.test(String(message||''))}
async function detailAlreadyNormalized(job){
  if(sellerKind(job)!=='order_detail')return false;
  const orderNumber=String(job?.payload_json?.orderNumber||'');
  if(!orderNumber)return false;
  const rows=await sb(`seller_orders?select=order_number&user_id=eq.${enc(job.user_id)}&order_number=eq.${enc(orderNumber)}&has_details=eq.true&limit=1`);
  return Boolean(rows?.length);
}

const jobs=await sb(`collector_jobs?source=eq.agent&action=eq.seller_portal_readonly_probe&preferred_executor=eq.android_agent&status=in.(claimed,running)&lease_expires_at=lt.${cutoff}&order=lease_expires_at.asc&limit=200`);
let requeued=0,failed=0;
for(const job of jobs||[]){
  const attempts=Number(job.attempt_count||0),max=Math.max(1,Number(job.max_attempts||3));
  if(attempts<max){
    const delayMinutes=Math.min(15,Math.max(2,2*attempts));
    const availableAt=new Date(now.getTime()+delayMinutes*60000).toISOString();
    await sb(`collector_jobs?job_id=eq.${enc(job.job_id)}&status=in.(claimed,running)`,{method:'PATCH',body:{
      status:'queued',claimed_at:null,claimed_by:null,lease_expires_at:null,completed_at:null,error_message:null,
      preferred_executor:'android_agent',required_capability:'tcgplayer_authenticated_session',available_at:availableAt,
      progress_json:{...(job.progress_json||{}),stage:'deferred',percent:0,detail:`Expired Android probe lease recovered; retry deferred ${delayMinutes}m.`,updatedAt:now.toISOString()}
    },prefer:'return=minimal'});requeued++;
  }else{
    await sb(`collector_jobs?job_id=eq.${enc(job.job_id)}&status=in.(claimed,running)`,{method:'PATCH',body:{
      status:'failed',completed_at:now.toISOString(),claimed_by:null,lease_expires_at:null,
      error_message:`Android probe lease expired after ${attempts}/${max} attempts.`,
      progress_json:{...(job.progress_json||{}),stage:'failed',percent:100,detail:`Android probe lease expired after ${attempts}/${max} attempts.`,updatedAt:now.toISOString()}
    },prefer:'return=minimal'});failed++;
  }
}

// A transient fetch failure can finish as failed before lease recovery sees it.
// Requeue only Seller History jobs, preserve the exact allowlisted request payload,
// and suppress duplicates/already-normalized details. SYP retries remain owned by
// the SYP orchestrator so an unchanged source list is not exported redundantly.
const active=await sb('collector_jobs?select=job_id,user_id,status,payload_json&source=eq.agent&action=eq.seller_portal_readonly_probe&preferred_executor=eq.android_agent&status=in.(queued,claimed,running)&limit=1000');
const activeKeys=new Set((active||[]).map(sellerKey).filter(Boolean));
const failedSince=enc(new Date(now.getTime()-48*60*60*1000).toISOString());
const failedRows=await sb(`collector_jobs?source=eq.agent&action=eq.seller_portal_readonly_probe&preferred_executor=eq.android_agent&status=eq.failed&completed_at=gte.${failedSince}&order=completed_at.asc&limit=200`);
let transientRequeued=0,duplicateSuppressed=0,alreadyDetailed=0;
for(const job of failedRows||[]){
  const kind=sellerKind(job);
  if(!['auth_detail','order_search','order_detail'].includes(kind))continue;
  if(!isTransient(job.error_message||job?.progress_json?.detail))continue;
  const attempts=Number(job.attempt_count||0),max=Math.max(1,Number(job.max_attempts||3));
  if(attempts>=max)continue;
  const key=sellerKey(job);
  if(!key)continue;
  if(activeKeys.has(key)){duplicateSuppressed++;continue}
  if(await detailAlreadyNormalized(job)){alreadyDetailed++;continue}
  const delayMinutes=Math.min(30,Math.max(5,5*Math.max(1,attempts)));
  const availableAt=new Date(now.getTime()+delayMinutes*60000).toISOString();
  await sb(`collector_jobs?job_id=eq.${enc(job.job_id)}&status=eq.failed`,{method:'PATCH',body:{
    status:'queued',completed_at:null,claimed_at:null,claimed_by:null,lease_expires_at:null,error_message:null,
    preferred_executor:'android_agent',required_capability:'tcgplayer_authenticated_session',available_at:availableAt,
    progress_json:{...(job.progress_json||{}),stage:'deferred',percent:0,detail:`Transient Android Seller History failure recovered; retry deferred ${delayMinutes}m.`,updatedAt:now.toISOString()}
  },prefer:'return=minimal'});
  activeKeys.add(key);transientRequeued++;
}
console.log(`Android read-only probe recovery: ${requeued} expired lease retry(s), ${failed} exhausted lease job(s), ${transientRequeued} orphaned transient Seller retry(s), ${duplicateSuppressed} duplicate retry(s) suppressed, ${alreadyDetailed} already-normalized detail retry(s) skipped.`);
