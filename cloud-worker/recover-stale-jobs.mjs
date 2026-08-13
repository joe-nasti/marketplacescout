const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const h={...H,...(prefer?{Prefer:prefer}:{})};const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok)throw new Error(data?.message||data?.hint||`Supabase HTTP ${r.status}`);return data}
const enc=v=>encodeURIComponent(String(v??''));
async function patch(job,body){await sb(`collector_jobs?job_id=eq.${enc(job.job_id)}&status=in.(claimed,running)`,{method:'PATCH',body,prefer:'return=minimal'})}
async function main(){
  const cutoff=encodeURIComponent(new Date().toISOString());
  const jobs=await sb(`collector_jobs?source=eq.marketplace&action=eq.scan_set&status=in.(claimed,running)&lease_expires_at=lt.${cutoff}&order=lease_expires_at.asc&limit=100`);
  let requeued=0,waiting=0,failed=0;
  for(const job of jobs||[]){
    const payload=job.payload_json||{},attempts=Number(job.attempt_count||0),max=Math.max(1,Number(job.max_attempts||3));
    const auth=job.required_capability==='tcgplayer_authenticated_session'||payload.executionClass==='browser_auth';
    if(auth){
      await patch(job,{status:'queued',claimed_at:null,claimed_by:null,lease_expires_at:null,error_message:null,preferred_executor:'browser_connector',required_capability:'tcgplayer_authenticated_session',progress_json:{stage:'queued',percent:0,detail:'Authenticated agent lease expired; waiting for a healthy TCGplayer session.',updatedAt:new Date().toISOString()}});waiting++;continue;
    }
    if(attempts<max){
      await patch(job,{status:'queued',claimed_at:null,claimed_by:null,lease_expires_at:null,error_message:null,progress_json:{stage:'queued',percent:0,detail:'Expired executor lease recovered; returned to eligible queue.',updatedAt:new Date().toISOString()}});requeued++;continue;
    }
    await patch(job,{status:'failed',completed_at:new Date().toISOString(),claimed_by:null,lease_expires_at:null,error_message:`Lease expired after ${attempts}/${max} attempts.`,progress_json:{stage:'failed',percent:0,detail:`Lease expired after ${attempts}/${max} attempts.`,updatedAt:new Date().toISOString()}});failed++;
  }
  console.log(`Stale recovery: ${requeued} requeued, ${waiting} auth waiting, ${failed} failed.`);
}
await main();
