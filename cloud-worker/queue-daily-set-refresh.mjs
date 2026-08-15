const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const h={...H,...(prefer?{Prefer:prefer}:{})};const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok)throw new Error(data?.message||data?.hint||`Supabase HTTP ${r.status}: ${String(text).slice(0,220)}`);return data}
async function allRows(path,pageSize=1000){const out=[];for(let from=0;;from+=pageSize){const sep=path.includes('?')?'&':'?';const rows=await sb(`${path}${sep}offset=${from}&limit=${pageSize}`);out.push(...(rows||[]));if(!rows||rows.length<pageSize)break;}return out}
function chicagoDay(value){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
const nowMs=Date.now();
const today=chicagoDay(nowMs);
const recentCatchupCutoff=nowMs-(12*60*60*1000);
const scans=await allRows('marketplace_scans?select=user_id,set_slug,set_name,printing,condition,language,profile_json,captured_at&set_slug=not.is.null&order=captured_at.desc');
const latest=new Map();const completedToday=new Set();
for(const s of scans){const key=`${s.user_id}|${s.set_slug}`;if(!latest.has(key))latest.set(key,s);if(chicagoDay(s.captured_at)===today)completedToday.add(key)}

// Active work always blocks a duplicate. A failed daily job from today also blocks one:
// the failure-recovery step later in the same workflow will either retry it in cloud or
// create exactly one browser fallback. Recent catch-up work also blocks the normal daily
// queue across the Chicago-midnight boundary so an overnight catch-up does not cause a
// second scan of the same set minutes later just because the calendar day rolled over.
const existing=await allRows('collector_jobs?select=user_id,status,payload_json,created_at,completed_at&source=eq.marketplace&action=eq.scan_set&status=in.(queued,claimed,running,failed,completed)');
const coveredByJob=new Set();
for(const j of existing){
  const slug=j.payload_json?.profile?.setSlug;if(!slug)continue;
  const key=`${j.user_id}|${slug}`;
  if(['queued','claimed','running'].includes(j.status)){coveredByJob.add(key);continue;}
  const isDaily=Boolean(j.payload_json?.dailyAutoSync||j.payload_json?.dailyCatchup);
  if(j.status==='failed'&&isDaily&&j.created_at&&chicagoDay(j.created_at)===today){coveredByJob.add(key);continue;}
  const isRecentCatchup=Boolean(j.payload_json?.dailyCatchup)&&j.created_at&&new Date(j.created_at).getTime()>=recentCatchupCutoff;
  if(isRecentCatchup&&['completed','failed'].includes(j.status))coveredByJob.add(key);
}

const jobs=[];
for(const [key,s] of latest){if(completedToday.has(key)||coveredByJob.has(key))continue;const p=s.profile_json||{};const sales=Number(p.salesEnrich);jobs.push({user_id:s.user_id,source:'marketplace',action:'scan_set',status:'queued',priority:30,required_capability:'marketplace_public_api',preferred_executor:'cloud_worker',payload_json:{profile:{setName:s.set_name,setSlug:s.set_slug,language:s.language||'English',printing:s.printing||'Both',condition:s.condition||'Near Mint',scanDepth:p.scanDepthRequested||p.scanDepth||'Smart',salesEnrich:Number.isFinite(sales)?sales:50},cloudPrimary:true,dailyAutoSync:true,executionClass:'cloud_public',sourceCapturedAt:s.captured_at},progress_json:{stage:'queued',percent:0,detail:'Daily one-scan-per-set refresh using latest settings',updatedAt:new Date().toISOString()},attempt_count:0,max_attempts:2,available_at:new Date().toISOString()})}
if(jobs.length)await sb('collector_jobs',{method:'POST',body:jobs,prefer:'return=minimal'});
console.log(`Daily set refresh ${today} America/Chicago: ${latest.size} historical user/set pairs, ${completedToday.size} already scanned today, ${coveredByJob.size} covered by queued/running/today-failed/recent-catchup jobs, ${jobs.length} newly queued.`);
