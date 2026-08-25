import { uiEvidenceMarker } from './ui-primitives.js';

let installed=false;

function add(el,...classes){if(el)el.classList.add(...classes)}
function adoptStatus(el,tone){if(el)add(el,'cx-ui-status',tone)}
function appendMarker(host,kind,help,key=kind){
  if(!host||host.querySelector?.(`[data-cx-adopted-evidence="${CSS.escape(key)}"]`))return;
  const wrap=document.createElement('span');
  wrap.dataset.cxAdoptedEvidence=key;
  wrap.innerHTML=uiEvidenceMarker(kind,help);
  const marker=wrap.firstElementChild;
  if(marker)host.appendChild(marker);
}
function labeledCell(row,label){return [...row.querySelectorAll('.cx-iv-num')].find(el=>String(el.querySelector('small')?.textContent||'').trim().toLowerCase()===label)||null}

function adoptSellerEvidence(){
  document.querySelectorAll('#cxSellerVnext .cx-sellv-row').forEach(row=>{
    const host=row.querySelector('.cx-sellv-state strong');if(!host)return;
    const text=String(host.textContent||'').trim();
    if(text==='Needs detail')appendMarker(host,'unmeasured','Order detail is not loaded yet.','seller-order');
    else if(text==='Refunded'||/^[123]★$/.test(text))appendMarker(host,'caution','Loaded order has an exception that needs attention.','seller-order');
    else appendMarker(host,'verified','Order detail is loaded; no current exception is flagged.','seller-order');
  });
}
function adoptInventoryEvidence(){
  document.querySelectorAll('#cxInventoryVnext .cx-iv-row').forEach(row=>{
    const scout=labeledCell(row,'scout'),velocity=labeledCell(row,'velocity');
    if(scout){const strong=scout.querySelector('strong'),value=String(strong?.textContent||'').trim();if(value==='—')appendMarker(strong,'unmeasured','Scout context is not loaded for this product.','inventory-scout');else appendMarker(strong,'inferred','Scout is a modeled opportunity score, not a directly observed market fact.','inventory-scout')}
    if(velocity){const strong=velocity.querySelector('strong'),value=String(strong?.textContent||'').trim();if(value==='—')appendMarker(strong,'unmeasured','Marketplace sales velocity has not been measured for this product.','inventory-velocity');else appendMarker(strong,'verified','Measured TCGplayer marketplace velocity; this does not mean the sales were Direct.','inventory-velocity')}
  });
}

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
  adoptInventoryEvidence();

  // Seller reports + dense dashboard
  add(document.querySelector('#cxSeller.cx-seller-reports-vnext .cx-seller-tabs'),'cx-ui-tabs');
  add(document.querySelector('#cxSellerReportContext'),'cx-ui-metrics');
  document.querySelectorAll('#cxSellerReportContext .cx-sellr-metric').forEach(el=>add(el,'cx-ui-metric'));
  adoptSellerEvidence();

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
