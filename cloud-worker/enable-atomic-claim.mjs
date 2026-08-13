// Patch the checked-out Marketplace worker to use the database atomic claim RPC.
// This keeps the production worker source readable while the queue contract stabilizes.
import fs from 'node:fs';

const path='cloud-worker/marketplace-worker.mjs';
let src=fs.readFileSync(path,'utf8');

const old=/async function claim\(job\)\{const token=crypto\.randomUUID\(\),now=new Date\(\)\.toISOString\(\);await sb\(`collector_jobs\?job_id=eq\.\$\{encodeURIComponent\(job\.job_id\)\}&status=eq\.queued`,\{method:"PATCH",body:\{status:"claimed",claimed_at:now,claimed_by:WORKER_ID,lease_expires_at:new Date\(Date\.now\(\)\+5\*60\*1000\)\.toISOString\(\),attempt_count:Number\(job\.attempt_count\|\|0\)\+1,progress_json:\{stage:"claimed",percent:0,detail:"Claimed by Collectish cloud worker",claimToken:token,updatedAt:now\}\},prefer:"return=minimal"\}\);const rows=await sb\(`collector_jobs\?job_id=eq\.\$\{encodeURIComponent\(job\.job_id\)\}&limit=1`\);const got=rows\?\.\[0\];if\(got\?\.status!=="claimed"\|\|got\?\.progress_json\?\.claimToken!==token\)return null;await heartbeat\(got\);await event\(got,"claimed",got\.progress_json\);return got\}/;

const replacement=`async function claim(job){
  const rows=await sb('rpc/claim_collector_job',{
    method:'POST',
    body:{
      p_source:'marketplace',
      p_action:'scan_set',
      p_preferred_executors:['cloud_worker','server','verification'],
      p_required_capability:job?.preferred_executor==='verification'?null:'marketplace_public_api',
      p_collector_id:WORKER_ID,
      p_lease_seconds:300
    }
  });
  const got=rows?.[0]||null;
  if(!got)return null;
  await heartbeat(got);
  await event(got,'claimed',got.progress_json||{});
  return got;
}`;

if(!old.test(src))throw new Error('Expected legacy claim() implementation was not found; refusing to patch worker.');
src=src.replace(old,replacement);
fs.writeFileSync(path,src);
console.log('Marketplace worker claim() patched to public.claim_collector_job RPC.');
