import './core/build-info.js';
import './core/health.js';
import './core/theme.js';
import './modules/scout/health.js';
import './modules/scout/bootstrap.js';
import './modules/seller/readonly-agent.js';
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
  {key:'sealed.rows',scope:'user',maxStale:7*24*60*60*1000},
  {key:'sealed.setTypes',scope:'user',maxStale:30*24*60*60*1000},
  {key:'scout.rows',scope:'user',maxStale:24*60*60*1000}
];

export function startCollectish(){
  store.update('runtime',{phase:'starting'});
  installExternalFetchBridge();
  installRestBridge();
  installScryfallCache();
  installActivityBar();
  installScoutCacheBridge();
  startShell({beforeReady:async()=>{
    store.update('runtime',{phase:'hydrating-cache'});
    await primeResources(STARTUP_PRIME).catch(()=>0);
    store.update('runtime',{phase:'loading-modules'});
    await installModules();
    store.update('runtime',{phase:'ready'});
  }});
}
