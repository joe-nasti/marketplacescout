import './core/build-info.js';
import './core/health.js';
import './core/theme.js';
import './modules/scout/health.js';
import './modules/scout/bootstrap.js';
import './core/lazy-pages.js';
import store from './state/store.js';
import { startShell } from './core/shell.js';
import { installRestBridge } from './core/rest.js';
import { installExternalFetchBridge } from './core/data.js';
import { installScryfallCache } from './core/scryfall-cache.js';
import { installActivityBar } from './core/activity-bar.js';
import { primeResources } from './state/resources.js';
import { installScoutCacheBridge } from './modules/scout/cache-read.js';
import { installModules } from './modules/index.js';

/* Keep route/history + mobile shelf coordination in the already-eager app module.
 * This avoids paying another startup JS request for shell-only behavior. */
const utilityMobile=matchMedia('(max-width:700px)');
const routeMobile=matchMedia('(max-width:980px)');
let initialSettling=false,userInteracted=false,gestureActive=false,snapTimer=0,scrollEndTimer=0;
function mobileOrigin(){
  if(!utilityMobile.matches)return 0;
  const shelf=document.getElementById('cxMobileUtilities');if(!shelf)return 0;
  const rect=shelf.getBoundingClientRect();return Math.max(0,Math.round(window.scrollY+rect.bottom));
}
function alignToOrigin({force=false,behavior='auto'}={}){
  if(!utilityMobile.matches||gestureActive)return;
  if(initialSettling&&userInteracted&&!force)return;
  const top=mobileOrigin();if(top>0)window.scrollTo({top,behavior});
}
function settleInitialOrigin(){
  if(!utilityMobile.matches)return;
  initialSettling=true;userInteracted=false;
  requestAnimationFrame(()=>requestAnimationFrame(()=>alignToOrigin()));
  for(const delay of [80,240,700])setTimeout(()=>alignToOrigin(),delay);
  setTimeout(()=>{initialSettling=false},900);
}
function noteInteraction(){if(initialSettling)userInteracted=true}
function shelfIsPartlyRevealed(){
  if(!utilityMobile.matches)return false;
  const top=window.scrollY,origin=mobileOrigin();return top>1&&origin>0&&top<origin-2;
}
function snapIfNeeded(){clearTimeout(snapTimer);if(!gestureActive&&!initialSettling&&shelfIsPartlyRevealed())alignToOrigin({force:true,behavior:'smooth'})}
function scheduleShelfSnap(delay=140){clearTimeout(snapTimer);snapTimer=setTimeout(snapIfNeeded,delay)}
function onPointerDown(event){
  if(event.pointerType!=='touch'&&event.pointerType!=='pen')return;
  gestureActive=true;clearTimeout(snapTimer);clearTimeout(scrollEndTimer);noteInteraction();
}
function onPointerEnd(event){
  if(event.pointerType!=='touch'&&event.pointerType!=='pen')return;
  gestureActive=false;scheduleShelfSnap(180);
}
function onScroll(){
  if(gestureActive||'onscrollend' in window)return;
  clearTimeout(scrollEndTimer);scrollEndTimer=setTimeout(()=>scheduleShelfSnap(0),180);
}
function onUtilityUse(event){
  if(!utilityMobile.matches)return;
  if(!event.target.closest?.('#cxMobileUtilities [data-cx-theme-toggle], #cxMobileUtilities [data-cx-build-badge="1"]'))return;
  setTimeout(()=>alignToOrigin({force:true,behavior:'smooth'}),160);
}
function installMobileUtilityOrigin(){
  document.addEventListener('collectish:ready',settleInitialOrigin);
  document.addEventListener('click',onUtilityUse,true);
  window.addEventListener('pageshow',event=>{if(!event.persisted)setTimeout(settleInitialOrigin,0)});
  utilityMobile.addEventListener?.('change',event=>{if(event.matches)setTimeout(settleInitialOrigin,0)});
  window.addEventListener('pointerdown',onPointerDown,{passive:true});
  window.addEventListener('pointerup',onPointerEnd,{passive:true});
  window.addEventListener('pointercancel',onPointerEnd,{passive:true});
  window.addEventListener('scroll',onScroll,{passive:true});
  if('onscrollend' in window)window.addEventListener('scrollend',()=>scheduleShelfSnap(0),{passive:true});
}

