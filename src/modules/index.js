const scoutEnhancers=[
  ()=>import('./scout/volatility.js'),
  ()=>import('./scout/detail-links.js'),
  ()=>import('./scout/detail-compact-header.js'),
  ()=>import('./scout/images.js'),
  ()=>import('./scout/noise-filter.js'),
  ()=>import('./scout/search.js'),
  ()=>import('./scout/vendor.js'),
  ()=>import('./scout/detail-swipe.js'),
  ()=>import('./scout/compact-mobile.js'),
  ()=>import('./scout/liquidity.js'),
  ()=>import('./scout/quick-turn.js'),
  ()=>import('./scout/position-sizing.js'),
  ()=>import('./scout/portfolio-allocation.js'),
  ()=>import('./signals/scout-badges.js'),
  ()=>import('./signals/scout-intelligence-bridge.js'),
  ()=>import('./signals/rendered-capture.js'),
  ()=>import('./signals/share-handoff.js'),
  ()=>import('./signals/market-evaluation.js'),
  ()=>import('./signals/source-rollups.js'),
  ()=>import('./signals/source-performance.js'),
  ()=>import('./signals/competitive.js'),
  ()=>import('./signals/competitive-paper.js'),
  ()=>import('./signals/commander.js'),
  ()=>import('./signals/cross-source.js'),
  ()=>import('./signals/actionable-emerging.js')
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
let askPromise=null;

function scheduleAsk(){
  if(askPromise)return askPromise;
  const run=()=>{
    askPromise=(async()=>{
      await import('./ask/main.js');
      await loadParallel(askEnhancers);
      document.dispatchEvent(new CustomEvent('collectish:ask-modules-ready'));
    })();
    return askPromise;
  };
  if('requestIdleCallback' in window)requestIdleCallback(()=>run(),{timeout:2500});
  else setTimeout(()=>run(),1200);
  return null;
}

export function installModules(){
  if(installPromise)return installPromise;
  installPromise=(async()=>{
    // Scout is the default page, so only Scout-critical enhancers stay on the
    // authenticated startup path. Inventory and Admin now load on first visit.
    await loadParallel(scoutEnhancers);
    document.dispatchEvent(new CustomEvent('collectish:feature-modules-ready'));
    scheduleAsk();
  })();
  return installPromise;
}
