let installed=false;
let secondaryPromise=null;

function scheduleSecondary(){
  if(secondaryPromise)return secondaryPromise;
  const run=()=>{
    if(secondaryPromise)return;
    secondaryPromise=Promise.all([
      import('./order-meta.js'),
      import('./filters.js'),
      import('./drilldowns.js'),
      import('./detail-polish.js'),
      import('./report-presentation.js'),
      import('./cashflow-budget.js'),
      import('./buyer-account.js'),
      import('./buyer-history.js'),
      import('./buyer-range-options.js')
    ]).then(()=>document.dispatchEvent(new CustomEvent('collectish:seller-enhancers-ready')));
  };
  if('requestIdleCallback' in window)requestIdleCallback(run,{timeout:1800});
  else setTimeout(run,250);
  return null;
}

export async function install(){
  if(installed)return;
  installed=true;

  // orders.js is the sole Selling route owner. Route navigation state and
  // deterministic drill-ins install with that owner; slower evidence/report
  // enrichers remain progressive and cannot replace the stable route root.
  await import('./orders.js');
  await Promise.all([
    import('./drill-navigation.js'),
    import('./route-state.js')
  ]);
  document.dispatchEvent(new CustomEvent('collectish:seller-core-ready'));
  scheduleSecondary();
}