const scrollByRoute=new Map();
let lastRoute='scout',suppressRestore=false;
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
function closeScoutDetail({history:useHistory=true}={}){
  const p=params();if(useHistory&&p.get('sku')){history.back();return true}
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
  if(event.key!=='Escape')return;
  const p=params(),route=currentRoute();
  if(route==='scout'&&p.get('overlay')==='filters'){event.preventDefault();closeScoutFilters();return}
  if(route==='scout'&&p.get('sku')){event.preventDefault();closeScoutDetail()}
}
function onPageChange(event){
  const next=event.detail?.page||currentRoute();
  if(lastRoute&&lastRoute!==next)rememberScroll(lastRoute);
  lastRoute=next;syncTransientUi();restoreScroll(next);
}
function onPopState(){
  suppressRestore=true;
  queueMicrotask(()=>{syncTransientUi();suppressRestore=false;restoreScroll(currentRoute())});
}
function installNavigation(){
  lastRoute=currentRoute();
  try{if('scrollRestoration' in history)history.scrollRestoration='manual'}catch{}
  document.addEventListener('click',onNavigationClick,true);
  document.addEventListener('keydown',onNavigationKeydown,true);
  document.addEventListener('collectish:page-change',onPageChange);
  addEventListener('popstate',onPopState);
  addEventListener('pagehide',()=>rememberScroll(currentRoute()));
  document.documentElement.dataset.collectishSystemGestures='native';
}
installMobileUtilityOrigin();
installNavigation();
window.CollectishMobileUtilityOrigin={align:alignToOrigin,settle:settleInitialOrigin,origin:mobileOrigin,snap:()=>alignToOrigin({force:true,behavior:'smooth'})};
window.CollectishNavigation={closeScoutDetail,closeScoutFilters,rememberScroll,restoreScroll,sync:syncTransientUi,systemGestures:true,mobile:()=>routeMobile.matches};

const STARTUP_PRIME=[
  {key:'scout.rows',scope:'user',maxStale:24*60*60*1000}
];
const IDLE_PRIME=[
  {key:'sealed.rows',scope:'user',maxStale:7*24*60*60*1000},
  {key:'sealed.setTypes',scope:'user',maxStale:30*24*60*60*1000}
];
const HEALTH_KEY='collectishRuntimeHealth';
function recordTiming(key,ms){
  try{
    const current=JSON.parse(sessionStorage.getItem(HEALTH_KEY)||'{}');
    current[key]=Math.round(ms);
    current.last_event_at=new Date().toISOString();
    sessionStorage.setItem(HEALTH_KEY,JSON.stringify(current));
    document.dispatchEvent(new CustomEvent('collectish:runtime-health',{detail:{...current,event:key}}));
  }catch{}
}
function scheduleIdlePrime(){
  const run=async()=>{
    const started=performance.now();
    await primeResources(IDLE_PRIME).catch(()=>0);
    recordTiming('idle_cache_hydration_ms',performance.now()-started);
  };
  if('requestIdleCallback' in window)requestIdleCallback(()=>void run(),{timeout:3000});
  else setTimeout(()=>void run(),1500);
}
function loadNativeSellerAgent(){
  if(!window.CollectishAndroid||!window.CollectishReadOnly)return;
  import('./modules/seller/readonly-agent.js').catch(()=>{});
}

export function startCollectish(){
  store.update('runtime',{phase:'starting'});
  installExternalFetchBridge();
  installRestBridge();
  installScryfallCache();
  installActivityBar();
  installScoutCacheBridge();
  loadNativeSellerAgent();
  startShell({beforeReady:async()=>{
    const cacheStarted=performance.now();
    store.update('runtime',{phase:'hydrating-cache'});
    await primeResources(STARTUP_PRIME).catch(()=>0);
    recordTiming('startup_cache_hydration_ms',performance.now()-cacheStarted);

    const modulesStarted=performance.now();
    store.update('runtime',{phase:'loading-modules'});
    await installModules();
    recordTiming('startup_scout_modules_ms',performance.now()-modulesStarted);
    store.update('runtime',{phase:'ready'});
    scheduleIdlePrime();
  }});
}
