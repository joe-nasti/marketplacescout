import './styles/index.css';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function showStartupError(error){
  const message=String(error?.message||error||'unknown startup error');
  console.error('Collectish bootstrap failed',error);
  const nativeVersion=(()=>{try{return window.CollectishAndroid?.getVersion?.()||''}catch{return ''}})();
  document.body.innerHTML=`<main class="cx-auth" data-collectish-startup-error="${esc(message)}"><section class="cx-auth-card"><div class="cx-brand"><span class="cx-brand-collect">collect</span><span class="cx-brand-ish">ish</span></div><h1>Could not start Collectish</h1><p>The frontend module graph failed to load. Reload to retry.</p><small id="cxStartupError">${esc(message)}</small>${nativeVersion?`<small>Android ${esc(nativeVersion)}</small>`:''}</section></main>`;
}

import('./app.js').then(mod=>mod.startCollectish()).catch(showStartupError);
