const U=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const K=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!U||!K)throw new Error('Missing Supabase worker configuration');
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const h={...H,...(prefer?{Prefer:prefer}:{})};const r=await fetch(`${U}/rest/v1/${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(d?.message||d?.hint||`Supabase HTTP ${r.status}`);return d}
const enc=v=>encodeURIComponent(String(v??''));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const KEY='android-agent-contract-v1';

async function reportPass(job){
  const events=await sb(`collector_job_events?job_id=eq.${enc(job.job_id)}`);
  const claimed=(events||[]).find(e=>e.event_type==='claimed');
  const completed=(events||[]).find(e=>e.event_type==='completed');
  console.log(`Android-agent probe PASS: ${job.job_id}; claimed_by=${job.claimed_by||claimed?.collector_id||'unknown'}; completed_event=${Boolean(completed)}; result=${job.progress_json?.detail||'completed'}`);
}

async function main(){
  const collectors=await sb('collectors?collector_type=eq.mobile_agent&platform=eq.android&order=last_seen_at.desc&limit=20');
  const eligible=(collectors||[]).find(c=>c?.capabilities_json?.tcgplayer_authenticated_session===true&&c?.session_health_json?.authenticated===true);
  if(!eligible){console.log('No eligible Android agent currently online; probe not queued.');return}
  const existing=await sb('collector_jobs?source=eq.agent&action=eq.auth_probe&order=created_at.desc&limit=30');
  let job=(existing||[]).find(j=>j?.payload_json?.probeKey===KEY&&j.user_id===eligible.user_id);
  if(job?.status==='completed'){await reportPass(job);return}
  if(!job||!['queued','claimed','running'].includes(job.status)){
    const now=new Date().toISOString();
    const created=await sb('collector_jobs',{method:'POST',body:[{user_id:eligible.user_id,source:'agent',action:'auth_probe',status:'queued',priority:5,required_capability:'tcgplayer_authenticated_session',preferred_executor:'android_agent',payload_json:{probeKey:KEY,purpose:'Validate Android authenticated-agent contract'},progress_json:{stage:'queued',percent:0,detail:'Waiting for Android agent',updatedAt:now},max_attempts:3}],prefer:'return=representation'});
    job=created?.[0];
    console.log(`Queued Android-agent probe ${job?.job_id||''}.`);
  } else console.log(`Android-agent probe already active: ${job.job_id} (${job.status}).`);
  const deadline=Date.now()+90000;
  while(Date.now()<deadline){
    const rows=await sb(`collector_jobs?job_id=eq.${enc(job.job_id)}&limit=1`);const cur=rows?.[0];if(!cur)throw new Error('Probe job disappeared');
    if(cur.status==='completed'){await reportPass(cur);return}
    if(cur.status==='failed')throw new Error(`Android-agent probe failed: ${cur.error_message||'unknown error'}`);
    await sleep(5000);
  }
  throw new Error(`Android-agent probe still pending after 90s: ${job.job_id}`);
}
await main();
