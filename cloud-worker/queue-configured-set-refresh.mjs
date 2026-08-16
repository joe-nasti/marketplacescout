const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(d?.message||`Supabase ${r.status}: ${String(t).slice(0,240)}`);return d}
const now=new Date();
const profiles=await sb(`marketplace_scan_profiles?select=*&enabled=eq.true&or=(next_due_at.is.null,next_due_at.lte.${encodeURIComponent(now.toISOString())})&order=next_due_at.asc.nullsfirst&limit=100`);
let queued=0,skipped=0;
for(const p of profiles||[]){
  const active=await sb(`collector_jobs?select=job_id,status&user_id=eq.${encodeURIComponent(p.user_id)}&source=eq.marketplace&action=eq.scan_set&status=in.(queued,claimed,running)&payload_json->profile->>setSlug=eq.${encodeURIComponent(p.set_slug)}&limit=1`);
  if(active?.length){skipped++;continue}
  const next=new Date(Date.now()+Number(p.cadence_hours||24)*3600000).toISOString();
  const job={user_id:p.user_id,source:'marketplace',action:'scan_set',status:'queued',priority:20,required_capability:'marketplace_public_api',preferred_executor:'cloud_worker',payload_json:{profile:{setName:p.set_name,setSlug:p.set_slug,language:p.language||'English',printing:p.printing||'Both',condition:p.condition||'Near Mint',scanDepth:p.scan_depth||'Smart',salesEnrich:0},cloudPrimary:true,configuredSchedule:true,executionClass:'cloud_public'},progress_json:{stage:'queued',percent:0,detail:`Configured scan: ${p.set_name}`,updatedAt:now.toISOString()},attempt_count:0,max_attempts:2,available_at:now.toISOString()};
  await sb('collector_jobs',{method:'POST',body:[job],prefer:'return=minimal'});
  await sb(`marketplace_scan_profiles?user_id=eq.${encodeURIComponent(p.user_id)}&set_slug=eq.${encodeURIComponent(p.set_slug)}`,{method:'PATCH',body:{last_queued_at:now.toISOString(),next_due_at:next,updated_at:now.toISOString()},prefer:'return=minimal'});
  queued++;
}
console.log(JSON.stringify({due:(profiles||[]).length,queued,skipped},null,2));
