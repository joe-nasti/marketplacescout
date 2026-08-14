(() => {
  const el=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>\"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  const ago=iso=>{if(!iso)return 'never';const m=Math.max(0,Math.round((Date.now()-new Date(iso))/60000));return m<1?'now':m<60?`${m}m ago`:m<1440?`${Math.round(m/60)}h ago`:`${Math.round(m/1440)}d ago`};
  const pretty=o=>JSON.stringify(o??{},null,2);
  const wait=ms=>new Promise(r=>setTimeout(r,ms));

  async function loadLatestSellerSnapshot(){
    const host=el('sellerSnapshotLatest');if(!host)return;
    try{
      const rows=await rest('collector_jobs?select=job_id,status,completed_at,progress_json,error_message&action=eq.seller_portal_snapshot&status=eq.completed&order=completed_at.desc&limit=1');
      const job=Array.isArray(rows)?rows[0]:null,snap=job?.progress_json?.snapshot;
      if(!job||!snap){host.innerHTML='<div class="meta">No completed Seller Portal snapshot yet.</div>';return}
      const sections=Array.isArray(snap.visibleSections)?snap.visibleSections:[];
      const sessionOk=Boolean(snap.sellerNav&&!snap.passwordField&&!snap.loginText);
      host.innerHTML=`<div class="collectish-health-grid" style="margin-top:10px"><div class="collectish-health-card"><span>Latest snapshot</span><strong>${esc(snap.title||'Seller Portal')}</strong><small>${job.completed_at?ago(job.completed_at):''}</small><div class="meta">${sessionOk?'Authenticated Seller Portal':'Session state uncertain'}</div></div><div class="collectish-health-card"><span>Captured sections</span><strong>${sections.length}</strong><small>${esc(sections.join(' • ')||'None detected')}</small><div class="meta">${esc(snap.path||'')}</div></div></div><details style="margin-top:10px"><summary>View snapshot JSON</summary><pre style="white-space:pre-wrap;word-break:break-word;margin:8px 0 0">${esc(pretty(snap))}</pre></details>`;
    }catch(e){host.innerHTML=`<div class="collectish-empty">${esc(e.message)}</div>`}
  }

  async function loadLatestSellerOrdersProbe(){
    const host=el('sellerOrdersLatest');if(!host)return;
    try{
      const rows=await rest('collector_jobs?select=job_id,status,completed_at,progress_json,error_message&action=eq.seller_portal_orders_probe&order=created_at.desc&limit=1');
      const job=Array.isArray(rows)?rows[0]:null,probe=job?.progress_json?.ordersProbe;
      if(!job){host.innerHTML='<div class="meta">No Seller Orders probe yet.</div>';return}
      if(job.status!=='completed'||!probe){host.innerHTML=`<div class="meta">Latest Orders probe: ${esc(job.status||'unknown')}${job.error_message?' • '+esc(job.error_message):''}</div>`;return}
      const counts=probe.counts||{},tableRows=(probe.tables||[]).reduce((n,t)=>n+(Array.isArray(t?.rows)?t.rows.length:0),0);
      host.innerHTML=`<div class="collectish-health-grid" style="margin-top:10px"><div class="collectish-health-card"><span>Seller Orders probe</span><strong>${esc(probe.title||'Orders')}</strong><small>${job.completed_at?ago(job.completed_at):''}</small><div class="meta">${esc(probe.path||'')}</div></div><div class="collectish-health-card"><span>Discovery</span><strong>${tableRows} table rows</strong><small>${Number(counts.gridRows||0)} grid rows • ${Number(counts.resources||0)} API/resource URLs</small><div class="meta">${Number(counts.links||0)} order-related links</div></div></div><details style="margin-top:10px"><summary>View Orders probe JSON</summary><pre style="white-space:pre-wrap;word-break:break-word;margin:8px 0 0;max-height:420px;overflow:auto">${esc(pretty(probe))}</pre></details>`;
    }catch(e){host.innerHTML=`<div class="collectish-empty">${esc(e.message)}</div>`}
  }

  async function load(){
    const host=el('agentStatusBody');if(!host)return;
    try{
      const collectors=await rest('collectors?select=name,collector_type,platform,last_seen_at,app_version,capabilities_json,session_health_json&collector_type=in.(browser_connector,mobile_agent)&order=last_seen_at.desc&limit=20');
      const freshAndroid=(collectors||[]).find(c=>c.collector_type==='mobile_agent'&&c.platform==='android');
      const browsers=(collectors||[]).filter(c=>c.collector_type==='browser_connector').slice(0,3);
      const cards=[...(freshAndroid?[freshAndroid]:[]),...browsers].slice(0,4).map(c=>{const s=c?.session_health_json||{},cap=c?.capabilities_json||{},ready=Boolean(s.authenticated&&cap.tcgplayer_authenticated_session);return `<div class="collectish-health-card"><span>${c.collector_type==='mobile_agent'?'Android agent':'Browser agent'}</span><strong>${esc(c?.name||'Unknown agent')}</strong><small>${esc(c?.app_version||'')} ${c?.last_seen_at?'• '+ago(c.last_seen_at):''}</small><div class="meta">${ready?'Authenticated • Eligible':'Session '+esc(s.state||'unknown')}</div></div>`}).join('');
      host.innerHTML=`<div class="collectish-health-grid">${cards||'<div class="collectish-health-card"><span>Agent</span><strong>No authenticated agent</strong></div>'}</div>`;
    }catch(e){host.innerHTML=`<div class="collectish-empty">${esc(e.message)}</div>`}
    loadLatestSellerSnapshot().catch(()=>{});loadLatestSellerOrdersProbe().catch(()=>{});
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

  async function queueSellerOrdersProbe(){
    const a=window.CollectishAndroid,s=typeof session==='function'?session():null,msg=el('sellerOrdersMsg');
    if(!a||!s?.user?.id){if(msg)msg.textContent='Open this page in the Collectish Android app and sign in first.';return}
    if(typeof a.startSellerOrdersProbe!=='function'){if(msg)msg.textContent='Seller Orders probing requires Collectish Android v0.1.7 or newer.';return}
    try{
      const now=new Date().toISOString();
      await rest('collector_jobs',{method:'POST',body:[{user_id:s.user.id,source:'agent',action:'seller_portal_orders_probe',status:'queued',priority:6,required_capability:'seller_portal_orders_probe',preferred_executor:'android_agent',payload_json:{purpose:'Read-only Seller Orders discovery: DOM structure and authenticated resource URLs'},progress_json:{stage:'queued',percent:0,detail:'Waiting for Android Seller Portal Orders session',updatedAt:now},max_attempts:2}],prefer:'return=minimal'});
      if(msg)msg.textContent='Queued. Android will open Orders in its authenticated Seller Portal session and capture the page structure/API clues.';
      setTimeout(()=>androidHeartbeat().catch(()=>{}),50);
    }catch(e){if(msg)msg.textContent=String(e?.message||e)}
  }

  function install(){
    const anchor=el('collectishConnectorRole');if(!anchor||el('collectishAgentStatus'))return false;
    const panel=document.createElement('section');panel.id='collectishAgentStatus';panel.className='card collectish-ops-panel';panel.dataset.collectishPage='operations';
    panel.innerHTML='<div class="toolbar"><div><h2>Authenticated agents</h2><div class="meta">Live desktop and Android session health.</div></div><button id="refreshAgentStatus" type="button">Refresh</button></div><div id="agentStatusBody"><div class="meta">Loading agent status…</div></div><div style="margin-top:12px"><button id="collectSellerSnapshot" type="button">Collect Seller Portal snapshot</button><div id="sellerSnapshotMsg" class="meta" style="margin-top:6px">Read-only bootstrap collector: page title, path, session state, navigation links, and visible Seller Portal sections.</div><div id="sellerSnapshotLatest" style="margin-top:10px"><div class="meta">Loading latest Seller Portal snapshot…</div></div></div><div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border,#ddd)"><button id="collectSellerOrdersProbe" type="button">Probe Seller Orders</button><div id="sellerOrdersMsg" class="meta" style="margin-top:6px">v0.1.7+: read-only Orders reconnaissance to discover table structure and authenticated API/resource URLs before full history ingestion.</div><div id="sellerOrdersLatest" style="margin-top:10px"><div class="meta">Loading latest Seller Orders probe…</div></div></div>';
    anchor.insertAdjacentElement('afterend',panel);el('refreshAgentStatus').onclick=load;el('collectSellerSnapshot').onclick=queueSellerSnapshot;el('collectSellerOrdersProbe').onclick=queueSellerOrdersProbe;load();return true;
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
  async function failJob(job,collectorId,version,detail,extra={}){
    const completedAt=new Date().toISOString(),progress={stage:'failed',percent:100,detail,updatedAt:completedAt,...extra};
    await rest(`collector_jobs?job_id=eq.${encodeURIComponent(job.job_id)}`,{method:'PATCH',body:{status:'failed',completed_at:completedAt,lease_expires_at:null,progress_json:progress,error_message:detail},prefer:'return=minimal'});
    await rest('collector_job_events',{method:'POST',body:[{job_id:job.job_id,user_id:job.user_id,event_type:'failed',collector_id:collectorId,progress_json:progress,message:detail,metadata_json:{platform:'android',agentVersion:version,...extra}}],prefer:'return=minimal'});
  }

  async function runSellerOrdersProbe(job,a,collectorId,version){
    try{
      a.startSellerOrdersProbe();
      let state='starting';
      for(let i=0;i<40;i++){
        await wait(500);
        state=String(a.getSellerOrdersProbeState?.()||'unknown');
        if(state==='ready'||state==='error')break;
      }
      let ordersProbe={};try{ordersProbe=JSON.parse(String(a.getSellerOrdersSnapshot?.()||'{}'))}catch{ordersProbe={error:'Orders probe JSON parse failed'}}
      if(state==='ready'){
        await completeJob(job,collectorId,version,'Read-only Seller Orders reconnaissance collected',{ordersProbe});
        const msg=el('sellerOrdersMsg');if(msg)msg.textContent=`Collected Orders reconnaissance: ${ordersProbe.title||'Orders'} ${ordersProbe.path||''}`;
      }else{
        await failJob(job,collectorId,version,state==='error'?(ordersProbe.error||'Seller Orders probe failed'):'Seller Orders probe timed out',{ordersProbe,probeState:state});
        const msg=el('sellerOrdersMsg');if(msg)msg.textContent=`Orders probe failed: ${ordersProbe.error||state}`;
      }
      setTimeout(()=>loadLatestSellerOrdersProbe().catch(()=>{}),150);
    }catch(e){await failJob(job,collectorId,version,String(e?.message||e));throw e}
  }

  async function androidHeartbeat(){
    if(heartbeatBusy)return;
    const a=android();if(!a||typeof rest!=='function'||typeof session!=='function')return;
    const s=session();if(!s?.user?.id)return;
    heartbeatBusy=true;
    const collectorId=String(a.getCollectorId()),version=String(a.getVersion()),state=String(a.getSessionState()),authenticated=state==='authenticated',now=new Date().toISOString();
    const ordersCap=authenticated&&typeof a.startSellerOrdersProbe==='function'&&typeof a.getSellerOrdersSnapshot==='function';
    try{
      await rest('collectors?on_conflict=user_id,collector_id',{method:'POST',body:[{user_id:s.user.id,collector_id:collectorId,name:'Collectish Android',collector_type:'mobile_agent',platform:'android',last_seen_at:now,status:'online',app_version:version,capabilities_json:{tcgplayer_authenticated_session:authenticated,authenticated_agent:true,android_agent:true,seller_portal_snapshot:authenticated,seller_portal_orders_probe:ordersCap},session_health_json:{authenticated,state,checkedAt:now,provider:'tcgplayer'},metadata_json:{executionRole:'android_agent'}}],prefer:'resolution=merge-duplicates,return=minimal'});
      if(!authenticated)return;
      const probe=await claimOne(a,collectorId,'auth_probe','tcgplayer_authenticated_session');
      if(probe)await completeJob(probe,collectorId,version,'Authenticated TCGplayer session confirmed on Android');
      const snapJob=await claimOne(a,collectorId,'seller_portal_snapshot','seller_portal_snapshot');
      if(snapJob){
        let snapshot={};try{snapshot=JSON.parse(String(a.getSellerPortalSnapshot?.()||'{}'))}catch{snapshot={error:'Snapshot parse failed'}}
        await completeJob(snapJob,collectorId,version,'Read-only Seller Portal snapshot collected',{snapshot});
        const msg=el('sellerSnapshotMsg');if(msg)msg.textContent=`Collected: ${snapshot.title||'Seller Portal'} ${snapshot.path||''}`;
        setTimeout(()=>loadLatestSellerSnapshot().catch(()=>{}),150);
      }
      if(ordersCap){
        const ordersJob=await claimOne(a,collectorId,'seller_portal_orders_probe','seller_portal_orders_probe');
        if(ordersJob)await runSellerOrdersProbe(ordersJob,a,collectorId,version);
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
