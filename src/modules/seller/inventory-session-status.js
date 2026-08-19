function safeCall(fn,fallback='unknown'){try{return fn?.()??fallback}catch{return fallback}}
function parseProbe(raw){try{return JSON.parse(String(raw||'{}'))}catch{return {}}}
function classifyStore(bridge){
  if(!bridge)return {label:'Unavailable',sub:'update app for sync'};
  const state=String(safeCall(()=>bridge.getReadOnlyProbeState?.(),'unknown'));
  const probe=parseProbe(safeCall(()=>bridge.getReadOnlyProbeResult?.(),'{}'));
  const url=String(probe?.url||'').toLowerCase();
  const error=String(probe?.error||'').toLowerCase();
  if(probe?.ok===true&&url.includes('store.tcgplayer.com'))return {label:'Verified',sub:'authenticated Store request succeeded'};
  if(error.includes('login')||error.includes('not authenticated')||error.includes('signed out'))return {label:'Signed out',sub:'Store login required'};
  if(state==='running'||state==='starting')return {label:'Checking…',sub:'verifying Store session'};
  return {label:'Not yet verified',sub:'checked on next Store request'};
}
function sellerState(android,storeState){
  if(!android)return {label:'Unavailable',sub:'Android bridge missing'};
  const raw=String(safeCall(()=>android.getSessionState?.(),'unknown'));
  if(raw==='authenticated')return {label:'Authenticated',sub:'shared TCGplayer WebView session'};
  if(raw==='signed_out'&&storeState?.label==='Verified')return {label:'Portal signed out',sub:'Inventory Store session is authenticated'};
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
function ensureLoginAction(host,show){
  let row=host.querySelector('#cxInventoryLoginAction');
  if(!show){row?.remove();return}
  if(row)return;
  const grid=host.querySelector('.cx-inventory-kpis');if(!grid)return;
  row=document.createElement('div');row.id='cxInventoryLoginAction';row.className='cx-card';
  row.style.marginTop='12px';row.style.padding='12px';
  row.innerHTML='<strong style="display:block;margin-bottom:4px">TCGplayer login required</strong><span style="display:block;margin-bottom:10px">Open the shared TCGplayer WebView, sign in, then return to Inventory.</span><button type="button" class="cx-refresh" id="cxInventoryOpenTcgLogin">Open TCGplayer login</button>';
  grid.after(row);
  row.querySelector('#cxInventoryOpenTcgLogin')?.addEventListener('click',()=>{try{window.CollectishAndroid?.showSellerPortal?.()}catch{}});
}
export function refreshInventorySessionStatus(){
  const host=document.getElementById('cxInventory');if(!host)return;
  const android=window.CollectishAndroid||null,bridge=window.CollectishReadOnly||null;
  const existing=findStat(host,'Store session')||findStat(host,'Android bridge');
  setStat(existing,'Android bridge',bridge?'Ready':'Unavailable',bridge?'read-only Store bridge available':'update app for sync');
  const seller=ensureExtraStat(host,'seller'),store=ensureExtraStat(host,'store');
  const t=classifyStore(bridge),s=sellerState(android,t);
  setStat(seller,'Seller session',s.label,s.sub);setStat(store,'Store session',t.label,t.sub);
  const needsLogin=t.label==='Signed out'||(t.label==='Not yet verified'&&s.label==='Signed out');
  ensureLoginAction(host,Boolean(android?.showSellerPortal)&&needsLogin);
}
let timer=null;
export function installInventorySessionStatus(){
  clearInterval(timer);
  timer=setInterval(refreshInventorySessionStatus,1000);
  setTimeout(refreshInventorySessionStatus,0);
}
