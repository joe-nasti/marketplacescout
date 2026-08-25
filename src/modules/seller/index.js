let installed=false;

export async function install(){
  if(installed)return;
  installed=true;

  // Seller remains a lazy page. Keep all Seller-only enhancers here so they load
  // when the Seller tab opens without adding work to the Scout startup path.
  await Promise.all([
    import('./orders.js'),
    import('./order-meta.js'),
    import('./filters.js'),
    import('./drilldowns.js'),
    import('./detail-polish.js'),
    import('./dashboard-vnext.js'),
    import('./reports-vnext.js'),
    import('./cashflow-budget.js'),
    import('./buyer-account.js'),
    import('./buyer-history.js'),
    import('./buyer-range-options.js')
  ]);
}
