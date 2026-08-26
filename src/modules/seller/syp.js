let installed=false;
let enhancersPromise=null;

function scheduleEnhancers(){
  if(enhancersPromise)return enhancersPromise;
  const run=()=>{
    if(enhancersPromise)return;
    enhancersPromise=Promise.all([
      import('./syp-freshness.js'),
      import('./syp-links.js'),
      import('./syp-dense-vnext.js')
    ]).then(()=>document.dispatchEvent(new CustomEvent('collectish:syp-enhancers-ready')));
  };
  if('requestIdleCallback' in window)requestIdleCallback(run,{timeout:1400});
  else setTimeout(run,220);
  return null;
}

export async function install(){
  if(installed)return;
  installed=true;

  // The feed is the route renderer and owns first paint. Freshness, link helpers,
  // and density polish are progressive enhancements and cannot block navigation.
  await import('./syp-feed.js');
  document.dispatchEvent(new CustomEvent('collectish:syp-core-ready'));
  scheduleEnhancers();
}
