// Browser-native + Vite-compatible entrypoint. CSS is linked from index.html so raw ESM fallback works too.
// CSS source: ./styles/index.css
// Bootstrap ownership contract: guarded app.js owns ./core/shell.js, ./state/store.js, and ./modules/index.js.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function showStartupError(error){
  const message=String(error?.message||error||'unknown startup error');
  console.error('Collectish bootstrap failed',error);
  const nativeVersion=(()=>{try{return window.CollectishAndroid?.getVersion?.()||''}catch{return ''}})();
  document.body.innerHTML=`<main class="cx-auth" data-collectish-startup-error="${esc(message)}"><section class="cx-auth-card"><div class="cx-brand"><span class="cx-brand-collect">collect</span><span class="cx-brand-ish">ish</span></div><h1>Could not start Collectish</h1><p>The frontend module graph failed to load. Reload to retry.</p><small id="cxStartupError">${esc(message)}</small>${nativeVersion?`<small>Android ${esc(nativeVersion)}</small>`:''}</section></main>`;
}

Promise.all([
  import('./app.js'),
  import('./modules/seller/inventory-session-status.js'),
  import('./modules/signals/discovery-integration.js'),
  import('./modules/ask/history-ui.js')
]).then(([app,status,discovery,askHistory])=>{
  status.installInventorySessionStatus();
  discovery.installSignalsDiscovery();
  askHistory.installAskHistoryUi();
  return app.startCollectish();
}).catch(showStartupError);
