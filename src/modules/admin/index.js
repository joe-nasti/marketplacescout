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

function secretLairNeededNow(){
  const shell=document.getElementById('cxAdminConsole');
  if(shell?.dataset.activeSection==='singles')return true;
  const params=new URL(location.href).searchParams;
  return params.get('tab')==='admin'&&params.get('admin')==='singles';
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
    // Start health reads as soon as the structural console exists. Additive
    // admin modules should not hold the useful overview behind their JS graph.
    void window.CollectishAdminConsole?.refresh?.();

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
      import('./catalyst-production-promotion.js'),
      import('./signals-video-audit.js'),
      import('./youtube-pipeline.js'),
      import('./sealed-catalog.js'),
      import('./sealed-health.js'),
      import('./cardtrader-health.js'),
      import('./top.js')
    ]);
    document.dispatchEvent(new CustomEvent('collectish:admin-modules-ready'));
    if(secretLairNeededNow())await loadSecretLair();
    if(document.getElementById('cxAdmin')?.classList.contains('active'))void window.CollectishAdminConsole?.refresh?.();
  })();
  return installPromise;
}

document.addEventListener('collectish:admin-section-change',e=>{
  if(e.detail?.section==='singles')void loadSecretLair();
});
