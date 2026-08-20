// Validate SYP GetLastUpdated results before the normalizer consumes them.
// Authenticated Android reads can occasionally return a portal document instead
// of the expected timestamp. Invalid content is discarded and marked for retry.
const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
const enc=v=>encodeURIComponent(String(v??''));
async function sb(path,{method='GET',body,prefer}={}){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!r.ok)throw new Error(data?.message||data?.hint||`Supabase HTTP ${r.status}`);
  return data;
}
function normalizedText(value){
  let text=String(value??'').trim();
  try{const parsed=JSON.parse(text);if(typeof parsed==='string')text=parsed.trim()}catch{}
  return text.replace(/^"|"$/g,'').trim();
}
function validTimestamp(value){
  const text=normalizedText(value);
  if(!text||text.length>128||text.includes('<')||text.includes('>'))return false;
  return Number.isFinite(Date.parse(text));
}
const jobs=await sb('collector_jobs?select=job_id,progress_json&source=eq.agent&action=eq.seller_portal_readonly_probe&status=eq.completed&payload_json->>sypKind=eq.last_updated&progress_json->>sypOrchestratedAt=is.null&order=completed_at.desc&limit=100');
let quarantined=0;
for(const job of jobs||[]){
  const body=job?.progress_json?.readOnlyProbe?.body;
  if(validTimestamp(body))continue;
  const probe={...(job.progress_json?.readOnlyProbe||{})};
  delete probe.body;
  const at=new Date().toISOString();
  await sb(`collector_jobs?job_id=eq.${enc(job.job_id)}`,{method:'PATCH',body:{progress_json:{...(job.progress_json||{}),readOnlyProbe:probe,sypOrchestratedAt:at,sypStatus:'invalid_last_updated_response',sypError:'SYP GetLastUpdated returned non-timestamp content; retry required.'}},prefer:'return=minimal'});
  quarantined++;
}
console.log(`SYP response guard: quarantined ${quarantined} malformed last-updated response(s).`);
