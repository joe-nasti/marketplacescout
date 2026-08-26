let installed=false;

export async function installScoutRenderer(){
  if(installed)return;
  installed=true;

  // Guard stale/cached content, then let the route-owned renderer compose the
  // complete first useful Scout surface in one pass. The legacy IA/mobile/dense
  // modules are no longer structural dependencies.
  await import('./first-paint-guard.js');
  await import('./ia-v2-style.js');
  await import('./renderer.js');
  document.dispatchEvent(new CustomEvent('collectish:scout-structure-ready'));

  // These remain interaction-only enhancers and cannot reshape first paint.
  void Promise.all([
    import('./detail-navigation.js'),
    import('./score-explain.js')
  ]).then(()=>document.dispatchEvent(new CustomEvent('collectish:scout-interactions-ready')));
}

export default installScoutRenderer;
