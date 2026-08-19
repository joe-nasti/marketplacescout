function safeCall(fn,fallback='unknown'){try{return fn?.()??fallback}catch{return fallback}}
function parseProbe(raw){try{return JSON.parse(String(raw||'{}'))}catch{return {}}}
function classifyStore(bridge){
  if(!bridge)return {label:'Unavailable',sub:'update app for sync'};
  const state=String(safeCall(()=>bridge.getReadOnlyProbeState?.(),'unknown'));
  const probe=parseProbe(safeCall(()=>bridge.getReadOnlyProbeResult?.(),'{}'));
  const url=String(probe?.url||'').toLowerCase();
  const error=String(probe?.error||'').toLowerCase();
  if(error.includes('login')||error.includes('not authenticated')||error.includes('signed out'))return {label:'Signed out',sub:'Store login required'};
  if(probe?.ok===true&&url.includes('store.tcgplayer.com'))return {label:'Verified',sub:'authenticated Store request succeeded'};
  if(state==='running'||state==='starting')return {label:'Checking…',sub:'verifying Store session'};
  return {label:'Not yet verified',sub:'checked on next Store request'};
}
function sellerState(android){
  if(!android)return {label:'Unavailable',sub:'Android bridge missing'};
  const raw=String(safeCall(()=>android.getSessionState?.(),'unknown'));
  if(raw==='authenticated')return {label:'Authenticated',sub:'shared TCGplayer WebView session'};
  if(raw==='signed_out')return {label:'Signed out',sub:'Seller Portal login required'};
  return {label:'Unknown',sub:'session has not been confirmed'};
}
function findStat(host,label){
  return [...host.querySelectorAll('.cx-inventory-stat')].find(el=>el.querySelector('span')?.textContent?.trim()===label)||null;
}
function setTextIfChanged(el,value){if(el&&el.textContent!==value)el.textContent=value}
function setStat(el,label,value,sub){
  if(!el)return;
  const title=el.querySelector('span'),strong=el.querySelector('strong');let small=el.querySelector('small');
  setTextIfChanged(title,label);setTextIfChanged(strong,value);
  if(!small){small=document.createElement('small');el.appendChild(small)}
  setTextIfChanged(small,sub||'');
}
function ensureExtraStat(host,id){
  let el=host.querySelector(`[data-inventory-auth-stat="${id}"]`);if(el)return el;
  const grid=host.querySelector('.cx-inventory-kpis');if(!grid)return null;
  el=document.createElement('div');el.className='cx-inventory-stat';el.dataset.inventoryAuthStat=id;el.innerHTML='<span></span><strong></strong><small></small>';grid.appendChild(el);return el;
}
export function refreshInventorySessionStatus(){
  const host=document.getElementById('cxInventory');if(!host)return;
  const android=window.CollectishAndroid||null,bridge=window.CollectishReadOnly||null;
  const existing=findStat(host,'Store session')||findStat(host,'Android bridge');
  setStat(existing,'Android bridge',bridge?'Ready':'Unavailable',bridge?'read-only Store bridge available':'update app for sync');
  const seller=ensureExtraStat(host,'seller'),store=ensureExtraStat(host,'store');
  const s=sellerState(android),t=classifyStore(bridge);
  setStat(seller,'Seller session',s.label,s.sub);setStat(store,'Store session',t.label,t.sub);
}
let timer=null;
export function installInventorySessionStatus(){
  clearInterval(timer);
  // Do not observe the entire DOM here. The previous MutationObserver watched the
  // same nodes this diagnostic updates, creating a self-triggering microtask loop
  // that could starve the Inventory renderer and leave only the progress panel.
  timer=setInterval(refreshInventorySessionStatus,1000);
  setTimeout(refreshInventorySessionStatus,0);
}
