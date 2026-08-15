// Recover expired authenticated Android read-only probe leases without changing
// endpoint contracts or routing work to any PC/browser connector.
const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const h={...H,...(prefer?{Prefer:prefer}:{})};const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok)throw new Error(data?.message||data?.hint||`Supabase HTTP ${r.status}`);return data}
const enc=v=>encodeURIComponent(String(v??''));
const now=new Date();
const cutoff=enc(now.toISOString());
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
console.log(`Android read-only probe lease recovery: ${requeued} deferred retry(s), ${failed} exhausted job(s).`);
