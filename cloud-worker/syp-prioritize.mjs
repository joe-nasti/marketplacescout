// Keep the tiny SYP timestamp/export chain ahead of bulk Seller History detail backfill.
// This only changes queue priority; Android policy still controls allowed read-only requests.
const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const h={...H,...(prefer?{Prefer:prefer}:{})};const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok)throw new Error(data?.message||data?.hint||`Supabase HTTP ${r.status}`);return data}
const enc=v=>encodeURIComponent(String(v??''));
// SYP probes are intentionally sparse and usually newest. Fetch newest first so
// a large historical Seller detail backlog cannot push them beyond this bound.
const jobs=await sb('collector_jobs?select=job_id,priority,payload_json&source=eq.agent&action=eq.seller_portal_readonly_probe&status=eq.queued&order=created_at.desc&limit=300');
let changed=0;
for(const job of jobs||[]){
  const kind=job.payload_json?.sypKind;if(!kind)continue;
  const priority=kind==='last_updated'?1:kind==='export'?2:3;
  if(Number(job.priority)===priority)continue;
  await sb(`collector_jobs?job_id=eq.${enc(job.job_id)}&status=eq.queued`,{method:'PATCH',body:{priority},prefer:'return=minimal'});changed++;
}
console.log(`SYP priority normalization: ${changed} queued authenticated probe(s) promoted.`);
