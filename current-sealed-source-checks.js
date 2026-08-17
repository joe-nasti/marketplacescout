// Scout Sealed source cross-checks — TCG scoring identity + CK secondary retail reference.
(() => {
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
  const parseUuids=v=>{if(Array.isArray(v))return v.flatMap(parseUuids);if(typeof v==='string'){try{const x=JSON.parse(v);if(x!==v)return parseUuids(x)}catch{}return /^[0-9a-f-]{36}$/i.test(v)?[v]:[]}return []};
  let seq=0,lastDeck='';
  function trustedTcg(p){return p?.source==='tcgplayer_public'&&p?.raw_json?.matchGuard==='standalone-v3'&&['exact','high'].includes(p?.raw_json?.matchConfidence)}
  function trustedCk(p){return p?.source==='cardkingdom_public'&&['standalone-v5','standalone-v6'].includes(p?.raw_json?.matchGuard)&&['high','medium'].includes(p?.raw_json?.matchConfidence)}
  function block(tcg,ck){
    const tq=tcg?.raw_json?.matchConfidence||'—',tm=tcg?.raw_json?.matchMethod||'—',cq=ck?.raw_json?.matchConfidence||'—',stock=ck?.raw_json?.stock||'—';
    return `<section class="cx-v5-section cx-sealed-source-check"><div class="cx-section-title">Sealed source checks</div><div class="cx-sealed-grid"><div class="cx-sealed-stat"><span>TCG Low + shipping</span><strong>${money(tcg?.low_with_shipping)}</strong><small>${esc(tcg?.product_name||'No trusted TCG match')}</small></div><div class="cx-sealed-stat"><span>TCG Market</span><strong>${money(tcg?.market_price)}</strong><small>identity ${esc(tq)} · ${esc(tm)}</small></div><div class="cx-sealed-stat"><span>Card Kingdom retail</span><strong>${money(ck?.market_price)}</strong><small>${esc(ck?.product_name||'secondary match unavailable')}</small></div><div class="cx-sealed-stat"><span>CK status</span><strong>${ck?esc(stock.replaceAll('_',' ')):'—'}</strong><small>${ck?`match ${esc(cq)} · reference only`:'not used in score'}</small></div></div></section>`;
  }
  async function decorate(deckKey){
    if(!deckKey)return;lastDeck=deckKey;const my=++seq;
    try{
      const ds=await rest(`mtgjson_decks?select=sealed_product_uuids&deck_key=eq.${encodeURIComponent(deckKey)}&limit=1`),ids=parseUuids(ds?.[0]?.sealed_product_uuids);if(my!==seq||!ids.length)return;
      const prices=await rest(`sealed_product_price_current?select=*&sealed_uuid=in.(${ids.map(encodeURIComponent).join(',')})`);if(my!==seq)return;
      const tcg=(prices||[]).find(trustedTcg)||null,ck=(prices||[]).find(trustedCk)||null;
      const h=document.getElementById('cxSealedDetail');if(!h||lastDeck!==deckKey)return;
      h.querySelector('.cx-sealed-source-check')?.remove();
      const summary=h.querySelector('.cx-sealed-summary'),wrap=document.createElement('div');wrap.innerHTML=block(tcg,ck);const node=wrap.firstElementChild;if(summary)summary.before(node);else h.append(node);
    }catch(e){console.warn('Sealed source checks',e)}
  }
  document.addEventListener('click',e=>{const row=e.target.closest('#cxSealedRows [data-deck]');if(row)setTimeout(()=>decorate(row.dataset.deck),120)},true);
  const mo=new MutationObserver(()=>{const row=document.querySelector('#cxSealedRows .cx-sealed-row.selected');if(row&&row.dataset.deck!==lastDeck)setTimeout(()=>decorate(row.dataset.deck),80)});
  function install(){const h=document.getElementById('cxSealed');if(h)mo.observe(h,{childList:true,subtree:true})}
  document.addEventListener('collectish:ready',install);if(document.getElementById('cxSealed'))install();
})();
