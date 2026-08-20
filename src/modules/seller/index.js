let installed=false;

export async function install(){
  if(installed)return;
  installed=true;

  // Kick off independent Seller feature imports together to avoid serial network
  // roundtrips in mobile WebView. These modules self-register/render on evaluation.
  await Promise.all([
    import('./orders.js'),
    import('./order-meta.js'),
    import('./filters.js'),
    import('./drilldowns.js'),
    import('./detail-polish.js')
  ]);
}
