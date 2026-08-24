const loaders=[
  ()=>import('./alerts.js'),
  ()=>import('./scans.js'),
  ()=>import('./fixed-nav.js'),
  ()=>import('./marketplace-health.js'),
  ()=>import('./console.js'),
  ()=>import('./sealed-catalog.js'),
  ()=>import('./sealed-health.js'),
  ()=>import('./cardtrader-health.js'),
  ()=>import('./top.js'),
  ()=>import('./admin-vnext-style.js'),
  ()=>import('./admin-vnext.js')
];
let installPromise=null;
export function install(){
  if(installPromise)return installPromise;
  installPromise=Promise.all(loaders.map(load=>load())).then(()=>{
    document.dispatchEvent(new CustomEvent('collectish:admin-modules-ready'));
  });
  return installPromise;
}
