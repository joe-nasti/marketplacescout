import store from '../../state/store.js';

let installed=false;
let applying=false;
let explicitSku='';
const VIEWS=new Set(['top','quick','buylist','velocity']);

function urlState(){
  const p=new URL(location.href).searchParams;
  const view=VIEWS.has(p.get('view'))?p.get('view'):'top';
  return {view,sku:p.get('sku')||''};
}
function replaceUrl({view,sku}){
  if(store.get().navigation?.page!=='scout')return;
  const p=new URL(location.href).searchParams;
  if(view&&view!=='top')p.set('view',view);else p.delete('view');
  if(sku&&view!=='quick')p.set('sku',sku);else p.delete('sku');
  p.set('tab','scout');
  history.replaceState({collectish:true},'',`${location.pathname}?${p.toString()}${location.hash}`);
}
function writeView(){
  if(applying||store.get().navigation?.page!=='scout')return;
  const scout=store.get().scout||{},view=VIEWS.has(scout.savedView)?scout.savedView:'top';
  replaceUrl({view,sku:view==='quick'?'':explicitSku||urlState().sku});
}
function rememberExplicitSku(value){
  const sku=String(value||'');
  if(!sku||store.get().navigation?.page!=='scout')return;
  explicitSku=sku;
  const scout=store.get().scout||{},view=VIEWS.has(scout.savedView)?scout.savedView:'top';
  replaceUrl({view,sku});
}
function explicitClick(event){
  const hit=event.target.closest?.('#cxScout .cx-scout-card[data-sku], #cxScout [data-quick-turn-sku]');
  if(!hit)return;
  rememberExplicitSku(hit.dataset.quickTurnSku||hit.dataset.sku);
}
function explicitOpen(event){
  const detail=event.detail||{};
  rememberExplicitSku(detail.sku_id||detail.sku);
}
function applyState(){
  if(store.get().navigation?.page!=='scout')return;
  const renderer=window.CollectishScoutRenderer;
  if(!renderer?.setSaved||store.get().scout?.status!=='ready')return;
  const {view,sku}=urlState();
  explicitSku=sku;
  applying=true;
  try{
    renderer.setSaved(view);
    if(sku&&view!=='quick')window.CollectishScoutDetailNavigation?.open?.({sku_id:sku});
  }finally{applying=false}
  replaceUrl({view,sku});
}

export function installScoutRouteState(){
  if(installed)return;
  installed=true;
  document.addEventListener('click',explicitClick,true);
  document.addEventListener('collectish:open-scout-card',explicitOpen,true);
  document.addEventListener('collectish:scout-v5-ready',()=>queueMicrotask(applyState));
  document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='scout')queueMicrotask(applyState)});
  store.subscribe(
    s=>`${s.navigation?.page||''}|${s.scout?.savedView||''}`,
    writeView,
    {immediate:false}
  );
  if(store.get().scout?.status==='ready')queueMicrotask(applyState);
}

installScoutRouteState();
window.CollectishScoutRouteState={read:urlState,apply:applyState,rememberSku:rememberExplicitSku};
