import store from '../../state/store.js';

let installed=false;
let applying=false;
let explicitSku='';
const VIEWS=new Set(['top','quick','buylist','velocity']);

function onScout(){
  const state=store.get();
  return (state.runtime?.page||state.navigation?.page)==='scout';
}
function urlState(){
  const p=new URL(location.href).searchParams;
  const view=VIEWS.has(p.get('view'))?p.get('view'):'top';
  return {view,sku:p.get('sku')||'',fromCard:p.get('fromCard')||''};
}
function writeUrl({view,sku,fromCard=''},{push=false}={}){
  if(!onScout())return false;
  const u=new URL(location.href),p=u.searchParams;
  if(view&&view!=='top')p.set('view',view);else p.delete('view');
  if(sku&&view!=='quick')p.set('sku',sku);else p.delete('sku');
  if(sku&&fromCard&&String(fromCard)!==String(sku)&&view!=='quick')p.set('fromCard',fromCard);else p.delete('fromCard');
  p.delete('overlay');
  // Scout is the canonical default route. Keeping ?tab=scout out of the URL
  // prevents legacy Scout popstate reload hooks from fighting native Back.
  p.delete('tab');
  const next=`${u.pathname}${p.toString()?`?${p}`:''}${u.hash}`;
  const current=`${location.pathname}${location.search}${location.hash}`;
  if(next===current)return false;
  history[push?'pushState':'replaceState']({collectish:true,kind:sku?'scout-detail':'scout-view'},'',next);
  return true;
}
function writeView(){
  if(applying||!onScout())return;
  const scout=store.get().scout||{},view=VIEWS.has(scout.savedView)?scout.savedView:'top';
  const current=urlState();writeUrl({view,sku:view==='quick'?'':explicitSku||current.sku,fromCard:view==='quick'?'':current.fromCard});
}
function rememberExplicitSku(value,{fromCard=''}={}){
  const sku=String(value||'');
  if(!sku||!onScout())return;
  const prior=urlState().sku;
  explicitSku=sku;
  const scout=store.get().scout||{},view=VIEWS.has(scout.savedView)?scout.savedView:'top';
  writeUrl({view,sku,fromCard},{push:sku!==prior});
}
function explicitClick(event){
  const hit=event.target.closest?.('#cxScout .cx-scout-card[data-sku], #cxScout [data-quick-turn-sku]');
  if(!hit)return;
  rememberExplicitSku(hit.dataset.quickTurnSku||hit.dataset.sku);
}
function explicitOpen(event){
  const detail=event.detail||{};
  rememberExplicitSku(detail.sku_id||detail.sku,{fromCard:detail.from_card_sku||detail.fromCard||''});
}
function applyState(){
  if(!onScout())return;
  const renderer=window.CollectishScoutRenderer;
  if(!renderer?.setSaved||store.get().scout?.status!=='ready')return;
  const {view,sku,fromCard}=urlState();
  explicitSku=sku;
  applying=true;
  try{
    renderer.setSaved(view);
    if(sku&&view!=='quick')window.CollectishScoutDetailNavigation?.open?.({sku_id:sku,from_card_sku:fromCard});
    else window.CollectishNavigation?.closeScoutDetail?.({history:false});
  }finally{applying=false}
  writeUrl({view,sku,fromCard});
}

export function installScoutRouteState(){
  if(installed)return;
  installed=true;
  document.addEventListener('click',explicitClick,true);
  document.addEventListener('collectish:open-scout-card',explicitOpen,true);
  document.addEventListener('collectish:scout-v5-ready',()=>queueMicrotask(applyState));
  document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='scout')queueMicrotask(applyState)});
  addEventListener('popstate',()=>{if(onScout())queueMicrotask(applyState)});
  store.subscribe(
    s=>`${s.runtime?.page||s.navigation?.page||''}|${s.scout?.savedView||''}`,
    writeView,
    {immediate:false}
  );
  if(store.get().scout?.status==='ready')queueMicrotask(applyState);
}

installScoutRouteState();
window.CollectishScoutRouteState={read:urlState,apply:applyState,rememberSku:rememberExplicitSku};
