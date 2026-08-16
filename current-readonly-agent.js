(() => {
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const DRAIN_MAX=5;
  const BETWEEN_JOBS_MS=1000;
  let busy=false;

  const modernSession=()=>{
    try{return JSON.parse(localStorage.getItem('collectishSession')||'null')}catch{return null}
  };

  async function registerCollector(a,s,collectorId,version,state){
    const authenticated=state==='authenticated',now=new Date().toISOString();
    await rest('collectors?on_conflict=user_id,collector_id',{method:'POST',body:[{
      user_id:s.user.id,
      collector_id:collectorId,
      name:'Collectish Android',
      collector_type:'mobile_agent',
      platform:'android',
      last_seen_at:now,
      status:'online',
      app_version:version,
      capabilities_json:{
        tcgplayer_authenticated_session:authenticated,
        authenticated_agent:true,
        android_agent:true,
        seller_portal_readonly_probe:authenticated
      },
      session_health_json:{authenticated,state,checkedAt:now,provider:'tcgplayer'},
      metadata_json:{executionRole:'android_agent',claimant:'modern-readonly-agent'}
    }],prefer:'resolution=merge-duplicates,return=minimal'});
  }

  async function claimOne(collectorId){
    const claimed=await rest('rpc/claim_collector_job',{method:'POST',body:{
      p_source:'agent',
      p_action:'seller_portal_readonly_probe',
      p_preferred_executors:['android_agent'],
      p_required_capability:'tcgplayer_authenticated_session',
      p_collector_id:collectorId,
      p_lease_seconds:300
    }});
    return Array.isArray(claimed)?claimed[0]:(claimed?.job_id?claimed:null);
  }

  async function finish(job,collectorId,version,status,detail,readOnlyProbe,probeState){
    const completedAt=new Date().toISOString();
    const progress={stage:status==='completed'?'completed':'failed',percent:100,detail,updatedAt:completedAt,readOnlyProbe,probeState};
    await rest(`collector_jobs?job_id=eq.${encodeURIComponent(job.job_id)}`,{method:'PATCH',body:{
      status,
      completed_at:completedAt,
      lease_expires_at:null,
      progress_json:progress,
      error_message:status==='completed'?null:detail
    },prefer:'return=minimal'});
    await rest('collector_job_events',{method:'POST',body:[{
      job_id:job.job_id,
      user_id:job.user_id,
      event_type:status==='completed'?'completed':'failed',
      collector_id:collectorId,
      progress_json:progress,
      message:detail,
      metadata_json:{platform:'android',agentVersion:version,probeState,claimant:'modern-readonly-agent'}
    }],prefer:'return=minimal'});
  }

  async function processOne(job,ro,collectorId,version){
    const payload=job.payload_json||{};
    const config=payload.probe||payload.config||{};
    ro.startReadOnlyProbe(JSON.stringify(config));
    let state='starting';
    for(let i=0;i<80;i++){
      await wait(500);
      state=String(ro.getReadOnlyProbeState?.()||'unknown');
      if(state==='ready'||state==='error')break;
    }
    let probe={};
    try{probe=JSON.parse(String(ro.getReadOnlyProbeResult?.()||'{}'))}catch{probe={error:'Read-only probe JSON parse failed'}}
    if(state==='ready'){
      await finish(job,collectorId,version,'completed','Authenticated read-only Seller Portal probe completed',probe,state);
      return true;
    }
    await finish(job,collectorId,version,'failed',state==='error'?(probe.error||'Read-only Seller Portal probe failed'):'Read-only Seller Portal probe timed out',probe,state);
    return false;
  }

  async function run(){
    if(busy||typeof rest!=='function')return;
    const a=window.CollectishAndroid,ro=window.CollectishReadOnly,s=modernSession();
    if(!a||!ro||!s?.user?.id)return;
    if(typeof ro.startReadOnlyProbe!=='function'||typeof ro.getReadOnlyProbeState!=='function'||typeof ro.getReadOnlyProbeResult!=='function')return;

    const state=String(a.getSessionState?.()||'unknown');
    const collectorId=String(a.getCollectorId?.()||'');
    const version=String(a.getVersion?.()||'unknown');
    if(!collectorId)return;

    busy=true;
    let job=null;
    try{
      await registerCollector(a,s,collectorId,version,state);
      if(state!=='authenticated')return;

      let completed=0;
      for(let i=0;i<DRAIN_MAX;i++){
        job=await claimOne(collectorId);
        if(!job)break;
        const ok=await processOne(job,ro,collectorId,version);
        job=null;
        if(!ok)break;
        completed++;
        if(i<DRAIN_MAX-1)await wait(BETWEEN_JOBS_MS);
      }
      window.COLLECTISH_SELLER_AGENT_STATE={state,collectorId,version,lastRunAt:new Date().toISOString(),completed};
      if(completed>0)window.dispatchEvent(new Event('collectishAgentSessionChanged'));
    }catch(e){
      window.COLLECTISH_SELLER_AGENT_STATE={state:'error',collectorId,version,lastRunAt:new Date().toISOString(),error:String(e?.message||e)};
      if(job){
        try{await finish(job,collectorId,version,'failed',String(e?.message||e),{error:String(e?.message||e)},'exception')}catch{}
      }
    }finally{busy=false}
  }

  const kick=()=>run().catch(()=>{});
  setInterval(kick,15000);
  setTimeout(kick,1200);
  window.addEventListener('collectishAgentSessionChanged',()=>setTimeout(kick,100));
  window.addEventListener('pageshow',kick);
  window.addEventListener('focus',kick);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')kick()});
})();