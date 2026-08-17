// Collectish lazy data pages — do not start hidden data queries during app boot.
(() => {
  const loaded=new Set();
  const scripts={
    sealed:['current-sealed-ev.js?v=0957'],
    seller:['current-seller-parity.js?v=0957'],
    syp:['current-syp-parity.js?v=0957']
  };
  function load(page){
    const list=scripts[page];
    if(!list||loaded.has(page))return;
    loaded.add(page);
    let p=Promise.resolve();
    for(const src of list){
      p=p.then(()=>new Promise((resolve,reject)=>{
        const s=document.createElement('script');
        s.src=src;
        s.async=false;
        s.dataset.cxLazyPage=page;
        s.onload=resolve;
        s.onerror=reject;
        document.body.append(s);
      }));
    }
    p.catch(()=>loaded.delete(page));
  }
  document.addEventListener('click',e=>{
    const b=e.target?.closest?.('[data-cx-page]');
    if(!b)return;
    const page=b.dataset.cxPage;
    if(scripts[page])load(page);
  },true);
  document.addEventListener('collectish:ready',()=>{
    queueMicrotask(()=>{
      const id=document.querySelector('.cx-page.active')?.id||'';
      if(id==='cxSealed')load('sealed');
      else if(id==='cxSeller')load('seller');
      else if(id==='cxSyp')load('syp');
    });
  });
  window.CollectishLazyDataPages={load};
})();
