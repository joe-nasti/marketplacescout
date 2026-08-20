let installed=false;

export async function install(){
  if(installed)return;
  installed=true;

  // Start independent sealed modules concurrently, then initialize URL-backed state
  // before the renderer's first deterministic pass.
  const [,,,,,urlState,,renderer]=await Promise.all([
    import('./detail-focus.js'),
    import('./cardtrader.js'),
    import('./cardtrader-opportunities.js'),
    import('./cardtrader-summary.js'),
    import('./cardtrader-links.js'),
    import('./url-state.js'),
    import('./mobile-economics.js'),
    import('./renderer.js')
  ]);
  urlState.installSealedUrlState();
  await renderer.install();
}
