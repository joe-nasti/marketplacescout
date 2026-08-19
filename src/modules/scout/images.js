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
  async function hydrateMeta(){
    const ids=slots().map(s=>String(s.dataset.v5Thumb||'')).filter(Boolean).filter(x=>!meta.has(x));
    if(!ids.length)return;
    const my=++token;
    try{
      for(let i=0;i<ids.length;i+=80){
        const batch=ids.slice(i,i+80);
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
