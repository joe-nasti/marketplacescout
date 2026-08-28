import store from '../state/store.js';

const scrollByRoute=new Map();
let installed=false;
let lastRoute='scout';
let suppressRestore=false;

function params(){return new URL(location.href).searchParams}
function urlWith(p){const q=p.toString();return `${location.pathname}${q?`?${q}`:''}${location.hash}`}
function currentRoute(){return store.get().runtime?.page||store.get().navigation?.page||'scout'}
function mobile(){return matchMedia('(max-width:980px)').matches}

function rememberScroll(route=lastRoute){
  if(!route)return;
  scrollByRoute.set(route,Math.max(0,window.scrollY||0));
}
function restoreScroll(route){
  if(suppressRestore)return;
  const y=scrollByRoute.get(route);
  if(y==null)return;
  requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo({top:y,behavior:'auto'})));
}

function writeTransient(key,value,{push=true}={}){
  const p=params();
  if(value==null||value==='')p.delete(key);else p.set(key,String(value));
  const next=urlWith(p),current=`${location.pathname}${location.search}${location.hash}`;
  if(next===current)return false;
  history[push?'pushState':'replaceState']({collectish:true,transient:key},'',next);
  return true;
}

export function closeScoutDetail({history:true}={}){
  const p=params();
  if(history&&p.get('sku')){
    history.back();
    return true;
  }
  store.update('scout',{selectedSku:null});
  document.querySelectorAll('#cxParityCards .cx-scout-card.selected').forEach(x=>x.classList.remove('selected'));
  const detail=document.getElementById('cxParityDetail');
  detail?.classList.remove('cx-mobile-detail-open');
  document.body.classList.remove('cx-scout-detail-lock');
  window.CollectishScoutRenderer?.renderDetail?.(null,false);
  document.dispatchEvent(new CustomEvent('collectish:detail-closed',{detail:{page:'scout'}}));
  return true;
}

function closeScoutFilters({history:true}={}){
  const p=params();
  if(history&&p.get('overlay')==='filters'){
    history.back();
    return true;
  }
  window.CollectishScoutRenderer?.openFilters?.(false);
  return true;
}

function syncTransientUi(){
  const p=params(),route=currentRoute();
  if(route==='scout'){
    if(p.get('overlay')!=='filters')window.CollectishScoutRenderer?.openFilters?.(false);
    if(!p.get('sku'))closeScoutDetail({history:false});
  }
}

function onCaptureClick(event){
  const route=currentRoute();
  const navTarget=event.target.closest?.('[data-cx-page],[data-cx-group-nav]');
  if(navTarget)rememberScroll(route);

  if(route==='scout'&&event.target.closest?.('[data-scout-filters]')){
    if(params().get('overlay')!=='filters')writeTransient('overlay','filters',{push:true});
    return;
  }
  if(route==='scout'&&event.target.closest?.('[data-scout-filter-close]')){
    if(params().get('overlay')==='filters')history.back();
    return;
  }
  if(route==='scout'&&event.target.closest?.('.cx-mobile-detail-close')){
    if(params().get('sku')){
      event.preventDefault();
      event.stopImmediatePropagation();
      history.back();
    }
  }
}

function onKeydown(event){
  if(event.key!=='Escape')return;
  const p=params(),route=currentRoute();
  if(route==='scout'&&p.get('overlay')==='filters'){
    event.preventDefault();
    closeScoutFilters();
    return;
  }
  if(route==='scout'&&p.get('sku')){
    event.preventDefault();
    closeScoutDetail();
  }
}

function onPageChange(event){
  const next=event.detail?.page||currentRoute();
  if(lastRoute&&lastRoute!==next)rememberScroll(lastRoute);
  lastRoute=next;
  syncTransientUi();
  restoreScroll(next);
}

function onPopState(){
  // Browser/Android Back is canonical. Components only reconcile to the URL;
  // they never synthesize an edge-swipe or second navigation stack.
  suppressRestore=true;
  queueMicrotask(()=>{
    syncTransientUi();
    suppressRestore=false;
    restoreScroll(currentRoute());
  });
}

export function installNavigation(){
  if(installed)return;
  installed=true;
  lastRoute=currentRoute();
  try{if('scrollRestoration' in history)history.scrollRestoration='manual'}catch{}
  document.addEventListener('click',onCaptureClick,true);
  document.addEventListener('keydown',onKeydown,true);
  document.addEventListener('collectish:page-change',onPageChange);
  addEventListener('popstate',onPopState);
  addEventListener('pagehide',()=>rememberScroll(currentRoute()));
  document.documentElement.dataset.collectishSystemGestures='native';
}

installNavigation();
window.CollectishNavigation={
  closeScoutDetail,
  closeScoutFilters,
  rememberScroll,
  restoreScroll,
  sync:syncTransientUi,
  systemGestures:true,
  mobile
};
