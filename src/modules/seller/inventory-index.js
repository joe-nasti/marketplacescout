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
let enhancerPromise=null;

function scheduleEnhancers(){
  if(enhancerPromise)return enhancerPromise;
  const run=()=>{
    if(enhancerPromise)return;
    enhancerPromise=Promise.all(enhancers.map(load=>load())).then(()=>{
      document.dispatchEvent(new CustomEvent('collectish:inventory-enhancers-ready'));
    });
  };
  if('requestIdleCallback' in window)requestIdleCallback(run,{timeout:1600});
  else setTimeout(run,220);
  return null;
}

export function install(){
  if(installPromise)return installPromise;
  installPromise=(async()=>{
    // inventory.js owns Action queue / Workspace, exact-row detail and Store sync.
    // Route readiness must not wait for operational progress/reconcile/freshness
    // helpers: those are progressive enhancers and may load after first use.
    await import('./inventory.js');
    document.dispatchEvent(new CustomEvent('collectish:inventory-modules-ready'));
    scheduleEnhancers();
  })();
  return installPromise;
}
