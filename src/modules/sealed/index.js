let installed=false;

export async function install(){
  if(installed)return;
  installed=true;

  // The renderer owns the complete first useful Sealed surface. Supporting
  // modules enrich details, links, family economics or URL state without
  // replacing the renderer's primary product list.
  const modules=await Promise.all([
    import('./detail-focus.js'),
    import('./cardtrader.js'),
    import('./cardtrader-opportunities.js'),
    import('./cardtrader-summary.js'),
    import('./cardtrader-links.js'),
    import('./url-state.js'),
    import('./mobile-economics.js'),
    import('./renderer.js'),
    import('./out-optimizer.js'),
    import('./product-family.js')
  ]);
  const urlState=modules[5],renderer=modules[7],outOptimizer=modules[8],family=modules[9];
  urlState.installSealedUrlState();
  outOptimizer.installOutOptimizer();
  family.install();
  await renderer.install();
}
