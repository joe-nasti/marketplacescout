import store from '../../state/store.js';

let installed=false;
let applying=false;
const VIEWS=new Set(['top','quick','buylist','velocity']);

function urlState(){
  const p=new URL(location.href).searchParams;
  const view=VIEWS.has(p.get('view'))?p.get('view'):'top';
  return {view,sku:p.get('sku')||''};
}
function writeState(){
  if(applying||store.get().navigation?.page!=='scout')return;
  const scout=store.get().scout||{},p=new URL(location.href).searchParams;
  const view=VIEWS.has(scout.savedView)?scout.savedView:'top',sku=String(scout.selectedSku||'');
  if(view&&view!=='top')p.set('view',view);else p.delete('view');
  if(sku)p.set('sku',sku);else p.delete('sku');
  p.set('tab','scout');
  history.replaceState({collectish:true},'',`${location.pathname}?${p.toString()}${location.hash}`);
}
function applyState(){
  if(store.get().navigation?.page!=='scout')return;
  const renderer=window.CollectishScoutRenderer;
  if(!renderer?.setSaved||store.get().scout?.status!=='ready')return;
  const {view,sku}=urlState();
  applying=true;
  try{
    renderer.setSaved(view);
    if(sku&&view!=='quick')window.CollectishScoutDetailNavigation?.open?.({sku_id:sku});
  }finally{applying=false}
  writeState();
}

export function installScoutRouteState(){
  if(installed)return;
  installed=true;
  document.addEventListener('collectish:scout-v5-ready',()=>queueMicrotask(applyState));
  document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='scout')queueMicrotask(applyState)});
  store.subscribe(
    s=>`${s.navigation?.page||''}|${s.scout?.savedView||''}|${s.scout?.selectedSku||''}`,
    writeState,
    {immediate:false}
  );
  if(store.get().scout?.status==='ready')queueMicrotask(applyState);
}

installScoutRouteState();
window.CollectishScoutRouteState={read:urlState,apply:applyState};
