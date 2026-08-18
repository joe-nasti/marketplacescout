// Collectish hosted-build refresh watchdog r0999.
// Compare the deployed static asset graph to a snapshot captured before runtime/lazy assets mutate the DOM.
(() => {
  const CHECK_MS=5*60*1000;
  const LAST_SEEN='collectishBuildFingerprint';
  const LAST_RELOAD='collectishBuildReloadAttempt';
  let checking=false,lastCheck=0;

  function assetList(doc){
    const out=[];
    doc.querySelectorAll('script[src]').forEach(x=>out.push(`js:${x.getAttribute('src')}`));
    doc.querySelectorAll('link[rel="stylesheet"][href]').forEach(x=>out.push(`css:${x.getAttribute('href')}`));
    return out.sort();
  }
  function fingerprint(list){
    let h=2166136261;
    const s=list.join('\n');
    for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}
    return (h>>>0).toString(36);
  }

  // Critical: capture once, before lazy page/runtime scripts can be appended to document.body.
  const BOOT_FINGERPRINT=fingerprint(assetList(document));

  async function check({force=false}={}){
    if(checking)return false;
    const now=Date.now();
    if(!force&&now-lastCheck<15000)return false;
    lastCheck=now;checking=true;
    try{
      const url=new URL('index.html',location.href);
      url.searchParams.set('__buildcheck',String(now));
      const r=await fetch(url.toString(),{cache:'no-store',headers:{'Cache-Control':'no-cache, no-store','Pragma':'no-cache'}});
      if(!r.ok)return false;
      const liveDoc=new DOMParser().parseFromString(await r.text(),'text/html');
      const live=fingerprint(assetList(liveDoc));
      if(!live)return false;
      localStorage.setItem(LAST_SEEN,live);
      if(live===BOOT_FINGERPRINT){
        sessionStorage.removeItem(LAST_RELOAD);
        return false;
      }

      // Never reload repeatedly for the same target build. If one cache-busted reload did not
      // produce that build, leave the app usable and try again on a future deployment/check.
      if(sessionStorage.getItem(LAST_RELOAD)===live){
        console.warn('Collectish build refresh suppressed repeated reload', {boot:BOOT_FINGERPRINT,live});
        return false;
      }
      sessionStorage.setItem(LAST_RELOAD,live);
      const reload=new URL(location.href);
      reload.searchParams.set('__build',live);
      reload.searchParams.delete('__buildcheck');
      location.replace(reload.toString());
      return true;
    }catch(e){
      console.warn('Collectish build refresh check failed',e);
      return false;
    }finally{checking=false}
  }

  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')setTimeout(()=>check({force:true}),350)});
  window.addEventListener('focus',()=>setTimeout(()=>check(),350));
  window.addEventListener('pageshow',()=>setTimeout(()=>check({force:true}),500));
  setInterval(()=>{if(document.visibilityState==='visible')check()},CHECK_MS);
  window.CollectishBuildRefresh={check,bootFingerprint:BOOT_FINGERPRINT};
  setTimeout(()=>check({force:true}),2500);
})();
