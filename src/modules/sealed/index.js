let installed=false;

export async function install(){
  if(installed)return;
  installed=true;

  // Start independent sealed modules concurrently, then initialize URL-backed state
  // before the renderer's first deterministic pass.
  const modules=await Promise.all([
    import('./detail-focus.js'),
    import('./cardtrader.js'),
    import('./cardtrader-opportunities.js'),
    import('./cardtrader-summary.js'),
    import('./cardtrader-links.js'),
    import('./url-state.js'),
    import('./mobile-economics.js'),
    import('./dense-list.js'),
    import('./renderer.js')
  ]);
  const urlState=modules[5],renderer=modules[8];
  urlState.installSealedUrlState();
  await renderer.install();
}
