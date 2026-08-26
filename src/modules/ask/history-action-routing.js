// Keep historical chart actions on the deterministic exact-SKU history path.
(() => {
  if(window.__collectishHistoryActionRoutingInstalled)return;
  window.__collectishHistoryActionRoutingInstalled=true;

  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('.cx-ask-surface-action');
    if(!button)return;
    const label=String(button.textContent||'').trim().toLowerCase();
    if(label!=='what caused the move?'&&label!=='explain move')return;
    const priceSurface=button.closest('.cx-ask-surface');
    if(!priceSurface?.querySelector?.('.cx-ask-surface-heading strong')?.textContent?.toLowerCase?.().includes('price history'))return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.AskCollectish?.send?.('Compare sales history to exact SKU price history over the same period and explain the price move concisely.');
  },true);
})();
