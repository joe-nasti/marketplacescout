const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(d?.message||`Supabase ${r.status}: ${String(t).slice(0,260)}`);return d}
const nowIso=new Date().toISOString();

async function users(){
  const [profiles,captures]=await Promise.all([
    sb('marketplace_scan_profiles?select=user_id&limit=1000').catch(()=>[]),
    sb('source_captures?select=user_id&order=captured_at.desc&limit=1000').catch(()=>[])
  ]);
  return [...new Set([...(profiles||[]),...(captures||[])].map(x=>x.user_id).filter(Boolean))];
}
async function reconcile(){
  const jobs=await sb('collector_jobs?select=job_id,user_id,status,completed_at,error_message,payload_json&source=eq.marketplace&action=eq.scan_set&payload_json->>scoutUniverse=eq.true&status=in.(completed,failed)&order=completed_at.desc&limit=100').catch(()=>[]);
  let updated=0;
  for(const j of jobs||[]){
    const code=String(j.payload_json?.universeSetCode||'').trim();if(!code)continue;
    const state=j.status==='completed'?'completed':'failed';
    await sb(`scout_universe_set_state?user_id=eq.${encodeURIComponent(j.user_id)}&set_code=eq.${encodeURIComponent(code)}`,{method:'PATCH',body:{status:state,last_attempted_at:j.completed_at||nowIso,completed_at:state==='completed'?(j.completed_at||nowIso):null,last_job_id:j.job_id,updated_at:nowIso},prefer:'return=minimal'}).catch(()=>null);
    updated++;
  }
  return updated;
}
async function activeUniverseJob(){
  const rows=await sb('collector_jobs?select=job_id,status,payload_json&source=eq.marketplace&action=eq.scan_set&status=in.(queued,claimed,running)&payload_json->>scoutUniverse=eq.true&limit=1').catch(()=>[]);
  return rows?.[0]||null;
}
async function setInfo(code){
  const rows=await sb(`magic_set_catalog?select=code,name,tcgplayer_name,tcgplayer_group_id,tcgplayer_slug,digital&code=eq.${encodeURIComponent(code)}&limit=1`);
  return rows?.[0]||null;
}
async function firstWake(){
  const q=await sb('scout_refresh_queue?select=queue_id,user_id,sku_id,reason,priority,requested_at&status=eq.queued&order=priority.desc,requested_at.asc&limit=1').catch(()=>[]);
  const wake=q?.[0];if(!wake)return null;
  const cat=await sb(`scout_card_catalog?select=sku_id,set_code,card_name,product_id&sku_id=eq.${encodeURIComponent(wake.sku_id)}&limit=1`).catch(()=>[]);
  return cat?.[0]?{wake,card:cat[0]}:null;
}
async function queueSet({userId,set,reason,priority,wakeQueueId=null}){
  const code=String(set.code||'').trim();const setName=String(set.tcgplayer_name||set.name||code).trim();
  const job={user_id:userId,source:'marketplace',action:'scan_set',status:'queued',priority,required_capability:'marketplace_public_api',preferred_executor:'cloud_worker',payload_json:{profile:{setName,setSlug:code,tcgSetSlug:set.tcgplayer_slug,tcgplayerGroupId:set.tcgplayer_group_id,language:'English',printing:'Both',condition:'Near Mint',scanDepth:'Full',salesEnrich:0},cloudPrimary:true,cloudOnly:true,pcFallback:false,configuredSchedule:false,scoutUniverse:true,scoutUniverseReason:reason,universeSetCode:code,wakeQueueId},progress_json:{stage:'queued',percent:0,detail:`Scout universe ${reason}: ${setName}`,updatedAt:nowIso},attempt_count:0,max_attempts:2,available_at:nowIso};
  const created=await sb('collector_jobs',{method:'POST',body:[job],prefer:'return=representation'});const jobId=created?.[0]?.job_id||null;
  await sb('scout_universe_set_state?on_conflict=user_id,set_code',{method:'POST',body:[{user_id:userId,set_code:code,status:'queued',first_queued_at:nowIso,last_attempted_at:nowIso,last_job_id:jobId,updated_at:nowIso}],prefer:'resolution=merge-duplicates,return=minimal'});
  return jobId;
}

const catalogProbe=await sb('scout_card_catalog?select=sku_id,cataloged_at&order=cataloged_at.desc&limit=1').catch(()=>[]);
if(!catalogProbe?.length)await sb('rpc/sync_scout_card_catalog',{method:'POST',body:{}});
const reconciled=await reconcile();
const active=await activeUniverseJob();
if(active){console.log(JSON.stringify({ok:true,queued:false,reason:'universe_job_active',job_id:active.job_id,reconciled},null,2));process.exit(0)}

const wake=await firstWake();
if(wake){
  const set=await setInfo(wake.card.set_code);
  if(set&&!set.digital&&set.tcgplayer_slug&&set.tcgplayer_group_id){
    const jobId=await queueSet({userId:wake.wake.user_id,set,reason:`wake:${wake.wake.reason||'signal'}`,priority:Math.max(60,Number(wake.wake.priority||70)),wakeQueueId:wake.wake.queue_id});
    console.log(JSON.stringify({ok:true,queued:true,mode:'wake',job_id:jobId,set:set.code,card:wake.card.card_name,reconciled},null,2));process.exit(0)
  }
}

for(const userId of await users()){
  const next=await sb('rpc/next_scout_universe_set',{method:'POST',body:{p_user_id:userId}}).catch(()=>[]);
  const n=next?.[0];if(!n)continue;
  const set={code:n.set_code,name:n.set_name,tcgplayer_slug:n.tcgplayer_slug,tcgplayer_group_id:n.tcgplayer_group_id};
  const jobId=await queueSet({userId,set,reason:'cold-baseline',priority:5});
  console.log(JSON.stringify({ok:true,queued:true,mode:'cold-baseline',job_id:jobId,set:n.set_code,catalog_cards:n.catalog_cards,evaluated_cards:n.evaluated_cards,reconciled},null,2));process.exit(0)
}
console.log(JSON.stringify({ok:true,queued:false,reason:'universe_complete_or_no_routable_sets',reconciled},null,2));