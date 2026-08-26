let installPromise=null;

export function install(){
  if(installPromise)return installPromise;
  installPromise=(async()=>{
    // Admin has one structural owner. Establish the console before additive
    // health/diagnostic modules mount so there is no generic shell -> console
    // replacement after the route becomes visible.
    await import('./console.js');
    await Promise.all([
      import('./single-owner-style.js'),
      import('./alerts.js'),
      import('./scans.js'),
      import('./marketplace-health.js'),
      import('./sealed-catalog.js'),
      import('./sealed-health.js'),
      import('./cardtrader-health.js'),
      import('./top.js')
    ]);
    document.dispatchEvent(new CustomEvent('collectish:admin-modules-ready'));
  })();
  return installPromise;
}
