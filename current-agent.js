(() => {
  const el=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>\"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  const ago=iso=>{if(!iso)return 'never';const m=Math.max(0,Math.round((Date.now()-new Date(iso))/60000));return m<1?'now':m<60?`${m}m ago`:m<1440?`${Math.round(m/60)}h ago`:`${Math.round(m/1440)}d ago`};
  async function load(){
    const host=el('agentStatusBody');if(!host)return;
    try{
      const collectors=await rest('collectors?select=name,collector_type,platform,last_seen_at,app_version,capabilities_json,session_health_json&collector_type=in.(browser_connector,mobile_agent)&order=last_seen_at.desc&limit=20');
      const freshAndroid=(collectors||[]).find(c=>c.collector_type==='mobile_agent'&&c.platform==='android');
      const browsers=(collectors||[]).filter(c=>c.collector_type==='browser_connector').slice(0,3);
      const cards=[...(freshAndroid?[freshAndroid]:[]),...browsers].slice(0,4).map(c=>{const s=c?.session_health_json||{},cap=c?.capabilities_json||{},ready=Boolean(s.authenticated&&cap.tcgplayer_authenticated_session);return `<div class="collectish-health-card"><span>${c.collector_type==='mobile_agent'?'Android agent':'Browser agent'}</span><strong>${esc(c?.name||'Unknown agent')}</strong><small>${esc(c?.app_version||'')} ${c?.last_seen_at?'• '+ago(c.last_seen_at):''}</small><div class="meta">${ready?'Authenticated • Eligible':'Session '+esc(s.state||'unknown')}</div></div>`}).join('');
      host.innerHTML=`<div class="collectish-health-grid">${cards||'<div class="collectish-health-card"><span>Agent</span><strong>No authenticated agent</strong></div>'}</div>`;
    }catch(e){host.innerHTML=`<div class="collectish-empty">${esc(e.message)}</div>`}
  }
  async function queueSellerSnapshot(){
    const a=window.CollectishAndroid,s=typeof session==='function'?session():null,msg=el('sellerSnapshotMsg');
    if(!a||!s?.user?.id){if(msg)msg.textContent='Open this page in the Collectish Android app and sign in first.';return}
    try{
      const now=new Date().toISOString();
      await rest('collector_jobs',{method:'POST',body:[{user_id:s.user.id,source:'agent',action:'seller_portal_snapshot',status:'queued',priority:5,required_capability:'seller_portal_snapshot',preferred_executor:'android_agent',payload_json:{purpose:'Read-only Seller Portal page snapshot'},progress_json:{stage:'queued',percent:0,detail:'Waiting for Android Seller Portal session',updatedAt:now},max_attempts:3}],prefer:'return=minimal'});
      if(msg)msg.textContent='Queued. Android will collect the signed-in Seller Portal snapshot on its next heartbeat.';
      setTimeout(()=>androidHeartbeat().catch(()=>{}),50);
    }catch(e){if(msg)msg.textContent=String(e?.message||e)}
  }
  function install(){
    const anchor=el('collectishConnectorRole');if(!anchor||el('collectishAgentStatus'))return false;
    const panel=document.createElement('section');panel.id='collectishAgentStatus';panel.className='card collectish-ops-panel';panel.dataset.collectishPage='operations';
    panel.innerHTML='<div class="toolbar"><div><h2>Authenticated agents</h2><div class="meta">Live desktop and Android session health.</div></div><button id="refreshAgentStatus" type="button">Refresh</button></div><div id="agentStatusBody"><div class="meta">Loading agent status…</div></div><div style="margin-top:12px"><button id="collectSellerSnapshot" type="button">Collect Seller Portal snapshot</button><div id="sellerSnapshotMsg" class="meta" style="margin-top:6px">Read-only bootstrap collector: page title, path, session state, and visible Seller Portal sections only.</div></div>';
    anchor.insertAdjacentElement('afterend',panel);el('refreshAgentStatus').onclick=load;el('collectSellerSnapshot').onclick=queueSellerSnapshot;load();return true;
  }
  document.addEventListener('click',e=>{if(e.target?.dataset?.page==='operations')setTimeout(load,150)},true);
  let tries=0;const timer=setInterval(()=>{tries++;if(install()||tries>160)clearInterval(timer)},100);

  const android=()=>window.CollectishAndroid||null;
  let heartbeatBusy=false;
  async function claimOne(a,collectorId,action,capability){
    const claimed=await rest('rpc/claim_collector_job',{method:'POST',body:{p_source:'agent',p_action:action,p_preferred_executors:['android_agent'],p_required_capability:capability,p_collector_id:collectorId,p_lease_seconds:300}});
    return Array.isArray(claimed)?claimed[0]:(claimed?.job_id?claimed:null);
  }
  async function completeJob(job,collectorId,version,detail,extra={}){
    const completedAt=new Date().toISOString(),progress={stage:'completed',percent:100,detail,updatedAt:completedAt,...extra};
    await rest(`collector_jobs?job_id=eq.${encodeURIComponent(job.job_id)}`,{method:'PATCH',body:{status:'completed',completed_at:completedAt,lease_expires_at:null,progress_json:progress,error_message:null},prefer:'return=minimal'});
    await rest('collector_job_events',{method:'POST',body:[{job_id:job.job_id,user_id:job.user_id,event_type:'completed',collector_id:collectorId,progress_json:progress,message:detail,metadata_json:{platform:'android',agentVersion:version,...extra}}],prefer:'return=minimal'});
  }
  async function androidHeartbeat(){
    if(heartbeatBusy)return;
    const a=android();if(!a||typeof rest!=='function'||typeof session!=='function')return;
    const s=session();if(!s?.user?.id)return;
    heartbeatBusy=true;
    const collectorId=String(a.getCollectorId()),version=String(a.getVersion()),state=String(a.getSessionState()),authenticated=state==='authenticated',now=new Date().toISOString();
    try{
      await rest('collectors?on_conflict=user_id,collector_id',{method:'POST',body:[{user_id:s.user.id,collector_id:collectorId,name:'Collectish Android',collector_type:'mobile_agent',platform:'android',last_seen_at:now,status:'online',app_version:version,capabilities_json:{tcgplayer_authenticated_session:authenticated,authenticated_agent:true,android_agent:true,seller_portal_snapshot:authenticated},session_health_json:{authenticated,state,checkedAt:now,provider:'tcgplayer'},metadata_json:{executionRole:'android_agent'}}],prefer:'resolution=merge-duplicates,return=minimal'});
      if(!authenticated)return;
      const probe=await claimOne(a,collectorId,'auth_probe','tcgplayer_authenticated_session');
      if(probe)await completeJob(probe,collectorId,version,'Authenticated TCGplayer session confirmed on Android');
      const snapJob=await claimOne(a,collectorId,'seller_portal_snapshot','seller_portal_snapshot');
      if(snapJob){
        let snapshot={};try{snapshot=JSON.parse(String(a.getSellerPortalSnapshot?.()||'{}'))}catch{snapshot={error:'Snapshot parse failed'}}
        await completeJob(snapJob,collectorId,version,'Read-only Seller Portal snapshot collected',{snapshot});
        const msg=el('sellerSnapshotMsg');if(msg)msg.textContent=`Collected: ${snapshot.title||'Seller Portal'} ${snapshot.path||''}`;
      }
      setTimeout(load,150);
    }catch(e){
      try{await rest(`collectors?user_id=eq.${encodeURIComponent(s.user.id)}&collector_id=eq.${encodeURIComponent(collectorId)}`,{method:'PATCH',body:{session_health_json:{authenticated,state,checkedAt:new Date().toISOString(),provider:'tcgplayer',lastAgentError:String(e?.message||e)}},prefer:'return=minimal'})}catch{}
      throw e;
    }finally{heartbeatBusy=false}
  }
  const kick=()=>androidHeartbeat().catch(()=>{});
  setInterval(kick,30000);setTimeout(kick,1200);window.addEventListener('collectishAgentSessionChanged',()=>setTimeout(kick,50));window.addEventListener('pageshow',kick);window.addEventListener('focus',kick);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')kick()});
})();
