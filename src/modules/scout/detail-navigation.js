import store from '../../state/store.js';
import { prefetchAskCardContext } from './ask-prefetch.js';

let installed=false;
const skuOf=value=>String(value??'');

function resolveSummary(detail={}){
  const sku=skuOf(detail.sku_id??detail.sku);
  if(!sku)return null;
  const state=store.get().scout||{};
  const row=(state.rows||[]).find(r=>skuOf(r.sku_id)===sku);
  if(row)return {...detail,...row};
  return {
    ...detail,
    sku_id:detail.sku_id??detail.sku,
    product_id:detail.product_id,
    product_name:detail.product_name||detail.card_name||'',
    card_name:detail.card_name||detail.product_name||''
  };
}

export function openScoutDetail(detail={}){
  const renderer=window.CollectishScoutRenderer;
  if(!renderer?.renderDetail)return false;
  const summary=resolveSummary(detail);
  if(!summary)return false;

  const sku=skuOf(summary.sku_id);
  store.update('scout',{selectedSku:summary.sku_id});
  document.querySelectorAll('#cxParityCards .cx-scout-card[data-sku]').forEach(card=>{
    card.classList.toggle('selected',skuOf(card.dataset.sku)===sku);
  });
  void renderer.renderDetail(summary,true);
  void prefetchAskCardContext(summary);
  return true;
}

function click(e){
  const hit=e.target.closest?.('#cxScout .cx-scout-card[data-sku], #cxScout [data-quick-turn-sku]');
  if(!hit)return;
  const detail=hit.dataset.quickTurnSku
    ? {sku_id:hit.dataset.quickTurnSku}
    : {sku_id:hit.dataset.sku};
  if(!openScoutDetail(detail))return;
  e.preventDefault();
  e.stopImmediatePropagation();
}

function openEvent(e){
  openScoutDetail(e.detail||{});
}

export function installScoutDetailNavigation(){
  if(installed)return;
  installed=true;
  document.addEventListener('click',click,true);
  document.addEventListener('collectish:open-scout-card',openEvent);
}

installScoutDetailNavigation();
window.CollectishScoutDetailNavigation={open:openScoutDetail};
