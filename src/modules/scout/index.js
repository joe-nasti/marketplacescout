let installed=false;
let installing=null;

function deferCatalystRecorder(){const run=()=>void import('./catalyst-shadow-recorder.js');if('requestIdleCallback' in window)requestIdleCallback(run,{timeout:2000});else setTimeout(run,700)}
function deferSecondaryScoutEnhancers(){setTimeout(()=>{void import('./oracle-better-printing.js');void import('./price-actionability.js');void import('./flash-buy.js');void import('./oracle-bulk-refresh.js')},900)}
export async function installScoutRenderer(){
  if(installed)return;
  if(installing)return installing;
  installing=(async()=>{
    await import('./first-paint-guard.js');
    await import('./structure-style.js');
    await import('./renderer.js');
    if(!window.CollectishScoutRenderer?.load)throw new Error('Scout renderer did not initialize');
    installed=true;
    document.dispatchEvent(new CustomEvent('collectish:scout-structure-ready'));
    void import('./universal-search.js');void import('./family-link-boot.js');void import('./family-market-context.js');void import('./freshness.js');void import('./oracle-printings.js');void import('./oracle-detail-context.js');void import('./oracle-family-confidence.js');void import('./sealed-source-compare.js');void import('./vendor-depth.js');void import('./price-microstructure.js');void import('./source-health.js');void import('./market-timeline.js');void import('./move-explanation.js');void import('./scout-time-machine.js');void import('./scout-evaluation-history.js');void import('./scout-episode-supply.js');
    void Promise.all([import('./detail-navigation.js'),import('./route-state.js'),import('./score-explain.js'),import('./catalyst-shadow-ui.js')]).then(()=>document.dispatchEvent(new CustomEvent('collectish:scout-interactions-ready')));
    document.addEventListener('collectish:ready',deferCatalystRecorder,{once:true});document.addEventListener('collectish:ready',deferSecondaryScoutEnhancers,{once:true});
  })().finally(()=>{installing=null});
  return installing;
}
export default installScoutRenderer;
