import store from '../../state/store.js';

let installed=false;
let applying=false;
const MODES=new Set(['dashboard','reports']);
const TABS=new Set(['overview','orders','products','refunds','reviews','payments','ris']);

function read(){
  const p=new URL(location.href).searchParams;
  return {
    mode:MODES.has(p.get('sell'))?p.get('sell'):'dashboard',
    tab:TABS.has(p.get('report'))?p.get('report'):'overview'
  };
}
function write(){
  if(applying||store.get().navigation?.page!=='seller')return;
  const seller=store.get().seller||{},p=new URL(location.href).searchParams;
  const mode=MODES.has(seller.mode)?seller.mode:'dashboard',tab=TABS.has(seller.tab)?seller.tab:'overview';
  if(mode==='reports')p.set('sell','reports');else p.delete('sell');
  if(mode==='reports'&&tab!=='overview')p.set('report',tab);else p.delete('report');
  p.set('tab','seller');
  history.replaceState({collectish:true},'',`${location.pathname}?${p.toString()}${location.hash}`);
}
async function apply(){
  if(store.get().navigation?.page!=='seller'||!window.CollectishSeller?.setMode)return;
  const {mode,tab}=read();
  applying=true;
  try{await window.CollectishSeller.setMode(mode,tab)}finally{applying=false}
  write();
}

export function installSellerRouteState(){
  if(installed)return;
  installed=true;
  document.addEventListener('collectish:seller-rendered',()=>queueMicrotask(apply),{once:true});
  document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='seller')queueMicrotask(apply)});
  store.subscribe(
    s=>`${s.navigation?.page||''}|${s.seller?.mode||''}|${s.seller?.tab||''}`,
    write,
    {immediate:false}
  );
  if(store.get().navigation?.page==='seller')queueMicrotask(apply);
}

installSellerRouteState();
window.CollectishSellerRouteState={read,apply};
