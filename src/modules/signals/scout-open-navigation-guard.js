import store from '../../state/store.js';

let installed=false;

function onOpenScoutCard(event){
  const page=store.get().navigation?.page||'scout';
  if(page==='scout'||event.detail?.navigateToScout===true)return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function onClick(event){
  const row=event.target.closest?.('#cxSignals [data-sv-open], #cxSignals [data-discovery-open]');
  if(!row)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const detail={
    sku_id:row.dataset.sku||null,
    product_id:row.dataset.product||null,
    scryfall_id:row.dataset.scryfall||null,
    card_name:row.dataset.card||null,
    navigateToScout:true,
    source:row.hasAttribute('data-discovery-open')?'signals-discovery':'signals'
  };
  window.CollectishShell?.switchPage?.('scout');
  queueMicrotask(()=>document.dispatchEvent(new CustomEvent('collectish:open-scout-card',{detail})));
}

export function installScoutOpenNavigationGuard(){
  if(installed)return;
  installed=true;
  document.addEventListener('collectish:open-scout-card',onOpenScoutCard,true);
  document.addEventListener('click',onClick,true);
}

installScoutOpenNavigationGuard();
