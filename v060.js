// Collectish web v0.6.0 — cloud-primary Marketplace operations status
(() => {
  const VERSION='0.6.0',el=id=>document.getElementById(id);
  const setBadge=()=>{const b=el('appVersion');if(b)b.textContent=`web v${VERSION}`};
  setBadge();
  if(!document.querySelector('link[data-collectish-v060]')){const l=document.createElement('link');l.rel='stylesheet';l.href='v060.css?v=060';l.dataset.collectishV060='1';document.head.appendChild(l)}
  function session(){try{return JSON.parse(localStorage.getItem('collectishSession')||'null')}catch{return null}}
  function cfg(){return window.COLLECTISH_CONFIG||{}}
  async function rest(path){
    const s=session(),c=cfg();if(!s?.token)throw Error('Sign in required.');
    const r=await fetch(`${c.supabaseUrl}/rest/v1/${path}`,{headers:{apikey:c.publishableKey,Authorization:`Bearer ${s.token}`,'Content-Type':'application/json'}});
    const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!r.ok)throw Error(data?.message||data?.hint||`Cloud HTTP ${r.status}`);return data;
  }
  const fmt=v=>v?new Date(v).toLocaleString():'—';
  const esc=s=>String(s??'').replace(/[&<>\"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));

  function install(){
    const jobs=el('collectishJobs');if(!jobs||el('marketplaceExecutionStatus'))return false;
    const sec=document.createElement('section');sec.id='marketplaceExecutionStatus';sec.className='card collectish-ops-panel';sec.dataset.collectishPage='operations';
    sec.innerHTML=`<div class="toolbar"><div><h2>Marketplace execution</h2><div class="meta">Cloud is the production executor. The PC connector is fallback only.</div></div><button id="refreshMarketplaceExecution">Refresh</button></div><div id="marketplaceExecutionBody" class="marketplace-exec-grid"><div class="meta">Loading…</div></div>`;
    jobs.insertAdjacentElement('beforebegin',sec);
    el('refreshMarketplaceExecution').onclick=load;
    load();return true;
  }

  async function load(){
    const host=el('marketplaceExecutionBody');if(!host)return;
    host.innerHTML='<div class="meta">Refreshing Marketplace execution status…</div>';
    try{
      const [jobs,scans,collectors]=await Promise.all([
        rest('collector_jobs?select=job_id,status,preferred_executor,created_at,completed_at,error_message,payload_json,progress_json&source=eq.marketplace&action=eq.scan_set&order=created_at.desc&limit=50'),
        rest('marketplace_scans?select=scan_id,set_name,captured_at,unique_skus,profile_json&order=captured_at.desc&limit=10'),
        rest('collectors?select=collector_id,name,status,last_seen_at,app_version,collector_type&order=last_seen_at.desc&limit=50')
      ]);
      const cloudJobs=(jobs||[]).filter(j=>j.preferred_executor==='cloud_worker');
      const pending=cloudJobs.filter(j=>['queued','claimed','running'].includes(j.status));
      const failed=cloudJobs.filter(j=>j.status==='failed');
      const fallback=(jobs||[]).filter(j=>j.preferred_executor==='browser_connector'&&j.payload_json?.fallbackFromCloudJobId);
      const latestCloud=(scans||[]).find(s=>s.profile_json?.executor==='cloud_worker')||null;
      const worker=(collectors||[]).find(c=>c.collector_type==='cloud_worker')||null;
      host.innerHTML=`
        <div class="marketplace-exec-card"><span>Primary executor</span><strong>Cloud worker</strong><small>Checks queue every ~5 minutes</small></div>
        <div class="marketplace-exec-card"><span>Worker</span><strong>${worker?esc(worker.status||'online'):'registered'}</strong><small>${worker?`${esc(worker.app_version||'')} • ${fmt(worker.last_seen_at)}`:'Server-side public Marketplace APIs'}</small></div>
        <div class="marketplace-exec-card"><span>Latest cloud scan</span><strong>${latestCloud?esc(latestCloud.set_name||'Marketplace scan'):'—'}</strong><small>${latestCloud?`${Number(latestCloud.unique_skus||0).toLocaleString()} SKUs • ${fmt(latestCloud.captured_at)}`:'No cloud scan found'}</small></div>
        <div class="marketplace-exec-card"><span>Cloud queue</span><strong>${pending.length}</strong><small>queued / claimed / running</small></div>
        <div class="marketplace-exec-card"><span>Cloud failures</span><strong>${failed.length}</strong><small>within latest 50 Marketplace jobs</small></div>
        <div class="marketplace-exec-card"><span>PC fallbacks</span><strong>${fallback.length}</strong><small>automatically created after cloud failure</small></div>`;
    }catch(e){host.innerHTML=`<div class="collectish-empty">${esc(e.message)}</div>`}
  }

  document.addEventListener('click',e=>{if(e.target?.dataset?.page==='operations')setTimeout(load,120)},true);
  let tries=0;const t=setInterval(()=>{tries++;setBadge();if(install()||tries>180)clearInterval(t)},100);
  const badge=el('appVersion');if(badge)new MutationObserver(setBadge).observe(badge,{childList:true,characterData:true,subtree:true});
})();
