// Keep any late-installed legacy panels hidden behind Admin advanced controls.
(() => {
  function install(){
    const app=document.getElementById('app'),shell=document.getElementById('collectishUxShell');
    if(!app||!shell)return false;
    const mark=()=>[...app.children].forEach(n=>{if(n!==shell)n.classList.add('collectish-legacy-surface')});
    mark();
    new MutationObserver(mark).observe(app,{childList:true});
    return true;
  }
  let tries=0;const t=setInterval(()=>{tries++;if(install()||tries>200)clearInterval(t)},100);
})();
