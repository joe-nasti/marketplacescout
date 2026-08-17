// Scout Sealed product imagery — exact TCGplayer product-id based.
(() => {
  const parseUuids=v=>{if(Array.isArray(v))return v.flatMap(parseUuids);if(typeof v==='string'){try{const x=JSON.parse(v);if(x!==v)return parseUuids(x)}catch{}return /^[0-9a-f-]{36}$/i.test(v)?[v]:[]}return []};
  const imgUrl=id=>id?`https://tcgplayer-cdn.tcgplayer.com/product/${encodeURIComponent(id)}_in_1000x1000.jpg`:'';
  let map=new Map(),ready=false,seq=0;
  async function loadMap(){
    try{
      const decks=await rest('mtgjson_decks?select=deck_key,sealed_product_uuids&deck_type=eq.Commander%20Deck&release_date=gte.2025-01-01');
      const uuids=[...new Set((decks||[]).flatMap(d=>parseUuids(d.sealed_product_uuids)))];
      if(!uuids.length)return;
      const prices=await rest(`sealed_product_price_current?select=sealed_uuid,product_id,raw_json&source=eq.tcgplayer_public&sealed_uuid=in.(${uuids.map(encodeURIComponent).join(',')})`);
      const byUuid=new Map((prices||[]).filter(p=>p?.product_id&&['exact','high'].includes(p?.raw_json?.matchConfidence)).map(p=>[p.sealed_uuid,p.product_id]));
      map=new Map((decks||[]).map(d=>{const id=parseUuids(d.sealed_product_uuids).map(u=>byUuid.get(u)).find(Boolean)||null;return[d.deck_key,id]}));
      ready=true;decorate();
    }catch(e){console.warn('Scout Sealed images',e)}
  }
  function picture(deckKey,detail=false){
    const id=map.get(deckKey);if(!id)return null;
    const wrap=document.createElement('div');wrap.className=detail?'cx-sealed-product-image cx-sealed-product-image-detail':'cx-sealed-product-image';
    const img=document.createElement('img');img.loading='lazy';img.decoding='async';img.alt='Sealed product';img.src=imgUrl(id);
    img.onerror=()=>wrap.remove();wrap.append(img);return wrap;
  }
  function decorateRows(){
    document.querySelectorAll('#cxSealedRows [data-deck]').forEach(row=>{
      if(row.querySelector('.cx-sealed-product-image'))return;
      const p=picture(row.dataset.deck);if(!p)return;
      const name=row.querySelector('.cx-sealed-name');if(name)name.prepend(p);
    });
  }
  function decorateDetail(){
    const row=document.querySelector('#cxSealedRows .cx-sealed-row.selected');const h=document.getElementById('cxSealedDetail');
    if(!row||!h||h.querySelector('.cx-sealed-product-image-detail'))return;
    const p=picture(row.dataset.deck,true);if(!p)return;
    const title=h.querySelector('h3');if(title)title.before(p);
  }
  function decorate(){if(!ready)return;decorateRows();decorateDetail()}
  const mo=new MutationObserver(()=>{const s=++seq;setTimeout(()=>{if(s===seq)decorate()},40)});
  function install(){const h=document.getElementById('cxSealed');if(!h)return;mo.observe(h,{childList:true,subtree:true});loadMap()}
  document.addEventListener('collectish:ready',install);if(document.getElementById('cxSealed'))install();
})();
