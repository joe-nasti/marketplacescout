// Collectish Admin operations console — single owner for section structure and visibility.
(() => {
  let active='overview',loading=false,sealedView='health';
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const fmt=t=>t?new Date(t).toLocaleString():'—';
  const age=t=>{if(!t)return 'Never';const ms=Date.now()-new Date(t).getTime(),h=ms/36e5;if(h<1)return `${Math.max(1,Math.round(ms/6e4))}m ago`;if(h<48)return `${Math.round(h)}h ago`;return `${Math.round(h/24)}d ago`};
  const latest=(rows,key)=>{const vals=(rows||[]).map(x=>x?.[key]).filter(Boolean).sort();return vals.at(-1)||null};
  const cacheKey=()=>`collectishAdminOverview:${window.CollectishShell?.session?.()?.user?.id||'anonymous'}`;
  function cached(){try{const value=JSON.parse(sessionStorage.getItem(cacheKey())||'null');return value&&Date.now()-Number(value.savedAt||0)<15*60*1000?value:null}catch{return null}}
  function skeleton(){return ['Checking singles scanning…','Loading enabled sets…','Checking sealed EV…','Finding latest scan…'].map(label=>`<div class="cx-admin-summary-card cx-ui-metric"><span>${label}</span><strong>—</strong><small>Updating in background</small></div>`).join('')}
  function hydrate(shell){
    const value=cached();
    if(value){shell.querySelector('#cxAdminOverviewCards').innerHTML=value.overview||skeleton();shell.querySelector('#cxAdminSinglesSummary').innerHTML=value.singles||'';shell.querySelector('#cxAdminSealedSummary').innerHTML=value.sealed||'';shell.querySelector('#cxAdminSealedBaseSources').innerHTML=value.sources||''}
    else shell.querySelector('#cxAdminOverviewCards').innerHTML=skeleton();
  }
  function remember(shell){try{sessionStorage.setItem(cacheKey(),JSON.stringify({savedAt:Date.now(),overview:shell.querySelector('#cxAdminOverviewCards')?.innerHTML||'',singles:shell.querySelector('#cxAdminSinglesSummary')?.innerHTML||'',sealed:shell.querySelector('#cxAdminSealedSummary')?.innerHTML||'',sources:shell.querySelector('#cxAdminSealedBaseSources')?.innerHTML||''}))}catch{}}

  function ensure(){
    const admin=document.getElementById('cxAdmin');if(!admin)return null;
    let shell=admin.querySelector('#cxAdminConsole');
    if(!shell){
      const existing=[...admin.children];
      shell=document.createElement('div');shell.id='cxAdminConsole';shell.className='cx-admin-console';
      shell.innerHTML=`<div class="cx-admin-console-head"><div><h2>Operations</h2><p>Control syncs, see failures early, and verify data freshness.</p></div><span class="cx-admin-console-state" id="cxAdminOverallState">Checking…</span></div>
        <nav class="cx-admin-tabs cx-ui-tabs" aria-label="Admin sections">
          <button type="button" data-admin-tab="overview">Overview</button>
          <button type="button" data-admin-tab="singles">Singles</button>
          <button type="button" data-admin-tab="sealed">Sealed</button>
          <button type="button" data-admin-tab="system">System</button>
        </nav>
        <section class="cx-admin-panel" data-admin-panel="overview"><div id="cxAdminOverviewCards" class="cx-admin-summary-grid cx-ui-metrics"></div><div id="cxAdminOverviewModules"></div></section>
        <section class="cx-admin-panel" data-admin-panel="singles"><div id="cxAdminSinglesSummary" class="cx-admin-summary-grid cx-ui-metrics"></div><div id="cxAdminSinglesModules"></div></section>
        <section class="cx-admin-panel" data-admin-panel="sealed"><div id="cxAdminSealedSummary" class="cx-admin-summary-grid cx-ui-metrics"></div><div class="cx-admin-ia-subnav" id="cxAdminSealedSubnav"><button type="button" data-admin-sealed-view="health" class="active">Health</button><button type="button" data-admin-sealed-view="catalog">Catalog</button></div><p id="cxAdminSealedViewNote" class="cx-admin-ia-section-note"></p><div id="cxAdminSealedSources" class="cx-admin-source-list cx-ui-list"><div id="cxAdminSealedBaseSources"></div></div></section>
        <section class="cx-admin-panel" data-admin-panel="system"><div id="cxAdminSystemModules"></div></section>`;
      admin.replaceChildren(shell);
      hydrate(shell);
      const sys=shell.querySelector('#cxAdminSystemModules');existing.forEach(x=>sys.appendChild(x));
      shell.querySelectorAll('[data-admin-tab]').forEach(b=>b.onclick=()=>show(b.dataset.adminTab));
      shell.querySelector('#cxAdminSealedSubnav')?.addEventListener('click',e=>{const b=e.target.closest('[data-admin-sealed-view]');if(!b)return;sealedView=b.dataset.adminSealedView;applySealedView()});
    }
    applySection(shell,false);
    adoptLooseChildren(shell);
    applySealedView();
    return shell;
  }

  function applySection(shell,emit=true){
    const changed=shell.dataset.activeSection!==active;
    shell.dataset.activeSection=active;
    shell.querySelectorAll('[data-admin-tab]').forEach(b=>b.classList.toggle('active',b.dataset.adminTab===active));
    shell.querySelectorAll('[data-admin-panel]').forEach(p=>p.hidden=p.dataset.adminPanel!==active);
    document.body.classList.toggle('cx-admin-singles-active',active==='singles');
    if(changed&&emit)document.dispatchEvent(new CustomEvent('collectish:admin-section-change',{detail:{section:active}}));
  }

  function adoptLooseChildren(shell=document.getElementById('cxAdminConsole')){
    if(!shell)return;
    const admin=document.getElementById('cxAdmin'),overview=shell.querySelector('#cxAdminOverviewModules'),singles=shell.querySelector('#cxAdminSinglesModules'),system=shell.querySelector('#cxAdminSystemModules');
    const scan=admin?.querySelector('#cxAdminScanConfig');if(scan&&scan.parentElement!==singles)singles.appendChild(scan);
    const mh=admin?.querySelector('.cx-marketplace-health');if(mh&&mh.parentElement!==singles)singles.insertBefore(mh,singles.firstChild);
    const alerts=admin?.querySelector('#cxAdminAlerts');if(alerts&&alerts.parentElement!==shell.querySelector('[data-admin-panel="overview"]'))shell.querySelector('#cxAdminOverviewCards')?.insertAdjacentElement('afterend',alerts);
    const rh=admin?.querySelector('.cx-runtime-health');if(rh&&!rh.closest('.cx-admin-runtime-disclosure'))wrapRuntime(rh,system);
    [...(admin?.children||[])].filter(x=>x!==shell).forEach(x=>system.appendChild(x));
  }

  function wrapRuntime(runtime,system){
    if(!runtime||!system)return;let d=system.querySelector('.cx-admin-runtime-disclosure');
    if(!d){d=document.createElement('details');d.className='cx-admin-runtime-disclosure';d.innerHTML='<summary><span><strong>Runtime diagnostics</strong><small>Performance, transport, retries, and Supabase endpoint cost</small></span><b>Show</b></summary><div class="cx-admin-runtime-body"></div>';system.appendChild(d);d.addEventListener('toggle',()=>{const b=d.querySelector('summary b');if(b)b.textContent=d.open?'Hide':'Show'})}
    const body=d.querySelector('.cx-admin-runtime-body');if(runtime.parentElement!==body)body.appendChild(runtime);
  }

  function applySealedView(){
    const shell=document.getElementById('cxAdminConsole'),panel=shell?.querySelector('[data-admin-panel="sealed"]');if(!panel)return;
    panel.querySelectorAll('[data-admin-sealed-view]').forEach(b=>b.classList.toggle('active',b.dataset.adminSealedView===sealedView));
    const sources=document.getElementById('cxAdminSealedSources'),catalog=document.getElementById('cxAdminSealedCatalog');
    if(sources)sources.hidden=sealedView!=='health';if(catalog)catalog.hidden=sealedView!=='catalog';
    const note=document.getElementById('cxAdminSealedViewNote');if(note)note.textContent=sealedView==='health'?'Source freshness, CardTrader / Zero coverage, and pipeline health.':'Manage which sealed sets flow through identity, pricing, EV, and Scout Sealed scoring.';
  }

  function show(name,refresh=true){
    active=name||'overview';const shell=document.getElementById('cxAdminConsole');if(!shell)return;
    applySection(shell,true);adoptLooseChildren(shell);applySealedView();if(refresh)load();
  }

  function metric(label,value,sub,state='neutral'){return `<div class="cx-admin-summary-card cx-ui-metric ${esc(state)}"><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`}
  function source(label,state,last,sub){return `<div class="cx-admin-source-row"><div><strong>${esc(label)}</strong><small>${esc(sub||'')}</small></div><div class="cx-admin-source-meta"><span class="cx-admin-status cx-ui-status ${esc(state)}">${esc(state.toUpperCase())}</span><b>${esc(age(last))}</b><small>${esc(fmt(last))}</small></div></div>`}

  async function load(){
    if(loading)return;const admin=document.getElementById('cxAdmin');if(!admin?.classList.contains('active'))return;const shell=ensure();if(!shell)return;loading=true;
    try{
      const since3=new Date(Date.now()-3*36e5).toISOString();
      const [profiles,scans,jobs,sealed,ev,cards,sync]=await Promise.all([
        rest('marketplace_scan_profiles?select=set_slug,enabled,next_due_at,last_queued_at,tcgplayer_group_id&order=set_slug.asc'),
        rest('marketplace_scans?select=captured_at,set_slug&order=captured_at.desc&limit=200'),
        rest(`collector_jobs?select=status,error_message,created_at,available_at,progress_json&source=eq.marketplace&action=eq.scan_set&created_at=gte.${encodeURIComponent(since3)}&order=created_at.desc&limit=250`),
        rest('sealed_product_price_current?select=source,captured_at&order=captured_at.desc&limit=200'),
        rest('precon_ev_current?select=refreshed_at,deck_key,scout_sealed_score&order=refreshed_at.desc&limit=100'),
        rest('precon_card_ev_current?select=direct_observed_at,syp_last_seen,refreshed_at&order=refreshed_at.desc&limit=200'),
        rest('mtgjson_sync_state?select=feed,last_completed_at,last_started_at,status,detail')
      ]);
      const enabled=(profiles||[]).filter(x=>x.enabled),due=enabled.filter(x=>x.next_due_at&&new Date(x.next_due_at)<=new Date());
      const terminal=(jobs||[]).filter(x=>x.status==='completed'||x.status==='failed'),failed=terminal.filter(x=>x.status==='failed'),completed=terminal.filter(x=>x.status==='completed');
      const mismatch=failed.filter(x=>/Set filter mismatch/i.test(String(x.error_message||''))).length,http500=failed.filter(x=>/HTTP 500 .*tcgplayer\.com/i.test(String(x.error_message||''))).length,rate=terminal.length?failed.length/terminal.length:0;
      const breaker=mismatch>=2||http500>=5||(terminal.length>=6&&rate>=.40),paused=(jobs||[]).filter(x=>x.status==='queued'&&x.progress_json?.pausedBy==='marketplace_circuit_breaker').length;
      const latestScan=latest(scans,'captured_at'),tcgLast=Math.max(...(sealed||[]).filter(x=>x.source==='tcgplayer').map(x=>new Date(x.captured_at).getTime()).filter(Number.isFinite),0),ckLast=Math.max(...(sealed||[]).filter(x=>x.source==='cardkingdom').map(x=>new Date(x.captured_at).getTime()).filter(Number.isFinite),0);
      const evLast=latest(ev,'refreshed_at'),directLast=latest(cards,'direct_observed_at'),sypLast=latest(cards,'syp_last_seen'),syncLast=latest(sync,'last_completed_at'),sealedHealthy=Boolean(evLast)&&Date.now()-new Date(evLast).getTime()<36*36e5;
      const overall=breaker||!sealedHealthy?'ATTENTION':'HEALTHY',overallEl=shell.querySelector('#cxAdminOverallState');overallEl.textContent=overall;overallEl.className=`cx-admin-console-state ${overall.toLowerCase()}`;
      shell.querySelector('#cxAdminOverviewCards').innerHTML=[metric('Singles scanning',breaker?'Paused':'Healthy',`${completed.length} completed · ${failed.length} failed in 3h`,breaker?'bad':'good'),metric('Enabled sets',String(enabled.length),`${due.length} currently due`,due.length>20?'warn':'neutral'),metric('Sealed EV',sealedHealthy?'Fresh':'Attention',evLast?`Updated ${age(evLast)}`:'No EV refresh',sealedHealthy?'good':'bad'),metric('Latest set scan',latestScan?age(latestScan):'Never',latestScan?fmt(latestScan):'',latestScan?'neutral':'bad')].join('');
      shell.querySelector('#cxAdminSinglesSummary').innerHTML=[metric('Enabled',String(enabled.length),'scan profiles'),metric('Due / overdue',String(due.length),'waiting for admission',due.length?'warn':'good'),metric('Recent success',String(completed.length),'rolling 3h'),metric('Recent failure',String(failed.length),`${mismatch} filter · ${http500} HTTP 500`,failed.length?'bad':'good'),metric('Deferred',String(paused),'circuit-breaker queue',paused?'warn':'neutral')].join('');
      const tcgIso=tcgLast?new Date(tcgLast).toISOString():null,ckIso=ckLast?new Date(ckLast).toISOString():null;
      shell.querySelector('#cxAdminSealedSummary').innerHTML=[metric('Products scored',String((ev||[]).length),'current recent precons'),metric('EV refreshed',evLast?age(evLast):'Never',evLast?fmt(evLast):'',sealedHealthy?'good':'bad'),metric('MTGJSON sync',syncLast?age(syncLast):'Never',syncLast?fmt(syncLast):'',syncLast?'neutral':'bad')].join('');
      const base=shell.querySelector('#cxAdminSealedBaseSources');if(base)base.innerHTML=[source('TCG sealed acquisition',tcgIso&&Date.now()-tcgLast<36*36e5?'good':'warn',tcgIso,'Authoritative sealed acquisition source'),source('Card Kingdom sealed reference',ckIso&&Date.now()-ckLast<72*36e5?'good':'warn',ckIso,'Reference-only sealed retail'),source('Component EV / scoring',sealedHealthy?'good':'warn',evLast,'Precon EV and Scout Sealed score'),source('Direct component coverage',directLast&&Date.now()-new Date(directLast).getTime()<36*36e5?'good':'warn',directLast,'Economically meaningful component SKUs'),source('SYP component coverage',sypLast?'good':'neutral',sypLast,'Stored SYP eligibility / max quantity'),source('MTGJSON identity + prices',syncLast?'good':'warn',syncLast,(sync||[]).map(x=>`${x.feed}: ${x.status||'unknown'}`).join(' · '))].join('');
      adoptLooseChildren(shell);applySealedView();remember(shell);
    }catch(e){const ov=shell.querySelector('#cxAdminOverviewCards');if(ov)ov.innerHTML=`<div class="cx-admin-error">Couldn’t load Admin health: ${esc(e.message||e)}</div>`}finally{loading=false}
  }

  document.addEventListener('click',e=>{if(e.target?.closest?.('[data-cx-page="admin"]'))setTimeout(()=>{ensure();load()},120)},true);
  document.addEventListener('collectish:admin-modules-ready',()=>{const shell=ensure();adoptLooseChildren(shell);applySealedView()});
  document.addEventListener('collectish:runtime-health',()=>setTimeout(()=>adoptLooseChildren(),20));
  window.CollectishAdminConsole={render:ensure,refresh:load,show,setSealedView:v=>{sealedView=v;applySealedView()}};
})();
