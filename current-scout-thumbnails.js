// Collectish Scout thumbnail loader — viewport-aware artwork loading with detail-to-list sync.
(() => {
  const rowMeta = new Map();
  const imageBySku = new Map();
  const loadingSku = new Set();
  let observer = null;
  let refreshQueued = false;

  const esc = s => String(s ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  function slotForSku(sku){
    try { return document.querySelector(`#cxParityCards [data-thumb="${CSS.escape(String(sku))}"]`); }
    catch { return null; }
  }

  function paint(sku, url, name=''){
    if(!sku || !url) return;
    imageBySku.set(String(sku), url);
    const slot = slotForSku(sku);
    if(!slot) return;
    const existing = slot.querySelector('img');
    if(existing?.src === url) return;
    slot.innerHTML = `<img loading="lazy" decoding="async" src="${esc(url)}" alt="${esc(name)}">`;
  }

  function imageUrl(card){
    return card?.image_uris?.normal || card?.image_uris?.large || card?.card_faces?.find(x=>x.image_uris)?.image_uris?.normal || '';
  }

  async function ensureMetaForCards(cards){
    const missing = [...new Set(cards.map(c=>String(c.dataset.sku||'')).filter(s=>s && !rowMeta.has(s)))];
    if(!missing.length) return;
    // Keep URLs comfortably below browser/proxy limits.
    for(let i=0;i<missing.length;i+=50){
      const ids = missing.slice(i,i+50);
      try {
        const rows = await rest(`scout_opportunities_24h?select=sku_id,product_name,scryfall_id,set_code,collector_number&sku_id=in.(${ids.map(encodeURIComponent).join(',')})`);
        for(const r of rows||[]) rowMeta.set(String(r.sku_id||''), r);
      } catch(e){ console.warn('Scout thumbnail metadata unavailable', e); }
    }
  }

  async function loadCards(cards){
    if(!cards.length) return;
    await ensureMetaForCards(cards);
    const targets=[];
    for(const card of cards){
      const sku=String(card.dataset.sku||'');
      if(!sku) continue;
      const cached=imageBySku.get(sku);
      if(cached){ paint(sku,cached,rowMeta.get(sku)?.product_name||''); continue; }
      if(loadingSku.has(sku)) continue;
      const m=rowMeta.get(sku);
      if(!m) continue;
      loadingSku.add(sku);
      targets.push({sku,meta:m});
    }
    if(!targets.length) return;

    // Scryfall collection endpoint resolves up to 75 exact IDs in one request.
    const withId=targets.filter(x=>x.meta.scryfall_id);
    for(let i=0;i<withId.length;i+=75){
      const batch=withId.slice(i,i+75);
      try{
        const r=await fetch('https://api.scryfall.com/cards/collection',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({identifiers:batch.map(x=>({id:x.meta.scryfall_id}))})
        });
        if(r.ok){
          const body=await r.json();
          const byId=new Map((body.data||[]).map(c=>[String(c.id||''),c]));
          for(const x of batch){
            const c=byId.get(String(x.meta.scryfall_id||''));
            const u=imageUrl(c); if(u) paint(x.sku,u,x.meta.product_name||'');
          }
        }
      }catch(e){ console.warn('Scout thumbnail batch failed', e); }
    }

    // Rare rows without a stored Scryfall ID: resolve individually only when visible.
    const fallback=targets.filter(x=>!x.meta.scryfall_id);
    for(const x of fallback){
      try{
        let url='';
        if(x.meta.set_code && x.meta.collector_number){
          url=`https://api.scryfall.com/cards/${encodeURIComponent(String(x.meta.set_code).toLowerCase())}/${encodeURIComponent(x.meta.collector_number)}`;
        } else if(x.meta.product_name){
          url=`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(x.meta.product_name)}`;
        }
        if(!url) continue;
        const r=await fetch(url); if(!r.ok) continue;
        const c=await r.json(),u=imageUrl(c); if(u) paint(x.sku,u,x.meta.product_name||'');
      }catch{}
    }
    for(const x of targets) loadingSku.delete(x.sku);
  }

  function installObserver(){
    observer?.disconnect();
    observer = new IntersectionObserver(entries=>{
      const cards=[];
      for(const e of entries){
        if(!e.isIntersecting) continue;
        observer.unobserve(e.target);
        cards.push(e.target);
      }
      if(cards.length) loadCards(cards);
    },{root:null,rootMargin:'500px 0px',threshold:0.01});
    document.querySelectorAll('#cxParityCards .cx-scout-card').forEach(card=>{
      const sku=String(card.dataset.sku||'');
      const cached=imageBySku.get(sku);
      if(cached) paint(sku,cached,rowMeta.get(sku)?.product_name||'');
      else observer.observe(card);
    });
  }

  function syncDetailHero(){
    const detail=document.getElementById('cxParityDetail');
    const hero=detail?.querySelector('.cx-scout-hero');
    const selected=document.querySelector('#cxParityCards .cx-scout-card.selected');
    const sku=String(selected?.dataset.sku||'');
    if(hero?.src && sku) paint(sku,hero.src,selected?.querySelector('.cx-scout-card-body > strong')?.textContent||'');
  }

  function scheduleRefresh(){
    if(refreshQueued) return;
    refreshQueued=true;
    requestAnimationFrame(()=>{refreshQueued=false;installObserver();syncDetailHero();});
  }

  const mo=new MutationObserver(muts=>{
    if(muts.some(m=>m.target.id==='cxParityCards' || m.target.id==='cxParityDetail' || m.target.closest?.('#cxParityCards') || m.target.closest?.('#cxParityDetail'))) scheduleRefresh();
  });
  mo.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('click',e=>{
    if(e.target.closest?.('#cxParityCards .cx-scout-card')) setTimeout(syncDetailHero,100);
    if(e.target.closest?.('[data-cx-page="scout"]')) setTimeout(scheduleRefresh,150);
  },true);
  setTimeout(scheduleRefresh,200);
})();
