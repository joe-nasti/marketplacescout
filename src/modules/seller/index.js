let installed=false;
let operatingObserver=null;
const OPERATING_CARD_IDS=new Set(['cxSellerCashflowBudget','cxBuyerAccountImport']);

function keepOperatingCardsVisible(){
  const host=document.getElementById('cxSeller');
  if(!host)return;
  for(const id of OPERATING_CARD_IDS){
    const el=document.getElementById(id);
    if(el?.hidden)el.hidden=false;
    if(el)el.dataset.sellerPersistent='1';
  }
}

function watchOperatingCards(){
  const host=document.getElementById('cxSeller');
  if(!host)return;
  operatingObserver?.disconnect();
  operatingObserver=new MutationObserver(mutations=>{
    let relevant=false;
    for(const m of mutations){
      if(m.type==='childList'){relevant=true;break}
      const target=m.target;
      if(m.type==='attributes'&&m.attributeName==='hidden'&&target instanceof HTMLElement&&OPERATING_CARD_IDS.has(target.id)){relevant=true;break}
    }
    if(relevant)queueMicrotask(keepOperatingCardsVisible);
  });
  operatingObserver.observe(host,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
  keepOperatingCardsVisible();
}

export async function install(){
  if(installed)return;
  installed=true;

  // Seller remains a lazy page. Keep all Seller-only enhancers here so they load
  // when the Seller tab opens without adding work to the Scout startup path.
  await Promise.all([
    import('./orders.js'),
    import('./order-meta.js'),
    import('./filters.js'),
    import('./drilldowns.js'),
    import('./detail-polish.js'),
    import('./dashboard-vnext.js'),
    import('./reports-vnext.js'),
    import('./cashflow-budget.js'),
    import('./buyer-account.js')
  ]);

  // Dashboard vNext intentionally hides legacy/report children while in Dashboard
  // mode. Cash-flow and buyer-account cards are operating controls, not legacy
  // reports, so keep them visible even when dashboard mode re-renders later.
  watchOperatingCards();
  document.addEventListener('collectish:seller-rendered',()=>queueMicrotask(keepOperatingCardsVisible));
  document.addEventListener('collectish:seller-tab-rendered',()=>queueMicrotask(keepOperatingCardsVisible));
}
