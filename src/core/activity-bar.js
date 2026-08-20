import store from '../state/store.js';

let installed=false;
let stop=null;
let hideTimer=null;

function activeFromState(state){
  const runtime=state.runtime||{};
  const seller=state.seller||{};
  const inventory=state.inventory||{};
  const explicit=Object.values(runtime.userActivities||{}).filter(Boolean);
  const sellerBusy=['queued','running'].includes(seller.manualSyncStatus);
  const inventoryBusy=inventory.status==='syncing';
  const labels=[
    ...explicit.map(x=>typeof x==='string'?x:x?.label).filter(Boolean),
    sellerBusy?'Syncing Seller history':null,
    inventoryBusy?'Syncing inventory':null
  ].filter(Boolean);
  return {active:Boolean(explicit.length||sellerBusy||inventoryBusy),label:labels[0]||'Working'};
}

function render(value=activeFromState(store.get())){
  const el=document.getElementById('cxNetworkProgress');
  if(!el)return;
  clearTimeout(hideTimer);
  if(value.active){
    el.dataset.active='1';
    el.setAttribute('aria-hidden','false');
    el.setAttribute('aria-label',value.label);
    el.title=value.label;
    return;
  }
  el.dataset.finishing='1';
  hideTimer=setTimeout(()=>{
    delete el.dataset.active;
    delete el.dataset.finishing;
    el.setAttribute('aria-hidden','true');
    el.removeAttribute('aria-label');
    el.removeAttribute('title');
  },220);
}

function activities(){return {...(store.get().runtime?.userActivities||{})}}

export function beginUserActivity(id,label='Working…'){
  if(!id)return;
  const next=activities();
  next[id]={label,startedAt:Date.now()};
  store.update('runtime',{userActivities:next});
}

export function endUserActivity(id){
  if(!id)return;
  const next=activities();
  if(!(id in next))return;
  delete next[id];
  store.update('runtime',{userActivities:next});
}

export async function trackUserActivity(id,label,promiseOrFactory){
  beginUserActivity(id,label);
  try{return await (typeof promiseOrFactory==='function'?promiseOrFactory():promiseOrFactory)}
  finally{endUserActivity(id)}
}

export function installActivityBar(){
  if(installed)return;
  installed=true;
  stop=store.subscribe(activeFromState,value=>render(value));
  document.addEventListener('collectish:shell-rendered',()=>queueMicrotask(()=>render()));
  window.CollectishActivity={begin:beginUserActivity,end:endUserActivity,track:trackUserActivity};
}

export function uninstallActivityBar(){stop?.();stop=null;installed=false;clearTimeout(hideTimer)}
