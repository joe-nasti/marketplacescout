import store from '../state/store.js';

const mobile=matchMedia('(max-width:700px)');
const routeMobile=matchMedia('(max-width:980px)');
let initialSettling=false;
let userInteracted=false;
let gestureActive=false;
let snapTimer=0;
let scrollEndTimer=0;

function mobileOrigin(){
  if(!mobile.matches)return 0;
  const shelf=document.getElementById('cxMobileUtilities');
  if(!shelf)return 0;
  const rect=shelf.getBoundingClientRect();
  return Math.max(0,Math.round(window.scrollY+rect.bottom));
}

function alignToOrigin({force=false,behavior='auto'}={}){
  if(!mobile.matches||gestureActive)return;
  if(initialSettling&&userInteracted&&!force)return;
  const top=mobileOrigin();
  if(top<=0)return;
  window.scrollTo({top,behavior});
}

function settleInitialOrigin(){
  if(!mobile.matches)return;
  initialSettling=true;
  userInteracted=false;
  requestAnimationFrame(()=>requestAnimationFrame(()=>alignToOrigin()));
  for(const delay of [80,240,700])setTimeout(()=>alignToOrigin(),delay);
  setTimeout(()=>{initialSettling=false},900);
}

function noteInteraction(){if(initialSettling)userInteracted=true}

function shelfIsPartlyRevealed(){
  if(!mobile.matches)return false;
  const top=window.scrollY;
  const origin=mobileOrigin();
  return top>1&&origin>0&&top<origin-2;
}

function snapIfNeeded(){
  clearTimeout(snapTimer);
  if(gestureActive||initialSettling)return;
  if(shelfIsPartlyRevealed())alignToOrigin({force:true,behavior:'smooth'});
}

function scheduleShelfSnap(delay=140){
  clearTimeout(snapTimer);
  snapTimer=setTimeout(snapIfNeeded,delay);
}

function onPointerDown(event){
  if(event.pointerType!=='touch'&&event.pointerType!=='pen')return;
  gestureActive=true;
  clearTimeout(snapTimer);
  clearTimeout(scrollEndTimer);
  noteInteraction();
}

function onPointerEnd(event){
  if(event.pointerType!=='touch'&&event.pointerType!=='pen')return;
  gestureActive=false;
  scheduleShelfSnap(180);
}

function onScroll(){
  if(gestureActive)return;
  if('onscrollend' in window)return;
  clearTimeout(scrollEndTimer);
  scrollEndTimer=setTimeout(()=>scheduleShelfSnap(0),180);
}

function onUtilityUse(event){
  if(!mobile.matches)return;
  if(!event.target.closest?.('#cxMobileUtilities [data-cx-theme-toggle], #cxMobileUtilities [data-cx-build-badge="1"]'))return;
  setTimeout(()=>alignToOrigin({force:true,behavior:'smooth'}),160);
}

export function installMobileUtilityOrigin(){
  // Route navigation owns scroll restoration. The utility shelf only settles
  // initial load and partial shelf reveals; it never repositions every route.
  document.addEventListener('collectish:ready',settleInitialOrigin);
  document.addEventListener('click',onUtilityUse,true);
  window.addEventListener('pageshow',event=>{if(!event.persisted)setTimeout(settleInitialOrigin,0)});
  mobile.addEventListener?.('change',event=>{if(event.matches)setTimeout(settleInitialOrigin,0)});
  window.addEventListener('pointerdown',onPointerDown,{passive:true});
  window.addEventListener('pointerup',onPointerEnd,{passive:true});
  window.addEventListener('pointercancel',onPointerEnd,{passive:true});
  window.addEventListener('scroll',onScroll,{passive:true});
  if('onscrollend' in window)window.addEventListener('scrollend',()=>scheduleShelfSnap(0),{passive:true});
}

/* Canonical route/history controller lives in this already-eager shell utility
 * so the UX overhaul does not add another startup module request. */
const scrollByRoute=new Map();
let navigationInstalled=false;
let lastRoute='scout';
let suppressRestore=false;

