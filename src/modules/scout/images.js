import store from '../../state/store.js';

// Scout list images — viewport lazy loading + detail-to-list image sync.
(() => {
  let observer=null, token=0, installed=false;
  const meta=new Map();
  const pending=new Set();
  const escCss=v=>CSS.escape(String(v??''));
  const slots=()=>[...document.querySelectorAll('#cxParityCards [data-v5-thumb]')];
  const setImg=(slot,src,alt='')=>{
    if(!slot||!src)return;
    const current=slot.querySelector('img');
    if(current?.src===src)return;
    slot.innerHTML='';
    const img=document.createElement('img');
    img.loading='lazy';img.decoding='async';img.src=src;img.alt=alt||'';
    img.onerror=()=>{if(slot.contains(img)){img.remove(); if(!slot.children.length){const p=document.createElement('div');p.className='cx-scout-thumb-placeholder';p.textContent=slot.closest('.cx-scout-card')?.querySelector('.cx-grade')?.textContent?.trim()||'•';slot.append(p)}}};
    slot.append(img);
  };

  function hydrateFromStore(ids){
    const wanted=new Set(ids);
    for(const r of store.get()?.scout?.rows||[]){
      const sku=String(r?.sku_id||'');
      if(sku&&wanted.has(sku)&&r?.product_id)meta.set(sku,{sku_id:sku,product_id:r.product_id,product_name:r.product_name||''});
    }
  }

  async function hydrateMeta(){
    const ids=slots().map(s=>String(s.dataset.v5Thumb||'')).filter(Boolean).filter(x=>!meta.has(x));
    if(!ids.length)return;

    // The renderer already loaded these rows into shared state. Reuse them first so
    // normal list rendering creates zero duplicate Supabase round trips for images.
    hydrateFromStore(ids);
    const missing=ids.filter(x=>!meta.has(x));
    if(!missing.length)return;

    // Fallback only for unusual cases where a slot exists without a corresponding
    // row in the current Scout state (for example, an independently rendered card).
    const my=++token;
    try{
      for(let i=0;i<missing.length;i+=80){
        const batch=missing.slice(i,i+80);
        const rows=await window.rest(`scout_opportunities_v5?select=sku_id,product_id,product_name&sku_id=in.(${batch.map(encodeURIComponent).join(',')})`);
        if(my!==token)return;
        for(const r of rows||[])meta.set(String(r.sku_id),r);
      }
    }catch{}
  }
  function tcgImage(productId){return productId?`https://tcgplayer-cdn.tcgplayer.com/product/${encodeURIComponent(productId)}_in_1000x1000.jpg`:''}
  async function loadSlot(slot){
    if(!slot||slot.dataset.cxImgLoaded==='1'||pending.has(slot))return;
    pending.add(slot);
    try{
      const sku=String(slot.dataset.v5Thumb||'');
      if(!meta.has(sku))await hydrateMeta();
      const r=meta.get(sku);const src=tcgImage(r?.product_id);
      if(src){setImg(slot,src,r?.product_name||'');slot.dataset.cxImgLoaded='1'}
    }finally{pending.delete(slot)}
  }
  function observe(){
    observer?.disconnect();
    observer=new IntersectionObserver(entries=>{
      for(const e of entries)if(e.isIntersecting){observer.unobserve(e.target);loadSlot(e.target)}
    },{root:null,rootMargin:'500px 0px',threshold:0.01});
    for(const s of slots()){
      if(s.querySelector('img')){s.dataset.cxImgLoaded='1';continue}
      observer.observe(s);
    }
    hydrateMeta();
  }
  function syncDetailToSelected(){
    const card=document.querySelector('#cxParityCards .cx-scout-card.selected');
    const hero=document.querySelector('#cxParityDetail .cx-scout-hero');
    const sku=card?.dataset?.sku;
    const slot=sku?document.querySelector(`#cxParityCards [data-v5-thumb="${escCss(sku)}"]`):null;
    if(slot&&hero?.src){setImg(slot,hero.src,hero.alt||'');slot.dataset.cxImgLoaded='1'}
  }
  function scheduleDetailSync(){[120,300,700,1400].forEach(ms=>setTimeout(syncDetailToSelected,ms))}
  function refresh(){setTimeout(observe,0)}
  function install(){
    if(installed)return;installed=true;
    document.addEventListener('collectish:scout-v5-ready',refresh);
    document.addEventListener('input',e=>{if(e.target?.id==='cxParitySearch')setTimeout(refresh,50)},true);
    document.addEventListener('change',e=>{if(e.target?.id==='cxParityGrade'||e.target?.id==='cxParitySet')setTimeout(refresh,50)},true);
    document.addEventListener('click',e=>{if(e.target?.closest?.('#cxParityCards .cx-scout-card'))scheduleDetailSync()},true);
    if(document.querySelector('#cxParityCards'))refresh();
  }
  document.addEventListener('collectish:ready',install);
  if(document.getElementById('collectishUxShell'))install();
  window.CollectishScoutListImages={refresh,observe,syncDetailToSelected};
})();
