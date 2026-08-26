const enhancers=[
  ()=>import('./cashflow-budget.js'),
  ()=>import('./buyer-account.js'),
  ()=>import('./inventory-progress.js'),
  ()=>import('./inventory-sync-controller.js'),
  ()=>import('./inventory-reconciler.js'),
  ()=>import('./inventory-reconcile-status.js'),
  ()=>import('./freshness.js'),
  ()=>import('./refresh-detail-progress.js')
];
let installPromise=null;
export function install(){
  if(installPromise)return installPromise;
  installPromise=(async()=>{
    // inventory.js owns Action queue / Workspace, exact-row detail and Store sync.
    await import('./inventory.js');
    await Promise.all(enhancers.map(load=>load()));
    document.dispatchEvent(new CustomEvent('collectish:inventory-modules-ready'));
  })();
  return installPromise;
}
