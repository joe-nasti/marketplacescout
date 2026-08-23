const scoutCore=[
  ()=>import('./scout/detail-links.js'),
  ()=>import('./scout/detail-compact-header.js'),
  ()=>import('./scout/images.js'),
  ()=>import('./scout/progressive-render.js'),
  ()=>import('./scout/search.js'),
  ()=>import('./scout/vendor.js'),
  ()=>import('./scout/detail-swipe.js'),
  ()=>import('./scout/compact-mobile.js'),
  ()=>import('./scout/liquidity.js')
];

const scoutPostRender=[
  ()=>import('./scout/volatility.js'),
  ()=>import('./scout/noise-filter.js'),
  ()=>import('./scout/quick-turn.js'),
  ()=>import('./scout/position-sizing.js'),
  ()=>import('./scout/portfolio-allocation.js')
];

const scoutIntelligence=[
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
  ()=>import('./ask/structured-surfaces.js'),
  ()=>import('./ask/rich-surfaces.js'),
  ()=>import('./ask/investigate.js'),
  ()=>import('./ask/actions.js'),
  ()=>import('./ask/admin.js')
];

const loadParallel=loaders=>Promise.all(loaders.map(load=>load()));
const idle=(fn,{timeout=2500,delay=0}={})=>{
  const run=()=>{
    if('requestIdleCallback' in window)requestIdleCallback(()=>fn(),{timeout});
    else setTimeout(()=>fn(),Math.min(timeout,1200));
  };
  if(delay>0)setTimeout(run,delay);else run();
};
let installPromise=null;
let postRenderPromise=null;
let idlePromise=null;
let postRenderScheduled=false;

function schedulePostRenderEnhancers(){
  if(postRenderScheduled||postRenderPromise)return;
  postRenderScheduled=true;
  idle(()=>{
    if(postRenderPromise)return;
    const started=performance.now();
    postRenderPromise=loadParallel(scoutPostRender).then(()=>{
      document.dispatchEvent(new CustomEvent('collectish:scout-post-render-modules-ready',{detail:{ms:Math.round(performance.now()-started)}}));
    });
  },{timeout:2200,delay:350});
}

function scheduleIdleEnhancers(){
  if(idlePromise)return idlePromise;
  idle(()=>{
    if(idlePromise)return;
    idlePromise=(async()=>{
      await Promise.all([
        loadParallel(scoutIntelligence),
        (async()=>{await import('./ask/endpoint-proxy.js');await import('./ask/main.js');await loadParallel(askEnhancers)})()
      ]);
      document.dispatchEvent(new CustomEvent('collectish:idle-modules-ready'));
    })();
  },{timeout:4500,delay:1500});
  return null;
}

function onScoutReady(){
  schedulePostRenderEnhancers();
  scheduleIdleEnhancers();
}

document.addEventListener('collectish:scout-v5-ready',onScoutReady,{once:true});

export function installModules(){
  if(installPromise)return installPromise;
  installPromise=(async()=>{
    // Keep first-paint Scout interaction code on the authenticated startup path.
    // RPC-producing overlays wait until after the ranked list is rendered and the
    // browser has an idle slice; intelligence and Ask start in a later idle wave.
    await loadParallel(scoutCore);
    document.dispatchEvent(new CustomEvent('collectish:feature-modules-ready'));
    if(document.getElementById('cxScout')?.dataset.scoutV5==='promoted')onScoutReady();
  })();
  return installPromise;
}
