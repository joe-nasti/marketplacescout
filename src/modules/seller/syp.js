let installed=false;
let enhancersPromise=null;

function scheduleEnhancers(){
  if(enhancersPromise)return enhancersPromise;
  const run=()=>{
    if(enhancersPromise)return;
    enhancersPromise=Promise.all([
      import('./syp-freshness.js'),
      import('./syp-links.js')
    ]).then(()=>document.dispatchEvent(new CustomEvent('collectish:syp-enhancers-ready')));
  };
  if('requestIdleCallback' in window)requestIdleCallback(run,{timeout:1400});
  else setTimeout(run,220);
  return null;
}

export async function install(){
  if(installed)return;
  installed=true;

  // syp-feed owns Scan / Workspace / Changes and first useful paint. Freshness
  // and link helpers may annotate the stable route without creating a second shell.
  await import('./syp-feed.js');
  document.dispatchEvent(new CustomEvent('collectish:syp-core-ready'));
  scheduleEnhancers();
}
