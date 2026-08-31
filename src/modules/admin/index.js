let installPromise=null;
let secretLairPromise=null;

function loadSecretLair(){
  if(secretLairPromise)return secretLairPromise;
  secretLairPromise=(async()=>{
    await import('./secret-lair.js');
    await import('./secret-lair-scoring.js');
  })();
  return secretLairPromise;
}

export function install(){
  if(installPromise)return installPromise;
  installPromise=(async()=>{
    // Admin has one structural owner. Establish the console before additive
    // health/diagnostic modules mount so there is no generic shell -> console
    // replacement after the route becomes visible.
    await import('./console.js');
    document.querySelectorAll('#cxAdmin [data-cx-lazy-placeholder]').forEach(el=>el.remove());
    window.CollectishAdminConsole?.render?.();

    await Promise.all([
      import('./single-owner-style.js'),
      import('./mobile-containment.js'),
      import('./singles-navigation.js'),
      import('./alerts.js'),
      import('./scans.js'),
      import('./marketplace-health.js'),
      import('./scout-universe.js'),
      import('./catalyst-calibration.js'),
      import('./catalyst-calibration-health.js'),
      import('./signals-video-audit.js'),
      import('./youtube-pipeline.js'),
      import('./sealed-catalog.js'),
      import('./sealed-health.js'),
      import('./cardtrader-health.js'),
      import('./top.js')
    ]);
    document.dispatchEvent(new CustomEvent('collectish:admin-modules-ready'));
    if(document.getElementById('cxAdmin')?.classList.contains('active'))void window.CollectishAdminConsole?.refresh?.();
  })();
  return installPromise;
}

document.addEventListener('collectish:admin-section-change',e=>{
  if(e.detail?.section==='singles')void loadSecretLair();
});
