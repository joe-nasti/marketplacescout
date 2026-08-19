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
import { installScoutCacheBridge } from './modules/scout/cache-read.js';
import { installModules } from './modules/index.js';

export function startCollectish(){
  store.update('runtime',{phase:'starting'});
  installExternalFetchBridge();
  installRestBridge();
  installScoutCacheBridge();
  startShell({beforeReady:async()=>{
    store.update('runtime',{phase:'loading-modules'});
    await installModules();
    store.update('runtime',{phase:'ready'});
  }});
}
