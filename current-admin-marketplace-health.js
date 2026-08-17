// Collectish Admin Marketplace health — event-driven only; no startup network calls.
(() => {
  let loading=false;
  function syncSummary({open,canary,completed,failed,http500,mismatch,paused}){
    const shell=document.getElementById('cxAdminConsole');if(!shell)return;
    const state=open?'Paused':canary?'Recovering':'Healthy';
    const ov=shell.querySelector('#cxAdminOverviewCards .cx-admin-summary-card:first-child');
    if(ov){const strong=ov.querySelector('strong'),small=ov.querySelector('small');if(strong)strong.textContent=state;if(small)small.textContent=`${completed} completed · ${failed} failed since recovery boundary`;ov.classList.remove('good','warn','bad');ov.classList.add(open?'bad':canary?'warn':'good')}
    const cards=shell.querySelectorAll('#cxAdminSinglesSummary .cx-admin-summary-card');
    if(cards[2]){cards[2].querySelector('strong').textContent=String(completed);cards[2].querySelector('small').textContent=canary?'since recovery boundary':'rolling health window'}
    if(cards[3]){cards[3].querySelector('strong').textContent=String(failed);cards[3].querySelector('small').textContent=`${mismatch} filter · ${http500} HTTP 500`;cards[3].classList.remove('good','warn','bad');cards[3].classList.add(failed?'bad':'good')}
    if(cards[4])cards[4].querySelector('strong').textContent=String(paused);
  }
  async function load(){
    if(loading)return;const admin=document.getElementById('cxAdmin');if(!admin||!admin.classList.contains('active'))return;loading=true;
    try{
      const since=new Date(Date.now()-3*3600000).toISOString();
      const [recent,queued,active]=await Promise.all([
        rest(`collector_jobs?select=status,error_message,completed_at,progress_json,payload_json&source=eq.marketplace&action=eq.scan_set&completed_at=gte.${encodeURIComponent(since)}&status=in.(completed,failed)&order=completed_at.desc&limit=250`),
        rest('collector_jobs?select=job_id,available_at,progress_json&source=eq.marketplace&action=eq.scan_set&status=eq.queued&limit=100'),
        rest('collector_jobs?select=job_id,status&source=eq.marketplace&action=eq.scan_set&status=in.(claimed,running)&limit=20')
      ]);
      const all=recent||[],canary=all.find(x=>x.status==='completed'&&x.progress_json?.circuitBreakerCanary===true&&x.payload_json?.profile?.tcgSetSlug),boundary=canary?.completed_at?new Date(canary.completed_at).getTime():null;
      const terminal=boundary?all.filter(x=>new Date(x.completed_at||0).getTime()>=boundary):all,failed=terminal.filter(x=>x.status==='failed'),completed=terminal.filter(x=>x.status==='completed');
      const http500=failed.filter(x=>/HTTP 500 .*tcgplayer\.com/i.test(String(x.error_message||''))).length,mismatch=failed.filter(x=>/Set filter mismatch/i.test(String(x.error_message||''))).length,rate=terminal.length?failed.length/terminal.length:0,open=mismatch>=2||http500>=5||(terminal.length>=6&&rate>=.40),paused=(queued||[]).filter(x=>x.progress_json?.pausedBy==='marketplace_circuit_breaker'&&new Date(x.available_at)>new Date()).length;
      let box=admin.querySelector('.cx-marketplace-health');if(!box){box=document.createElement('div');box.className='cx-card cx-span-12 cx-marketplace-health';(admin.querySelector('#cxAdminOverviewModules')||admin.querySelector('.cx-grid')||admin).prepend(box)}
      box.innerHTML=`<div class="cx-section-title">Marketplace scan health</div><div class="cx-detail-list"><div class="cx-detail-stat"><span>Automatic admission</span><strong>${open?'PAUSED':canary?'RECOVERING':'OPEN'}</strong></div><div class="cx-detail-stat"><span>Completed since boundary</span><strong>${completed.length}</strong></div><div class="cx-detail-stat"><span>Failed since boundary</span><strong>${failed.length}</strong></div><div class="cx-detail-stat"><span>Failure rate</span><strong>${terminal.length?Math.round(rate*100):0}%</strong></div><div class="cx-detail-stat"><span>TCG HTTP 500</span><strong>${http500}</strong></div><div class="cx-detail-stat"><span>Set-filter mismatches</span><strong>${mismatch}</strong></div><div class="cx-detail-stat"><span>Deferred jobs</span><strong>${paused}</strong></div><div class="cx-detail-stat"><span>Active scans</span><strong>${(active||[]).length}</strong></div></div><div class="cx-sub">${open?'Circuit breaker is blocking new configured scans.':canary?`Successful canary at ${new Date(canary.completed_at).toLocaleString()} is the recovery boundary; backlog releases gradually.`:'Recent Marketplace health is within admission thresholds.'}</div>`;
      syncSummary({open,canary,completed:completed.length,failed:failed.length,http500,mismatch,paused});
      document.dispatchEvent(new CustomEvent('collectish:admin-marketplace-health',{detail:{open,canaryAt:canary?.completed_at||null,completed:completed.length,failed:failed.length,http500,mismatch,paused}}));
    }catch(e){console.warn('Marketplace health unavailable',e)}finally{loading=false}
  }
  document.addEventListener('click',e=>{if(e.target?.closest?.('[data-cx-page="admin"]'))setTimeout(load,120)},true);
  document.addEventListener('collectish:admin-section-change',e=>{if(e.detail?.section==='overview'||e.detail?.section==='singles')setTimeout(load,20)});
  window.CollectishMarketplaceHealth={refresh:load};
})();