function params(){return new URL(location.href).searchParams}
function urlWith(p){const q=p.toString();return `${location.pathname}${q?`?${q}`:''}${location.hash}`}
function currentRoute(){return store.get().runtime?.page||store.get().navigation?.page||'scout'}
function rememberScroll(route=lastRoute){if(route)scrollByRoute.set(route,Math.max(0,window.scrollY||0))}
function restoreScroll(route){
  if(suppressRestore)return;
  const y=scrollByRoute.get(route);if(y==null)return;
  requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo({top:y,behavior:'auto'})));
}
function writeTransient(key,value,{push=true}={}){
  const p=params();if(value==null||value==='')p.delete(key);else p.set(key,String(value));
  const next=urlWith(p),current=`${location.pathname}${location.search}${location.hash}`;if(next===current)return false;
  history[push?'pushState':'replaceState']({collectish:true,transient:key},'',next);return true;
}
export function closeScoutDetail({history:useHistory=true}={}){
  const p=params();
  if(useHistory&&p.get('sku')){history.back();return true}
  store.update('scout',{selectedSku:null});
  document.querySelectorAll('#cxParityCards .cx-scout-card.selected').forEach(x=>x.classList.remove('selected'));
  document.getElementById('cxParityDetail')?.classList.remove('cx-mobile-detail-open');
  document.body.classList.remove('cx-scout-detail-lock');
  window.CollectishScoutRenderer?.renderDetail?.(null,false);
  document.dispatchEvent(new CustomEvent('collectish:detail-closed',{detail:{page:'scout'}}));
  return true;
}
function closeScoutFilters({history:useHistory=true}={}){
  const p=params();if(useHistory&&p.get('overlay')==='filters'){history.back();return true}
  window.CollectishScoutRenderer?.openFilters?.(false);return true;
}
function syncTransientUi(){
  const p=params(),route=currentRoute();
  if(route==='scout'){
    if(p.get('overlay')!=='filters')window.CollectishScoutRenderer?.openFilters?.(false);
    if(!p.get('sku'))closeScoutDetail({history:false});
  }
}
function onNavigationClick(event){
  const route=currentRoute();
  const navTarget=event.target.closest?.('[data-cx-page],[data-cx-group-nav]');if(navTarget)rememberScroll(route);
  if(route==='scout'&&event.target.closest?.('[data-scout-filters]')){if(params().get('overlay')!=='filters')writeTransient('overlay','filters',{push:true});return}
  if(route==='scout'&&event.target.closest?.('[data-scout-filter-close]')){if(params().get('overlay')==='filters')history.back();return}
  if(route==='scout'&&event.target.closest?.('.cx-mobile-detail-close')&&params().get('sku')){event.preventDefault();event.stopImmediatePropagation();history.back()}
}
function onNavigationKeydown(event){
  if(event.key!=='Escape')return;const p=params(),route=currentRoute();
  if(route==='scout'&&p.get('overlay')==='filters'){event.preventDefault();closeScoutFilters();return}
  if(route==='scout'&&p.get('sku')){event.preventDefault();closeScoutDetail()}
}
function onPageChange(event){
  const next=event.detail?.page||currentRoute();if(lastRoute&&lastRoute!==next)rememberScroll(lastRoute);lastRoute=next;syncTransientUi();restoreScroll(next);
}
function onPopState(){
  suppressRestore=true;queueMicrotask(()=>{syncTransientUi();suppressRestore=false;restoreScroll(currentRoute())});
}
export function installNavigation(){
  if(navigationInstalled)return;navigationInstalled=true;lastRoute=currentRoute();
  try{if('scrollRestoration' in history)history.scrollRestoration='manual'}catch{}
  document.addEventListener('click',onNavigationClick,true);
  document.addEventListener('keydown',onNavigationKeydown,true);
  document.addEventListener('collectish:page-change',onPageChange);
  addEventListener('popstate',onPopState);addEventListener('pagehide',()=>rememberScroll(currentRoute()));
  document.documentElement.dataset.collectishSystemGestures='native';
}

installMobileUtilityOrigin();
installNavigation();
window.CollectishMobileUtilityOrigin={align:alignToOrigin,settle:settleInitialOrigin,origin:mobileOrigin,snap:()=>alignToOrigin({force:true,behavior:'smooth'})};
window.CollectishNavigation={closeScoutDetail,closeScoutFilters,rememberScroll,restoreScroll,sync:syncTransientUi,systemGestures:true,mobile:()=>routeMobile.matches};
