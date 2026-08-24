// Collectish Admin operations console — single-owner, event-driven operations UI; no startup network calls.
(() => {
  let active='overview',loading=false;
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const fmt=t=>t?new Date(t).toLocaleString():'—';
  const age=t=>{if(!t)return 'Never';const ms=Date.now()-new Date(t).getTime(),h=ms/36e5;if(h<1)return `${Math.max(1,Math.round(ms/6e4))}m ago`;if(h<48)return `${Math.round(h)}h ago`;return `${Math.round(h/24)}d ago`};
  const latest=(rows,key)=>{const vals=(rows||[]).map(x=>x?.[key]).filter(Boolean).sort();return vals.at(-1)||null};

  function applySection(shell,emit=true){
    const changed=shell.dataset.activeSection!==active;
    shell.dataset.activeSection=active;
    shell.querySelectorAll('[data-admin-tab]').forEach(b=>b.classList.toggle('active',b.dataset.adminTab===active));
    shell.querySelectorAll('[data-admin-panel]').forEach(p=>p.hidden=p.dataset.adminPanel!==active);
    document.body.classList.toggle('cx-admin-singles-active',active==='singles');
    if(changed&&emit)document.dispatchEvent(new CustomEvent('collectish:admin-section-change',{detail:{section:active}}));
  }

  function ensure(){
    const admin=document.getElementById('cxAdmin');if(!admin)return null;
    let shell=admin.querySelector('#cxAdminConsole');
    if(!shell){
      const existing=[...admin.children];
      shell=document.createElement('div');shell.id='cxAdminConsole';shell.className='cx-admin-console';
      shell.innerHTML=`<div class="cx-admin-console-head"><div><h2>Operations</h2><p>Control syncs, see failures early, and verify data freshness.</p></div><span class="cx-admin-console-state" id="cxAdminOverallState">Checking…</span></div>
        <nav class="cx-admin-tabs" aria-label="Admin sections">
          <button type="button" data-admin-tab="overview">Overview</button>
          <button type="button" data-admin-tab="singles">Singles</button>
          <button type="button" data-admin-tab="sealed">Sealed</button>
          <button type="button" data-admin-tab="system">System</button>
        </nav>
        <section class="cx-admin-panel" data-admin-panel="overview"><div id="cxAdminOverviewCards" class="cx-admin-summary-grid"></div><div id="cxAdminOverviewModules"></div></section>
        <section class="cx-admin-panel" data-admin-panel="singles"><div id="cxAdminSinglesSummary" class="cx-admin-summary-grid"></div><div id="cxAdminSinglesModules"></div></section>
        <section class="cx-admin-panel" data-admin-panel="sealed"><div id="cxAdminSealedSummary" class="cx-admin-summary-grid"></div><div id="cxAdminSealedSources" class="cx-admin-source-list"></div></section>
        <section class="cx-admin-panel" data-admin-panel="system"><div id="cxAdminSystemModules"></div></section>`;
      admin.replaceChildren(shell);
      const sys=shell.querySelector('#cxAdminSystemModules');existing.forEach(x=>sys.appendChild(x));
      shell.querySelectorAll('[data-admin-tab]').forEach(b=>b.onclick=()=>show(b.dataset.adminTab));
    }
    relocate(shell);applySection(shell,false);return shell;
  }

  function relocate(shell=ensure()){
    if(!shell)return;
    const admin=document.getElementById('cxAdmin'),overview=shell.querySelector('#cxAdminOverviewModules'),singles=shell.querySelector('#cxAdminSinglesModules'),system=shell.querySelector('#cxAdminSystemModules');
    const alerts=admin?.querySelector('#cxAdminAlerts');if(alerts&&alerts.parentElement!==overview){const cards=shell.querySelector('#cxAdminOverviewCards');cards?.insertAdjacentElement('afterend',alerts);if(!cards)overview.prepend(alerts)}
    const scan=admin?.querySelector('#cxAdminScanConfig');if(scan&&scan.parentElement!==singles)singles.appendChild(scan);
    const mh=admin?.querySelector('.cx-marketplace-health');if(mh&&mh.parentElement!==singles){const summary=shell.querySelector('#cxAdminSinglesSummary');summary?.insertAdjacentElement('afterend',mh);if(!summary)singles.prepend(mh)}
    const rh=admin?.querySelector('.cx-runtime-health');if(rh&&rh.parentElement!==system)system.appendChild(rh);
    [...(admin?.children||[])].filter(x=>x!==shell).forEach(x=>{if(x.id==='cxAdminAlerts')overview.appendChild(x);else if(x.id==='cxAdminScanConfig'||x.classList.contains('cx-marketplace-health'))singles.appendChild(x);else system.appendChild(x)});
  }

  function show(name,refresh=true){
    const shell=document.getElementById('cxAdminConsole');if(!shell)return;
    active=name||'overview';applySection(shell,true);if(refresh)load();
  }
  function metric(label,value,sub,state='neutral'){return `<div class="cx-admin-summary-card ${esc(state)}"><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`}
  function source(label,state,last,sub){return `<div class="cx-admin-source-row"><div><strong>${esc(label)}</strong><small>${esc(sub||'')}</small></div><div class="cx-admin-source-meta"><span class="cx-admin-status ${esc(state)}">${esc(state.toUpperCase())}</span><b>${esc(age(last))}</b><small>${esc(fmt(last))}</small></div></div>`}

  async function load(){
    if(loading)return;const admin=document.getElementById('cxAdmin');if(!admin?.classList.contains('active'))return;
    const shell=ensure();if(!shell)return;loading=true;
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
      const evLast=latest(ev,'refreshed_at'),directLast=latest(cards,'direct_observed_at'),sypLast=latest(cards,'syp_last_seen'),syncLast=latest(sync,'last_completed_at');
      const sealedHealthy=Boolean(evLast)&&Date.now()-new Date(evLast).getTime()<36*36e5,overall=breaker||!sealedHealthy?'ATTENTION':'HEALTHY';
      const overallEl=shell.querySelector('#cxAdminOverallState');overallEl.textContent=overall;overallEl.className=`cx-admin-console-state ${overall.toLowerCase()}`;
      shell.querySelector('#cxAdminOverviewCards').innerHTML=[metric('Singles',breaker?'Paused':'Healthy',`${completed.length} completed · ${failed.length} failed`,breaker?'bad':'good'),metric('Due sets',String(due.length),`${enabled.length} enabled`,due.length>20?'warn':'neutral'),metric('Sealed EV',sealedHealthy?'Fresh':'Attention',evLast?`Updated ${age(evLast)}`:'No EV refresh',sealedHealthy?'good':'bad'),metric('Latest scan',latestScan?age(latestScan):'Never',latestScan?fmt(latestScan):'',latestScan?'neutral':'bad')].join('');
      shell.querySelector('#cxAdminSinglesSummary').innerHTML=[metric('Enabled',String(enabled.length),'scan profiles'),metric('Due / overdue',String(due.length),'waiting for admission',due.length?'warn':'good'),metric('Recent success',String(completed.length),'rolling health window'),metric('Recent failure',String(failed.length),`${mismatch} filter · ${http500} HTTP 500`,failed.length?'bad':'good'),metric('Deferred',String(paused),'circuit-breaker queue',paused?'warn':'neutral')].join('');
      const tcgIso=tcgLast?new Date(tcgLast).toISOString():null,ckIso=ckLast?new Date(ckLast).toISOString():null;
      shell.querySelector('#cxAdminSealedSummary').innerHTML=[metric('Products scored',String((ev||[]).length),'current recent precons'),metric('EV refreshed',evLast?age(evLast):'Never',evLast?fmt(evLast):'',sealedHealthy?'good':'bad'),metric('MTGJSON sync',syncLast?age(syncLast):'Never',syncLast?fmt(syncLast):'',syncLast?'neutral':'bad')].join('');
      shell.querySelector('#cxAdminSealedSources').innerHTML=[source('TCG sealed acquisition',tcgIso&&Date.now()-tcgLast<36*36e5?'good':'warn',tcgIso,'Authoritative sealed acquisition source'),source('Card Kingdom sealed reference',ckIso&&Date.now()-ckLast<72*36e5?'good':'warn',ckIso,'Reference-only sealed retail'),source('Component EV / scoring',sealedHealthy?'good':'warn',evLast,'Precon EV and Scout Sealed score'),source('Direct component coverage',directLast&&Date.now()-new Date(directLast).getTime()<36*36e5?'good':'warn',directLast,'Economically meaningful component SKUs'),source('SYP component coverage',sypLast?'good':'neutral',sypLast,'Stored SYP eligibility / max quantity'),source('MTGJSON identity + prices',syncLast?'good':'warn',syncLast,(sync||[]).map(x=>`${x.feed}: ${x.status||'unknown'}`).join(' · '))].join('');
      relocate(shell);document.dispatchEvent(new CustomEvent('collectish:admin-health-rendered',{detail:{overall,breaker,sealedHealthy}}));
    }catch(e){const ov=shell.querySelector('#cxAdminOverviewCards');if(ov)ov.innerHTML=`<div class="cx-admin-error">Couldn’t load Admin health: ${esc(e.message||e)}</div>`}finally{loading=false}
  }

  document.addEventListener('click',e=>{if(e.target?.closest?.('[data-cx-page="admin"]'))setTimeout(()=>{const shell=ensure();if(shell){applySection(shell,true);load()}},140)},true);
  document.addEventListener('collectish:runtime-health',()=>setTimeout(()=>relocate(),20));
  window.CollectishAdminConsole={render:ensure,refresh:load,show};
})();
