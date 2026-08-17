// Collectish Admin Marketplace health — event-driven only; no startup network calls.
(() => {
  let loading=false;
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  async function load(){
    if(loading)return;
    const admin=document.getElementById('cxAdmin');
    if(!admin||!admin.classList.contains('active'))return;
    loading=true;
    try{
      const since=new Date(Date.now()-3*3600000).toISOString();
      const [recent,queued,active]=await Promise.all([
        rest(`collector_jobs?select=status,error_message,created_at&source=eq.marketplace&action=eq.scan_set&created_at=gte.${encodeURIComponent(since)}&status=in.(completed,failed)&order=created_at.desc&limit=250`),
        rest('collector_jobs?select=job_id,available_at,progress_json&source=eq.marketplace&action=eq.scan_set&status=eq.queued&limit=100'),
        rest('collector_jobs?select=job_id,status&source=eq.marketplace&action=eq.scan_set&status=in.(claimed,running)&limit=20')
      ]);
      const terminal=recent||[],failed=terminal.filter(x=>x.status==='failed'),completed=terminal.filter(x=>x.status==='completed');
      const http500=failed.filter(x=>/HTTP 500 .*tcgplayer\.com/i.test(String(x.error_message||''))).length;
      const mismatch=failed.filter(x=>/Set filter mismatch/i.test(String(x.error_message||''))).length;
      const rate=terminal.length?failed.length/terminal.length:0;
      const open=(mismatch>=2)||(http500>=5)||(terminal.length>=6&&rate>=0.40);
      const paused=(queued||[]).filter(x=>x.progress_json?.pausedBy==='marketplace_circuit_breaker').length;
      let box=admin.querySelector('.cx-marketplace-health');
      if(!box){box=document.createElement('div');box.className='cx-card cx-span-12 cx-marketplace-health';(admin.querySelector('.cx-grid')||admin).prepend(box)}
      box.innerHTML=`<div class="cx-section-title">Marketplace scan health</div>
        <div class="cx-detail-list">
          <div class="cx-detail-stat"><span>Automatic admission</span><strong>${open?'PAUSED':'OPEN'}</strong></div>
          <div class="cx-detail-stat"><span>3h completed</span><strong>${completed.length}</strong></div>
          <div class="cx-detail-stat"><span>3h failed</span><strong>${failed.length}</strong></div>
          <div class="cx-detail-stat"><span>Failure rate</span><strong>${terminal.length?Math.round(rate*100):0}%</strong></div>
          <div class="cx-detail-stat"><span>TCG HTTP 500</span><strong>${http500}</strong></div>
          <div class="cx-detail-stat"><span>Set-filter mismatches</span><strong>${mismatch}</strong></div>
          <div class="cx-detail-stat"><span>Paused queued jobs</span><strong>${paused}</strong></div>
          <div class="cx-detail-stat"><span>Active scans</span><strong>${(active||[]).length}</strong></div>
        </div>
        <div class="cx-sub">${open?'Circuit breaker is preventing new configured scans until the recent failure window recovers.':'Recent Marketplace health is within the configured admission thresholds.'}</div>`;
    }catch(e){console.warn('Marketplace health unavailable',e)}finally{loading=false}
  }
  document.addEventListener('click',e=>{if(e.target?.closest?.('[data-cx-page="admin"]'))setTimeout(load,120)},true);
  document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='admin')setTimeout(load,50)});
  window.CollectishMarketplaceHealth={refresh:load};
})();
