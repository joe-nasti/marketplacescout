import './core/build-info.js';
import './core/health.js';
import './core/theme.js';
import './core/workbench-secondary.css';
import './core/mobile-utility-origin.js';
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
