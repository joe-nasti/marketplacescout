const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
const now=new Date(),nowIso=now.toISOString();
const enc=v=>encodeURIComponent(String(v??''));
const STALL_MS=15*60*1000;

async function sb(path,{method='GET',body,prefer}={}){
  const response=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{
    method,
    headers:{...H,...(prefer?{Prefer:prefer}:{})},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const text=await response.text();
  let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!response.ok)throw new Error(data?.message||data?.hint||`Supabase ${response.status}: ${String(text).slice(0,220)}`);
  return data;
}

async function sellerUsers(){
  const rows=await sb('seller_orders?select=user_id&order=order_date.desc&limit=5000');
  return [...new Set((rows||[]).map(r=>r.user_id).filter(Boolean))];
}

async function existing(uid,key){
  const rows=await sb(`collectish_alerts?select=*&user_id=eq.${enc(uid)}&alert_key=eq.${enc(key)}&limit=1`);
  return rows?.[0]||null;
}

async function upsertAlert(uid,key,{severity,title,message,metadata={}}){
  const old=await existing(uid,key);
  if(!old){
    await sb('collectish_alerts',{method:'POST',body:[{
      user_id:uid,alert_key:key,category:'operational',severity,title,message,
      action_screen:'admin',metadata_json:metadata,first_seen_at:nowIso,last_seen_at:nowIso,
      updated_at:nowIso,occurrence:1
    }],prefer:'return=minimal'});
    return 'opened';
  }
  const reopened=Boolean(old.resolved_at);
  await sb(`collectish_alerts?id=eq.${enc(old.id)}`,{method:'PATCH',body:{
    category:'operational',severity,title,message,action_screen:'admin',metadata_json:metadata,
    last_seen_at:nowIso,resolved_at:null,updated_at:nowIso,
    ...(reopened?{first_seen_at:nowIso,occurrence:Number(old.occurrence||1)+1}:{})
  },prefer:'return=minimal'});
  return reopened?'reopened':'active';
}

async function resolveAlert(uid,key){
  await sb(`collectish_alerts?user_id=eq.${enc(uid)}&alert_key=eq.${enc(key)}&resolved_at=is.null`,{
    method:'PATCH',body:{resolved_at:nowIso,updated_at:nowIso},prefer:'return=minimal'
  });
}

async function pendingResults(uid){
  return await sb(`collector_jobs?select=job_id,completed_at,payload_json&user_id=eq.${enc(uid)}&source=eq.agent&action=eq.seller_portal_readonly_probe&status=eq.completed&payload_json->>sellerHistoryKind=in.(auth_detail,order_search,order_detail)&progress_json->>orchestratedAt=is.null&order=completed_at.asc&limit=250`);
}

const ALERT_KEY='ops:seller-orchestrator-stalled';
const users=await sellerUsers();
const summary=[];
for(const uid of users){
  const rows=await pendingResults(uid);
  const oldest=rows?.[0]?.completed_at||null;
  const ageMs=oldest?Math.max(0,Date.now()-new Date(oldest).getTime()):0;
  const stalled=Boolean(rows?.length)&&ageMs>=STALL_MS;
  const counts={auth:0,search:0,detail:0};
  for(const row of rows||[]){
    const kind=row.payload_json?.sellerHistoryKind;
    if(kind==='auth_detail')counts.auth++;
    else if(kind==='order_search')counts.search++;
    else if(kind==='order_detail')counts.detail++;
  }
  if(stalled){
    const ageMinutes=Math.max(1,Math.round(ageMs/60000));
    const severity=ageMs>=30*60*1000?'critical':'warning';
    await upsertAlert(uid,ALERT_KEY,{
      severity,
      title:'Seller cloud normalization is delayed',
      message:`${rows.length} completed Seller result${rows.length===1?' is':'s are'} waiting for cloud orchestration; the oldest has waited about ${ageMinutes} minutes.`,
      metadata:{pending:rows.length,oldestCompletedAt:oldest,ageMinutes,...counts}
    });
  }else{
    await resolveAlert(uid,ALERT_KEY);
  }
  summary.push({userId:uid,pending:rows?.length||0,oldest,ageMinutes:oldest?Math.round(ageMs/60000):0,stalled,counts});
}
console.log(JSON.stringify({checkedAt:nowIso,users:summary},null,2));
