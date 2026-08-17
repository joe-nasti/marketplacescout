// Collectish lazy data pages — do not start hidden Seller/Sealed queries during app boot.
(() => {
  const loaded=new Set();
  const scripts={
    sealed:'current-sealed-ev.js?v=0957',
    seller:'current-seller-parity.js?v=0957'
  };
  function load(page){
    const src=scripts[page];
    if(!src||loaded.has(page))return;
    loaded.add(page);
    const s=document.createElement('script');
    s.src=src;
    s.async=false;
    s.dataset.cxLazyPage=page;
    s.onerror=()=>{loaded.delete(page)};
    document.body.append(s);
  }
  document.addEventListener('click',e=>{
    const b=e.target?.closest?.('[data-cx-page]');
    if(!b)return;
    const page=b.dataset.cxPage;
    if(page==='sealed'||page==='seller')load(page);
  },true);
  // If a future shell restores directly into one of these pages, load it after ready.
  document.addEventListener('collectish:ready',()=>{
    queueMicrotask(()=>{
      const id=document.querySelector('.cx-page.active')?.id||'';
      if(id==='cxSealed')load('sealed');
      else if(id==='cxSeller')load('seller');
    });
  });
  window.CollectishLazyDataPages={load};
})();
