let installed=false;

function deferCatalystRecorder(){
  const run=()=>void import('./catalyst-shadow-recorder.js');
  if('requestIdleCallback' in window)requestIdleCallback(run,{timeout:2000});
  else setTimeout(run,700);
}

export async function installScoutRenderer(){
  if(installed)return;
  installed=true;

  await import('./first-paint-guard.js');
  await import('./structure-style.js');
  await import('./renderer.js');
  document.dispatchEvent(new CustomEvent('collectish:scout-structure-ready'));

  void import('./universal-search.js');
  void import('./freshness.js');
  void import('./oracle-printings.js');
  void import('./oracle-better-printing.js');
  void import('./oracle-bulk-refresh.js');
  void import('./oracle-detail-context.js');
  void import('./oracle-family-confidence.js');
  void import('./price-actionability.js');
  void import('./flash-buy.js');

  void Promise.all([
    import('./detail-navigation.js'),
    import('./route-state.js'),
    import('./score-explain.js'),
    import('./catalyst-shadow-ui.js')
  ]).then(()=>document.dispatchEvent(new CustomEvent('collectish:scout-interactions-ready')));
  document.addEventListener('collectish:ready',deferCatalystRecorder,{once:true});
}

export default installScoutRenderer;