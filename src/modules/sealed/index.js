let installed=false;

export async function install(){
  if(installed)return;
  installed=true;

  // The renderer owns the complete first useful Sealed surface. Supporting
  // modules may enrich details, links, economics or URL state, but they cannot
  // rewrite the list or insert a competing structural layer after paint.
  const modules=await Promise.all([
    import('./detail-focus.js'),
    import('./cardtrader.js'),
    import('./cardtrader-opportunities.js'),
    import('./cardtrader-summary.js'),
    import('./cardtrader-links.js'),
    import('./url-state.js'),
    import('./mobile-economics.js'),
    import('./renderer.js'),
    import('./out-optimizer.js')
  ]);
  const urlState=modules[5],renderer=modules[7],outOptimizer=modules[8];
  urlState.installSealedUrlState();
  outOptimizer.installOutOptimizer();
  await renderer.install();
}
