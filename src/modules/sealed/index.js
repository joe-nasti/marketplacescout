let installed=false;

export async function install(){
  if(installed)return;
  installed=true;

  // Start every sealed feature import at once. The previous serial awaits created
  // a mobile-WebView network waterfall even though these modules are independent.
  const [,,,,,renderer]=await Promise.all([
    import('./detail-focus.js'),
    import('./cardtrader.js'),
    import('./cardtrader-opportunities.js'),
    import('./cardtrader-summary.js'),
    import('./cardtrader-links.js'),
    import('./renderer.js')
  ]);
  await renderer.install();
}
