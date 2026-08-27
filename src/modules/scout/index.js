let installed=false;

export async function installScoutRenderer(){
  if(installed)return;
  installed=true;

  // Guard stale/cached content, then let the route-owned renderer compose the
  // complete first useful Scout surface in one pass. Retired mobile/dense
  // compatibility modules are no longer structural dependencies.
  await import('./first-paint-guard.js');
  await import('./structure-style.js');
  await import('./renderer.js');
  document.dispatchEvent(new CustomEvent('collectish:scout-structure-ready'));

  // Search now spans the universal Scout catalog while ranked cards remain the
  // primary first-paint surface. Dormant/catalog-only opens enqueue a wake.
  void import('./universal-search.js');
  void import('./freshness.js');
  void import('./oracle-printings.js');

  // These remain interaction/state enhancers and cannot reshape first paint.
  void Promise.all([
    import('./detail-navigation.js'),
    import('./route-state.js'),
    import('./score-explain.js')
  ]).then(()=>document.dispatchEvent(new CustomEvent('collectish:scout-interactions-ready')));
}

export default installScoutRenderer;