import './ui-primitives.js';

let installed=false;

function add(el,...classes){if(el)el.classList.add(...classes)}
function adoptStatus(el,tone){if(el)add(el,'cx-ui-status',tone)}

function sync(){
  // Signals
  add(document.querySelector('#cxSignalsVnext .cx-sv-nav'),'cx-ui-tabs');
  add(document.querySelector('#cxSignalsVnext .cx-sv-metrics'),'cx-ui-metrics');
  document.querySelectorAll('#cxSignalsVnext .cx-sv-metric').forEach(el=>add(el,'cx-ui-metric'));
  add(document.querySelector('#cxSignalsVnext .cx-sv-list'),'cx-ui-list');
  document.querySelectorAll('#cxSignalsVnext .cx-sv-chip').forEach(el=>{
    if(el.classList.contains('cx-sv-action'))adoptStatus(el,'success');
    else if(el.classList.contains('cx-sv-emerging'))adoptStatus(el,'accent');
    else adoptStatus(el,'muted');
  });

  // Inventory
  add(document.querySelector('#cxInventoryVnext .cx-iv-nav'),'cx-ui-tabs');
  add(document.querySelector('#cxInventoryVnext .cx-iv-metrics'),'cx-ui-metrics');
  document.querySelectorAll('#cxInventoryVnext .cx-iv-metric').forEach(el=>add(el,'cx-ui-metric'));
  add(document.querySelector('#cxInventoryVnext .cx-iv-list'),'cx-ui-list');
  document.querySelectorAll('#cxInventoryVnext .cx-iv-chip').forEach(el=>{
    if(el.classList.contains('cx-iv-exit'))adoptStatus(el,'success');
    else if(el.classList.contains('cx-iv-reprice'))adoptStatus(el,'warning');
    else if(el.classList.contains('cx-iv-restock'))adoptStatus(el,'accent');
    else if(el.classList.contains('cx-iv-review'))adoptStatus(el,'warning');
    else adoptStatus(el,'muted');
  });

  // Seller reports
  add(document.querySelector('#cxSeller.cx-seller-reports-vnext .cx-seller-tabs'),'cx-ui-tabs');
  add(document.querySelector('#cxSellerReportContext'),'cx-ui-metrics');
  document.querySelectorAll('#cxSellerReportContext .cx-sellr-metric').forEach(el=>add(el,'cx-ui-metric'));

  // Scout saved views and filters use the same compact tab behavior.
  add(document.querySelector('#cxScoutIa .cx-scout-saved-views'),'cx-ui-tabs');
}

function schedule(){for(const ms of [0,80,220])setTimeout(sync,ms)}

export function installUiAdoption(){
  if(installed)return;
  installed=true;
  for(const name of [
    'collectish:ready','collectish:page-change','collectish:scout-list-rendered',
    'collectish:intel-changed','collectish:actionable-emerging-changed',
    'collectish:inventory-modules-ready','collectish:inventory-workspace-rendered',
    'collectish:seller-rendered','collectish:seller-tab-rendered'
  ])document.addEventListener(name,schedule);
  queueMicrotask(schedule);
}

installUiAdoption();
window.CollectishUiPrimitives={sync};
