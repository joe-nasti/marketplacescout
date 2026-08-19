import './styles/index.css';
import './core/build-info.js';
import './core/health.js';
import './core/theme.js';
import './modules/ask/markdown.js';
import './modules/sealed/ui-guardian.js';
import './modules/scout/health.js';
import './modules/scout/bootstrap.js';
import './modules/seller/readonly-agent.js';
import './core/lazy-pages.js';
import store from './state/store.js';
import { startShell } from './core/shell.js';
import { installRestBridge } from './core/rest.js';
import { installScoutCacheBridge } from './modules/scout/cache-read.js';
import { installModules } from './modules/index.js';

function start(){
  store.update('runtime',{phase:'starting'});
  installRestBridge();
  installScoutCacheBridge();
  startShell({beforeReady:async()=>{
    store.update('runtime',{phase:'loading-modules'});
    await installModules();
    store.update('runtime',{phase:'ready'});
  }});
}

try{start()}catch(error){
  store.update('runtime',{phase:'error',error:String(error?.message||error)});
  console.error('Collectish module startup failed',error);
  document.body.innerHTML='<main class="cx-auth"><section class="cx-auth-card"><div class="cx-brand"><span class="cx-brand-collect">collect</span><span class="cx-brand-ish">ish</span></div><h1>Could not start Collectish</h1><p>Frontend module initialization failed. Reload to retry.</p></section></main>';
}
