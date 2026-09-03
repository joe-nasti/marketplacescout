const scoutCore=[
  ()=>import('./scout/detail-links.js'),
  ()=>import('./scout/detail-compact-header.js'),
  ()=>import('./scout/images.js'),
  ()=>import('./scout/progressive-render.js'),
  ()=>import('./scout/search.js'),
  ()=>import('./scout/search-autocomplete-handoff.js'),
  ()=>import('./scout/power-search.js'),
  ()=>import('./scout/power-search-layout.js'),
  ()=>import('./scout/search-detail-navigation.js'),
  ()=>import('./scout/vendor.js'),
  ()=>import('./scout/detail-swipe.js'),
  ()=>import('./scout/liquidity.js'),
  ()=>import('./scout/velocity-display.js')
];

const scoutPostRender=[
  ()=>import('./scout/volatility.js'),
  ()=>import('./scout/noise-filter.js'),
  ()=>import('./scout/quick-turn.js'),
  ()=>import('./scout/position-sizing.js'),
  ()=>import('./scout/portfolio-allocation.js')
];

const scoutIntelligence=[
  ()=>import('./signals/scout-open-navigation-guard.js'),
  ()=>import('./signals/scout-badges.js'),
  ()=>import('./signals/scout-synergy-opportunities.js'),
  ()=>import('./signals/scout-intelligence-bridge.js'),
  ()=>import('./signals/video-events-ui.js'),
  ()=>import('./signals/future-card-theses.js'),
  ()=>import('./signals/synergy-relationships.js'),
  ()=>import('./signals/entity-semantic-labels.js'),
  ()=>import('./signals/source-grouping.js'),
  ()=>import('./signals/rendered-capture.js'),
  ()=>import('./signals/source-collectors.js'),
  ()=>import('./signals/share-handoff.js'),
  ()=>import('./signals/market-evaluation.js'),
  ()=>import('./signals/source-rollups.js'),
  ()=>import('./signals/source-performance.js'),
  ()=>import('./signals/competitive.js'),
  ()=>import('./signals/competitive-evidence.js'),
  ()=>import('./signals/signal-story-source-dedupe.js'),
  ()=>import('./signals/competitive-paper.js'),
  ()=>import('./signals/commander.js'),
  ()=>import('./signals/cross-source.js'),
  ()=>import('./signals/actionable-emerging.js')
];

const askEnhancers=[
  ()=>import('./ask/voice-capture.js'),
  ()=>import('./ask/preferences-cache.js'),
  ()=>import('./ask/actionable-signals-context.js'),
  ()=>import('./ask/signals-starters.js'),
  ()=>import('./ask/investigate-presentation.js'),
  ()=>import('./ask/concise-view.js'),
  ()=>import('./ask/rich-surfaces.js'),
  ()=>import('./ask/investigate.js'),
  ()=>import('./ask/actions.js'),
  ()=>import('./ask/admin.js'),
  ()=>import('./ask/deep-history-backfill.js')
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
let intelligencePromise=null;
let askPromise=null;
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

function loadScoutIntelligence(){
  if(intelligencePromise)return intelligencePromise;
  intelligencePromise=loadParallel(scoutIntelligence).then(()=>{
    document.dispatchEvent(new CustomEvent('collectish:scout-intelligence-modules-ready'));
    document.dispatchEvent(new CustomEvent('collectish:idle-modules-ready'));
  });
  return intelligencePromise;
}

function loadAsk(){
  if(askPromise)return askPromise;
  askPromise=(async()=>{
    await import('./ask/context.js');
    await import('./ask/endpoint-proxy.js');
    await import('./ask/delvin-market-radar-route.js');
    await import('./ask/structured-surfaces.js');
    await import('./ask/surface-persistence.js');
    await import('./ask/main.js');
    await import('./ask/streaming.js');
    await import('./ask/sales-history-surface.js');
    await import('./ask/market-investigation-surface.js');
    await import('./ask/history-action-routing.js');
    await loadParallel(askEnhancers);
    document.dispatchEvent(new CustomEvent('collectish:ask-modules-ready'));
  })();
  return askPromise;
}

function onScoutReady(){
  schedulePostRenderEnhancers();
}

document.addEventListener('collectish:scout-v5-ready',onScoutReady,{once:true});
document.addEventListener('collectish:page-change',event=>{
  if(event.detail?.page==='signals')void loadScoutIntelligence();
});
document.addEventListener('collectish:open-scout-card',()=>void loadScoutIntelligence());
document.addEventListener('collectish:open-ask',()=>void loadAsk());

export function installModules(){
  if(installPromise)return installPromise;
  installPromise=(async()=>{
    await import('../core/ui-adoption.js');
    await loadParallel(scoutCore);
    document.dispatchEvent(new CustomEvent('collectish:feature-modules-ready'));
    if(document.getElementById('cxScout')?.dataset.scoutV5==='promoted')onScoutReady();
    if(document.getElementById('cxSignals')?.classList.contains('active'))void loadScoutIntelligence();
    if(window.__CollectishOpenAskRequested||new URL(location.href).searchParams.get('overlay')==='ask')void loadAsk();
  })();
  return installPromise;
}
