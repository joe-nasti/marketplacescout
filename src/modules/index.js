const startupModules=[
  ()=>import('./scout/volatility.js'),
  ()=>import('./scout/detail-links.js'),
  ()=>import('./scout/images.js'),
  ()=>import('./scout/noise-filter.js'),
  ()=>import('./scout/search.js'),
  ()=>import('./scout/vendor.js'),
  ()=>import('./scout/detail-swipe.js'),
  ()=>import('./seller/inventory.js'),
  ()=>import('./seller/freshness.js'),
  ()=>import('./admin/scans.js'),
  ()=>import('./admin/fixed-nav.js'),
  ()=>import('./admin/marketplace-health.js'),
  ()=>import('./admin/console.js'),
  ()=>import('./admin/sealed-catalog.js'),
  ()=>import('./admin/sealed-health.js'),
  ()=>import('./admin/top.js'),
  ()=>import('./ask/main.js'),
  ()=>import('./ask/investigate-presentation.js'),
  ()=>import('./ask/concise-view.js'),
  ()=>import('./ask/investigate.js'),
  ()=>import('./ask/actions.js'),
  ()=>import('./ask/admin.js')
];
let installPromise=null;
export function installModules(){
  if(installPromise)return installPromise;
  installPromise=(async()=>{
    for(const load of startupModules)await load();
    document.dispatchEvent(new CustomEvent('collectish:feature-modules-ready'));
  })();
  return installPromise;
}
