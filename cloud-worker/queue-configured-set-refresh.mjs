const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(d?.message||`Supabase ${r.status}: ${String(t).slice(0,240)}`);return d}

const now=new Date();
const nowIso=now.toISOString();

// Profiles own stable phase slots inside their cadence window. Never turn a group of
// overdue profiles into a backlog: queue at most one configured scan per scheduler pass.
const profiles=await sb(`marketplace_scan_profiles?select=*&enabled=eq.true&or=(next_due_at.is.null,next_due_at.lte.${encodeURIComponent(nowIso)})&order=next_due_at.asc.nullsfirst,set_slug.asc&limit=25`);
let queued=0,skipped=0,initialized=0;

function advanceSlot(p){
  const cadenceMs=Math.max(1,Number(p.cadence_hours||24))*3600000;
  let t=p.next_due_at?new Date(p.next_due_at).getTime():NaN;
  if(!Number.isFinite(t)){
    const offMs=Math.max(0,Number(p.schedule_offset_minutes||0))*60000;
    t=Date.now()+offMs;
  }
  while(t<=Date.now())t+=cadenceMs;
  return new Date(t).toISOString();
}

for(const p of profiles||[]){
  // A newly added/rebalanced profile can have no next_due_at yet. Give it its stored
  // phase slot first rather than immediately joining the queue with every other new set.
  if(!p.next_due_at){
    const first=new Date(Date.now()+Math.max(0,Number(p.schedule_offset_minutes||0))*60000).toISOString();
    await sb(`marketplace_scan_profiles?user_id=eq.${encodeURIComponent(p.user_id)}&set_slug=eq.${encodeURIComponent(p.set_slug)}`,{method:'PATCH',body:{next_due_at:first,updated_at:nowIso},prefer:'return=minimal'});
    initialized++;
    if(new Date(first)>now)continue;
  }

  const sameSet=await sb(`collector_jobs?select=job_id,status&user_id=eq.${encodeURIComponent(p.user_id)}&source=eq.marketplace&action=eq.scan_set&status=in.(queued,claimed,running)&payload_json->profile->>setSlug=eq.${encodeURIComponent(p.set_slug)}&limit=1`);
  if(sameSet?.length){skipped++;continue}

  // Do not build a serial configured-scan backlog. If one scheduled profile is already
  // waiting/running for this user, let it finish before another due slot is admitted.
  const scheduledActive=await sb(`collector_jobs?select=job_id,status&user_id=eq.${encodeURIComponent(p.user_id)}&source=eq.marketplace&action=eq.scan_set&status=in.(queued,claimed,running)&payload_json->>configuredSchedule=eq.true&limit=1`);
  if(scheduledActive?.length){skipped++;break}

  const next=advanceSlot(p);
  const job={user_id:p.user_id,source:'marketplace',action:'scan_set',status:'queued',priority:20,required_capability:'marketplace_public_api',preferred_executor:'cloud_worker',payload_json:{profile:{setName:p.set_name,setSlug:p.set_slug,language:p.language||'English',printing:p.printing||'Both',condition:p.condition||'Near Mint',scanDepth:p.scan_depth||'Smart',salesEnrich:0},cloudPrimary:true,configuredSchedule:true,executionClass:'cloud_public',scheduledFor:p.next_due_at||nowIso},progress_json:{stage:'queued',percent:0,detail:`Configured scan: ${p.set_name}`,updatedAt:nowIso},attempt_count:0,max_attempts:2,available_at:nowIso};
  await sb('collector_jobs',{method:'POST',body:[job],prefer:'return=minimal'});
  await sb(`marketplace_scan_profiles?user_id=eq.${encodeURIComponent(p.user_id)}&set_slug=eq.${encodeURIComponent(p.set_slug)}`,{method:'PATCH',body:{last_queued_at:nowIso,next_due_at:next,updated_at:nowIso},prefer:'return=minimal'});
  queued++;
  break;
}
console.log(JSON.stringify({due:(profiles||[]).length,queued,skipped,initialized,mode:'staggered-one-at-a-time'},null,2));
