const scoutEnhancers=[
  ()=>import('./scout/volatility.js'),
  ()=>import('./scout/detail-links.js'),
  ()=>import('./scout/images.js'),
  ()=>import('./scout/noise-filter.js'),
  ()=>import('./scout/search.js'),
  ()=>import('./scout/vendor.js'),
  ()=>import('./scout/detail-swipe.js'),
  ()=>import('./scout/compact-mobile.js')
];

const inventoryEnhancers=[
  ()=>import('./seller/inventory-progress.js'),
  ()=>import('./seller/inventory-sync-controller.js'),
  ()=>import('./seller/inventory-reconciler.js'),
  ()=>import('./seller/inventory-reconcile-status.js'),
  ()=>import('./seller/seller-sync-progress-style.js'),
  ()=>import('./seller/freshness.js')
];

const adminModules=[
  ()=>import('./admin/scans.js'),
  ()=>import('./admin/fixed-nav.js'),
  ()=>import('./admin/marketplace-health.js'),
  ()=>import('./admin/console.js'),
  ()=>import('./admin/sealed-catalog.js'),
  ()=>import('./admin/sealed-health.js'),
  ()=>import('./admin/cardtrader-health.js'),
  ()=>import('./admin/top.js')
];

const askEnhancers=[
  ()=>import('./ask/investigate-presentation.js'),
  ()=>import('./ask/concise-view.js'),
  ()=>import('./ask/investigate.js'),
  ()=>import('./ask/actions.js'),
  ()=>import('./ask/admin.js')
];

const loadParallel=loaders=>Promise.all(loaders.map(load=>load()));
let installPromise=null;

export function installModules(){
  if(installPromise)return installPromise;
  installPromise=(async()=>{
    // Preserve the few real ordering dependencies, but fetch/evaluate independent
    // feature modules in parallel instead of one network roundtrip at a time.
    await loadParallel(scoutEnhancers);

    await import('./seller/inventory.js');
    await loadParallel(inventoryEnhancers);

    await loadParallel(adminModules);

    await import('./ask/main.js');
    await loadParallel(askEnhancers);

    document.dispatchEvent(new CustomEvent('collectish:feature-modules-ready'));
  })();
  return installPromise;
}
