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
      import('./reports-vnext.js'),
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

  // orders.js is the sole Selling route owner. Dashboard and report markup are
  // composed inside its stable route root; secondary modules may add evidence,
  // buyer/cashflow surfaces, and report polish without replacing that root.
  await import('./orders.js');
  document.dispatchEvent(new CustomEvent('collectish:seller-core-ready'));
  scheduleSecondary();
}
