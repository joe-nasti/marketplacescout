const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(d?.message||`Supabase ${r.status}: ${String(t).slice(0,240)}`);return d}

const now=new Date();
const nowIso=now.toISOString();

async function marketplaceHealthGate(){
  const windowHours=3;
  const since=new Date(Date.now()-windowHours*3600000).toISOString();
  const recent=await sb(`collector_jobs?select=status,error_message,created_at,completed_at,progress_json,payload_json&source=eq.marketplace&action=eq.scan_set&completed_at=gte.${encodeURIComponent(since)}&status=in.(completed,failed)&order=completed_at.desc&limit=250`);
  const all=recent||[];
  const recoveryCanary=all.find(x=>x.status==='completed'&&x.progress_json?.circuitBreakerCanary===true&&x.payload_json?.profile?.tcgSetSlug);
  const boundary=recoveryCanary?.completed_at?new Date(recoveryCanary.completed_at).getTime():null;
  const terminal=boundary?all.filter(x=>new Date(x.completed_at||0).getTime()>=boundary):all;
  const failed=terminal.filter(x=>x.status==='failed');
  const completed=terminal.filter(x=>x.status==='completed');
  const http500=failed.filter(x=>/HTTP 500 .*tcgplayer\.com/i.test(String(x.error_message||''))).length;
  const setMismatch=failed.filter(x=>/Set filter mismatch/i.test(String(x.error_message||''))).length;
  const failureRate=terminal.length?failed.length/terminal.length:0;
  const open=(setMismatch>=2)||(http500>=5)||(terminal.length>=6&&failureRate>=0.40);
  return {open,windowHours,terminal:terminal.length,failed:failed.length,completed:completed.length,http500,setMismatch,failureRate:Number(failureRate.toFixed(3)),recoveryCanaryAt:recoveryCanary?.completed_at||null,checkedAt:nowIso};
}

async function releasePausedBacklog(limit=2){
  const paused=await sb(`collector_jobs?select=job_id,progress_json&source=eq.marketplace&action=eq.scan_set&status=eq.queued&progress_json->>pausedBy=eq.marketplace_circuit_breaker&available_at=gt.${encodeURIComponent(nowIso)}&order=created_at.asc&limit=${limit}`);
  let released=0;
  for(const j of paused||[]){
    await sb(`collector_jobs?job_id=eq.${encodeURIComponent(j.job_id)}&status=eq.queued`,{method:'PATCH',body:{available_at:nowIso,progress_json:{...(j.progress_json||{}),stage:'queued',detail:'Released after successful circuit-breaker canary',releasedAt:nowIso}},prefer:'return=minimal'});
    released++;
  }
  return released;
}

const health=await marketplaceHealthGate();
if(health.open){
  console.error(JSON.stringify({admission:'paused',reason:'marketplace_circuit_breaker',health},null,2));
  process.exit(0);
}
const releasedPaused=await releasePausedBacklog(2);

// Profiles own stable phase slots inside their cadence window. Never turn a group of
// overdue profiles into a backlog: queue at most one configured scan per scheduler pass.
const profiles=await sb(`marketplace_scan_profiles?select=*&enabled=eq.true&or=(next_due_at.is.null,next_due_at.lte.${encodeURIComponent(nowIso)})&order=next_due_at.asc.nullsfirst,set_slug.asc&limit=25`);
let queued=0,skipped=0,initialized=0,unresolved=0;

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
function runnable(j){
  if(!j)return false;
  if(j.status==='claimed'||j.status==='running')return true;
  if(j.status!=='queued')return false;
  return !j.available_at||new Date(j.available_at)<=now;
}

for(const p of profiles||[]){
  if(!p.next_due_at){
    const first=new Date(Date.now()+Math.max(0,Number(p.schedule_offset_minutes||0))*60000).toISOString();
    await sb(`marketplace_scan_profiles?user_id=eq.${encodeURIComponent(p.user_id)}&set_slug=eq.${encodeURIComponent(p.set_slug)}`,{method:'PATCH',body:{next_due_at:first,updated_at:nowIso},prefer:'return=minimal'});
    initialized++;
    if(new Date(first)>now)continue;
  }

  // Scan-time identity is a pure cache lookup. The numeric TCG set id -> canonical
  // urlName mapping is refreshed only by the bi-weekly TCG set catalog job.
  let tcgSlug='';
  if(p.tcgplayer_group_id){
    const idRows=await sb(`tcgplayer_set_identity_cache?select=url_name&tcgplayer_group_id=eq.${encodeURIComponent(p.tcgplayer_group_id)}&limit=1`);
    tcgSlug=String(idRows?.[0]?.url_name||'').trim();
  }
  if(!tcgSlug){
    const next=advanceSlot(p);
    await sb(`marketplace_scan_profiles?user_id=eq.${encodeURIComponent(p.user_id)}&set_slug=eq.${encodeURIComponent(p.set_slug)}`,{method:'PATCH',body:{next_due_at:next,updated_at:nowIso},prefer:'return=minimal'});
    unresolved++;
    console.warn(`Configured scan deferred: no cached TCG set identity for ${p.set_name} (${p.tcgplayer_group_id||'no group id'})`);
    continue;
  }

  const sameSet=await sb(`collector_jobs?select=job_id,status,available_at&user_id=eq.${encodeURIComponent(p.user_id)}&source=eq.marketplace&action=eq.scan_set&status=in.(queued,claimed,running)&payload_json->profile->>setSlug=eq.${encodeURIComponent(p.set_slug)}&limit=20`);
  if((sameSet||[]).some(runnable)){skipped++;continue}

  const scheduledActive=await sb(`collector_jobs?select=job_id,status,available_at&user_id=eq.${encodeURIComponent(p.user_id)}&source=eq.marketplace&action=eq.scan_set&status=in.(queued,claimed,running)&payload_json->>configuredSchedule=eq.true&limit=50`);
  if((scheduledActive||[]).some(runnable)){skipped++;break}

  const next=advanceSlot(p);
  const job={user_id:p.user_id,source:'marketplace',action:'scan_set',status:'queued',priority:20,required_capability:'marketplace_public_api',preferred_executor:'cloud_worker',payload_json:{profile:{setName:p.set_name,setSlug:p.set_slug,tcgSetSlug:tcgSlug,tcgplayerGroupId:p.tcgplayer_group_id,language:p.language||'English',printing:p.printing||'Both',condition:p.condition||'Near Mint',scanDepth:p.scan_depth||'Smart',salesEnrich:0},cloudPrimary:true,cloudOnly:true,pcFallback:false,pcFallbackQueued:false,configuredSchedule:true,executionClass:'cloud_public',scheduledFor:p.next_due_at||nowIso},progress_json:{stage:'queued',percent:0,detail:`Configured scan: ${p.set_name}`,updatedAt:nowIso},attempt_count:0,max_attempts:2,available_at:nowIso};
  await sb('collector_jobs',{method:'POST',body:[job],prefer:'return=minimal'});
  await sb(`marketplace_scan_profiles?user_id=eq.${encodeURIComponent(p.user_id)}&set_slug=eq.${encodeURIComponent(p.set_slug)}`,{method:'PATCH',body:{last_queued_at:nowIso,next_due_at:next,updated_at:nowIso},prefer:'return=minimal'});
  queued++;
  break;
}
console.log(JSON.stringify({due:(profiles||[]).length,queued,skipped,initialized,unresolved,releasedPaused,health,mode:'staggered-one-runnable-at-a-time',setIdentity:'biweekly-tcg-id-cache'},null,2));
