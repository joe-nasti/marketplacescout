// Ask Collectish Investigate bridge.
// Route the visible Investigate action through normal Ask so the shared Pass 3
// evidence layer (sales, supply, EDHREC, Signals) is authoritative.
(() => {
  const active=()=>String(document.querySelector('.cx-page.active')?.id||'').replace(/^cx/,'').toLowerCase();
  function context(){
    const screen=active()||'unknown';
    if(screen!=='scout')return {screen};
    const card=document.querySelector('#cxParityCards .cx-scout-card.selected');
    const sku=card?.dataset?.sku||null;
    const href=document.querySelector('#cxParityDetail a[href*="tcgplayer.com/product/"]')?.getAttribute('href')||'';
    const product=(/\/product\/(\d+)/.exec(href)||[])[1]||null;
    const name=card?.querySelector('.cx-scout-card-body>strong')?.textContent?.trim()||null;
    return {screen,sku_id:sku,product_id:product,product_name_hint:name};
  }
  function add(role,text){
    const h=document.getElementById('cxAskMessages');if(!h)return null;
    const w=document.createElement('div');w.className=`cx-ask-msg cx-ask-${role}`;
    const b=document.createElement('div');b.className='cx-ask-msg-body';b.textContent=text;w.append(b);h.append(w);h.scrollTop=h.scrollHeight;return w;
  }
  async function investigate(){
    const c=context();
    if(!c.sku_id&&!c.product_id){add('system','Open a Scout card first, then Investigate.');return}
    const state=document.getElementById('cxAskInvestigateState');if(state)state.textContent='Investigating…';
    const prompt='Investigate this card using current Scout, exact-SKU sales history, price history, supply, shared EDHREC rank, linked Signals, vendor exits and data quality. Give a concise BUY/WATCH/PASS verdict, strongest evidence, contradictions/risks, and clearly identify any missing data.';
    try{
      if(window.AskCollectish?.send){await window.AskCollectish.send(prompt);if(state)state.textContent='Investigation complete';return}
      add('system','Ask Collectish is still loading. Try Investigate again in a moment.');if(state)state.textContent='Investigate unavailable';
    }catch(e){add('system',e?.message||String(e));if(state)state.textContent='Investigate failed'}
  }
  document.addEventListener('click',e=>{const b=e.target?.closest?.('#cxAskInvestigate');if(!b)return;e.preventDefault();e.stopImmediatePropagation();void investigate()},true);
  window.CollectishAskV3Safe={...(window.CollectishAskV3Safe||{}),investigate,context};
})();
