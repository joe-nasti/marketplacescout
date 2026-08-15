(() => {
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  let busy=false;

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
      metadata_json:{platform:'android',agentVersion:version,probeState}
    }],prefer:'return=minimal'});
  }

  async function run(){
    if(busy||typeof rest!=='function'||typeof session!=='function')return;
    const a=window.CollectishAndroid,ro=window.CollectishReadOnly,s=session();
    if(!a||!ro||!s?.user?.id)return;
    if(typeof ro.startReadOnlyProbe!=='function'||typeof ro.getReadOnlyProbeState!=='function'||typeof ro.getReadOnlyProbeResult!=='function')return;
    if(String(a.getSessionState?.()||'unknown')!=='authenticated')return;
    busy=true;
    let job=null;
    try{
      const collectorId=String(a.getCollectorId()),version=String(a.getVersion());
      job=await claimOne(collectorId);
      if(!job)return;
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
      }else{
        await finish(job,collectorId,version,'failed',state==='error'?(probe.error||'Read-only Seller Portal probe failed'):'Read-only Seller Portal probe timed out',probe,state);
      }
      window.dispatchEvent(new Event('collectishAgentSessionChanged'));
    }catch(e){
      if(job){
        try{
          const collectorId=String(a.getCollectorId()),version=String(a.getVersion());
          await finish(job,collectorId,version,'failed',String(e?.message||e),{error:String(e?.message||e)},'exception');
        }catch{}
      }
    }finally{busy=false}
  }

  const kick=()=>run().catch(()=>{});
  setInterval(kick,30000);
  setTimeout(kick,1800);
  window.addEventListener('collectishAgentSessionChanged',()=>setTimeout(kick,100));
  window.addEventListener('pageshow',kick);
  window.addEventListener('focus',kick);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')kick()});
})();
