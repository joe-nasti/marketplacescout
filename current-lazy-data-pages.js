// Collectish lazy data pages — do not start hidden feature bundles during app boot.
(() => {
  const loaded=new Set(),loading=new Set();
  const scripts={
    sealed:[
      'current-sealed-ev.js?v=0958',
      'current-sealed-detail-focus.js?v=0958',
      'current-sealed-source-checks.js?v=0958',
      'current-sealed-images.js?v=0958',
      'current-sealed-scout-card-parity.js?v=0958',
      'current-sealed-metric-drilldown.js?v=0958',
      'current-sealed-score-tooltips.js?v=0958'
    ],
    seller:[
      'current-seller-parity.js?v=0958',
      'current-seller-overview-order-meta.js?v=0958',
      'current-seller-order-filters.js?v=0958',
      'current-seller-drilldowns.js?v=0958',
      'current-seller-detail-polish.js?v=0958'
    ],
    syp:[
      'current-syp-parity.js?v=0958',
      'current-syp-links.js?v=0958'
    ]
  };
  const title=p=>p==='syp'?'SYP':p[0].toUpperCase()+p.slice(1);
  function host(page){return document.getElementById(`cx${page==='syp'?'Syp':page[0].toUpperCase()+page.slice(1)}`)}
  function showLoading(page){
    const h=host(page);if(!h||h.dataset.cxLazyReady==='1')return;
    h.innerHTML=`<div class="cx-page-head"><div><h2>${title(page)}</h2><p>Loading ${title(page)}…</p></div></div><div class="cx-card"><div class="cx-empty">Preparing ${title(page)} data…</div></div>`;
  }
  function showError(page){
    const h=host(page);if(!h)return;
    h.innerHTML=`<div class="cx-page-head"><div><h2>${title(page)}</h2></div></div><div class="cx-card"><div class="cx-empty">Could not load ${title(page)}. Tap the tab to try again.</div></div>`;
  }
  function load(page){
    const list=scripts[page];
    if(!list||loaded.has(page)||loading.has(page))return;
    loading.add(page);showLoading(page);
    const started=performance.now();
    let p=Promise.resolve();
    for(const src of list){
      p=p.then(()=>new Promise((resolve,reject)=>{
        const s=document.createElement('script');
        s.src=src;s.async=false;s.dataset.cxLazyPage=page;
        s.onload=resolve;s.onerror=reject;document.body.append(s);
      }));
    }
    p.then(()=>{
      loading.delete(page);loaded.add(page);
      const h=host(page);if(h)h.dataset.cxLazyReady='1';
      document.dispatchEvent(new CustomEvent('collectish:lazy-page-loaded',{detail:{page,ms:Math.round(performance.now()-started)}}));
    }).catch(()=>{loading.delete(page);loaded.delete(page);showError(page)});
  }
  document.addEventListener('click',e=>{
    const b=e.target?.closest?.('[data-cx-page]');if(!b)return;
    const page=b.dataset.cxPage;if(scripts[page])load(page);
  },true);
  document.addEventListener('collectish:ready',()=>{
    queueMicrotask(()=>{
      const id=document.querySelector('.cx-page.active')?.id||'';
      if(id==='cxSealed')load('sealed');else if(id==='cxSeller')load('seller');else if(id==='cxSyp')load('syp');
    });
  });
  window.CollectishLazyDataPages={load};
})();
