// Browser-native + Vite-compatible entrypoint. CSS is linked from index.html so raw ESM fallback works too.
// CSS source: ./styles/index.css
// Bootstrap ownership contract: guarded app.js owns ./core/shell.js, ./state/store.js, and ./modules/index.js.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function shouldRecoverModuleFailure(message){
  if(!/failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module/i.test(message))return false;
  try{
    const key='collectishModuleRecoveryAt',now=Date.now(),last=Number(sessionStorage.getItem(key)||0);
    if(now-last<60_000)return false;
    sessionStorage.setItem(key,String(now));
    return true;
  }catch{return true}
}
async function recoverModuleGraph(){
  try{
    if('serviceWorker' in navigator){
      const regs=await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister().catch(()=>false)));
    }
    if('caches' in window){
      const keys=await caches.keys();
      await Promise.all(keys.map(k=>caches.delete(k).catch(()=>false)));
    }
  }catch(error){console.warn('Collectish module recovery cleanup',error)}
  const url=new URL(location.href);
  url.searchParams.set('moduleRecover',String(Date.now()));
  location.replace(url.toString());
}
function showStartupError(error){
  const message=String(error?.message||error||'unknown startup error');
  console.error('Collectish bootstrap failed',error);
  const recovering=shouldRecoverModuleFailure(message);
  document.body.innerHTML=`<main class="cx-auth" data-collectish-startup-error="${esc(message)}"><section class="cx-auth-card"><div class="cx-brand"><span class="cx-brand-collect">collect</span><span class="cx-brand-ish">ish</span></div><h1>${recovering?'Recovering Collectish…':'Could not start Collectish'}</h1><p>${recovering?'Clearing the stale frontend module graph and loading the current hosted build once.':'The frontend module graph failed to load. Reload to retry.'}</p><small id="cxStartupError" style="display:block">${esc(message)}</small></section></main>`;
  if(recovering)setTimeout(()=>recoverModuleGraph(),150);
}

const oauthConsent=/\/oauth\/consent\/?$/.test(location.pathname);
if(oauthConsent){
  import('./modules/oauth-consent/main.js').then(module=>module.startOAuthConsent()).catch(showStartupError);
}else{
  const installSecondaryEntryModules=()=>{
    const run=()=>Promise.allSettled([
      import('./modules/seller/inventory-session-status.js').then(module=>module.installInventorySessionStatus()),
      import('./modules/signals/discovery-integration.js').then(module=>module.installSignalsDiscovery()),
      import('./modules/ask/history-ui.js').then(module=>module.installAskHistoryUi())
    ]).then(results=>results.forEach(result=>{if(result.status==='rejected')console.warn('Collectish secondary entry module failed',result.reason)}));
    if('requestIdleCallback' in window)requestIdleCallback(()=>void run(),{timeout:3500});
    else setTimeout(()=>void run(),1200);
  };
  document.addEventListener('collectish:ready',installSecondaryEntryModules,{once:true});
  import('./app.js').then(app=>app.startCollectish()).catch(showStartupError);
}
