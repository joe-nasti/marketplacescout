(() => {
  const el=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>\"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  const ago=iso=>{if(!iso)return 'never';const m=Math.max(0,Math.round((Date.now()-new Date(iso))/60000));return m<1?'now':m<60?`${m}m ago`:m<1440?`${Math.round(m/60)}h ago`:`${Math.round(m/1440)}d ago`};
  function dedupeCollectors(rows){
    const out=[],seen=new Set();
    for(const c of rows||[]){
      const key=c.collector_type==='mobile_agent'&&c.platform==='android'
        ? 'mobile_agent|android|Collectish Android'
        : `${c.collector_type||''}|${c.platform||''}|${c.name||''}`;
      if(seen.has(key))continue;
      seen.add(key);out.push(c);
    }
    return out;
  }
  async function load(){
    const host=el('agentStatusBody');if(!host)return;
    try{
      const collectors=await rest('collectors?select=name,collector_type,platform,last_seen_at,app_version,capabilities_json,session_health_json&collector_type=in.(browser_connector,mobile_agent)&order=last_seen_at.desc&limit=20');
      const cards=dedupeCollectors(collectors).slice(0,4).map(c=>{const s=c?.session_health_json||{},cap=c?.capabilities_json||{},ready=Boolean(s.authenticated&&cap.tcgplayer_authenticated_session);return `<div class="collectish-health-card"><span>${c.collector_type==='mobile_agent'?'Android agent':'Browser agent'}</span><strong>${esc(c?.name||'Unknown agent')}</strong><small>${esc(c?.app_version||'')} ${c?.last_seen_at?'• '+ago(c.last_seen_at):''}</small><div class="meta">${ready?'Authenticated • Eligible':'Session '+esc(s.state||'unknown')}</div></div>`}).join('');
      host.innerHTML=`<div class="collectish-health-grid">${cards||'<div class="collectish-health-card"><span>Agent</span><strong>No authenticated agent</strong></div>'}</div>`;
    }catch(e){host.innerHTML=`<div class="collectish-empty">${esc(e.message)}</div>`}
  }
  function install(){
    const anchor=el('collectishConnectorRole');if(!anchor||el('collectishAgentStatus'))return false;
    const panel=document.createElement('section');panel.id='collectishAgentStatus';panel.className='card collectish-ops-panel';panel.dataset.collectishPage='operations';
    panel.innerHTML='<div class="toolbar"><div><h2>Authenticated agents</h2><div class="meta">Live desktop and Android session health.</div></div><button id="refreshAgentStatus" type="button">Refresh</button></div><div id="agentStatusBody"><div class="meta">Loading agent status…</div></div>';
    anchor.insertAdjacentElement('afterend',panel);el('refreshAgentStatus').onclick=load;load();return true;
  }
  document.addEventListener('click',e=>{if(e.target?.dataset?.page==='operations')setTimeout(load,150)},true);
  let tries=0;const timer=setInterval(()=>{tries++;if(install()||tries>160)clearInterval(timer)},100);

  const android=()=>window.CollectishAndroid||null;
  let heartbeatBusy=false;
  async function androidHeartbeat(){
    if(heartbeatBusy)return;
    heartbeatBusy=true;
    try{
      const a=android();if(!a||typeof rest!=='function'||typeof session!=='function')return;
      const s=session();if(!s?.user?.id)return;
      try{if(typeof a.refreshSessionState==='function')a.refreshSessionState()}catch{}
      const collectorId=String(a.getCollectorId()),version=String(a.getVersion()),state=String(a.getSessionState()),authenticated=state==='authenticated',now=new Date().toISOString();
      await rest('collectors?on_conflict=user_id,collector_id',{method:'POST',body:[{user_id:s.user.id,collector_id:collectorId,name:'Collectish Android',collector_type:'mobile_agent',platform:'android',last_seen_at:now,status:'online',app_version:version,capabilities_json:{tcgplayer_authenticated_session:authenticated,authenticated_agent:true,android_agent:true},session_health_json:{authenticated,state,checkedAt:now,provider:'tcgplayer'},metadata_json:{executionRole:'android_agent'}}],prefer:'resolution=merge-duplicates,return=minimal'});
      if(!authenticated)return;
      try{
        const claimed=await rest('rpc/claim_collector_job',{method:'POST',body:{p_source:'agent',p_action:'auth_probe',p_preferred_executors:['android_agent'],p_required_capability:'tcgplayer_authenticated_session',p_collector_id:collectorId,p_lease_seconds:300}});
        const job=Array.isArray(claimed)?claimed[0]:(claimed?.job_id?claimed:null);if(!job)return;
        const doneAt=new Date().toISOString();
        const progress={stage:'completed',percent:100,detail:'Authenticated TCGplayer session confirmed on Android',updatedAt:doneAt};
        await rest(`collector_jobs?job_id=eq.${encodeURIComponent(job.job_id)}`,{method:'PATCH',body:{status:'completed',completed_at:doneAt,lease_expires_at:null,progress_json:progress,error_message:null},prefer:'return=minimal'});
        await rest('collector_job_events',{method:'POST',body:[{job_id:job.job_id,user_id:job.user_id,event_type:'completed',collector_id:collectorId,progress_json:progress,message:'Authenticated TCGplayer session confirmed on Android',metadata_json:{platform:'android',agentVersion:version}}],prefer:'return=minimal'});
      }catch(err){
        const errAt=new Date().toISOString();
        await rest('collectors?on_conflict=user_id,collector_id',{method:'POST',body:[{user_id:s.user.id,collector_id:collectorId,name:'Collectish Android',collector_type:'mobile_agent',platform:'android',last_seen_at:errAt,status:'online',app_version:version,capabilities_json:{tcgplayer_authenticated_session:true,authenticated_agent:true,android_agent:true},session_health_json:{authenticated:true,state:'authenticated',checkedAt:errAt,provider:'tcgplayer'},metadata_json:{executionRole:'android_agent',lastClaimError:String(err?.message||err),lastClaimErrorAt:errAt}}],prefer:'resolution=merge-duplicates,return=minimal'}).catch(()=>{});
      }
    } finally { heartbeatBusy=false; }
  }
  const kick=()=>androidHeartbeat().catch(()=>{});
  setInterval(kick,30000);
  setTimeout(kick,2500);
  window.addEventListener('collectishAgentSessionChanged',()=>setTimeout(kick,250));
  window.addEventListener('pageshow',()=>setTimeout(kick,250));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')setTimeout(kick,250)});
})();
