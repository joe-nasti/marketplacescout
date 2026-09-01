import store from '../../state/store.js';

let installed=false;
let applying=false;
let explicitSku='';
const VIEWS=new Set(['top','quick','buylist','velocity']);

function onScout(){
  const state=store.get();
  return (state.runtime?.page||state.navigation?.page)==='scout';
}
function lookupSku(value=''){
  const raw=String(value||'');
  if(!raw.startsWith('lookup:'))return null;
  const [card_name='',set_hint='',finish='']=raw.slice(7).split('|');
  return {card_name,set_code:set_hint,set_name:set_hint,finish};
}
function urlState(){
  const p=new URL(location.href).searchParams;
  const view=VIEWS.has(p.get('view'))?p.get('view'):'top';
  return {view,sku:p.get('sku')||'',product_id:p.get('product')||'',card_name:p.get('card')||'',set_code:p.get('set')||'',finish:p.get('finish')||''};
}
function writeUrl({view,sku},{push=false}={}){
  if(!onScout())return false;
  const u=new URL(location.href),p=u.searchParams;
  if(view&&view!=='top')p.set('view',view);else p.delete('view');
  if(sku&&view!=='quick')p.set('sku',sku);else p.delete('sku');
  p.delete('overlay');
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
  writeUrl({view,sku:view==='quick'?'':explicitSku||urlState().sku});
}
function rememberExplicitSku(value){
  const sku=String(value||'');
  if(!sku||!onScout())return;
  const prior=urlState().sku;
  explicitSku=sku;
  const scout=store.get().scout||{},view=VIEWS.has(scout.savedView)?scout.savedView:'top';
  writeUrl({view,sku},{push:sku!==prior});
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
function openLookup(state){
  if(!state.product_id&&!state.card_name)return;
  document.dispatchEvent(new CustomEvent('collectish:open-scout-card',{detail:{source:'signals-discord-deep-link',product_id:state.product_id||null,card_name:state.card_name||null,set_code:state.set_code||null,set_name:state.set_name||null,finish:state.finish||null}}));
}
function applyState(){
  if(!onScout())return;
  const renderer=window.CollectishScoutRenderer;
  if(!renderer?.setSaved||store.get().scout?.status!=='ready')return;
  const state=urlState(),{view,sku}=state,lookup=lookupSku(sku);
  explicitSku=sku;
  applying=true;
  try{
    renderer.setSaved(view);
    if(lookup&&view!=='quick')openLookup({...state,...lookup,sku:''});
    else if(sku&&view!=='quick')window.CollectishScoutDetailNavigation?.open?.({sku_id:sku});
    else if((state.product_id||state.card_name)&&view!=='quick')openLookup(state);
    else window.CollectishNavigation?.closeScoutDetail?.({history:false});
  }finally{applying=false}
  writeUrl({view,sku});
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
