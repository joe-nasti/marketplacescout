// Collectish hosted-build refresh watchdog.
// Detects when GitHub Pages has published a different static asset graph and reloads once.
(() => {
  const CHECK_MS=5*60*1000;
  const KEY='collectishBuildFingerprint';
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
  function currentFingerprint(){return fingerprint(assetList(document))}

  async function check({force=false}={}){
    if(checking)return false;
    const now=Date.now();if(!force&&now-lastCheck<15000)return false;
    lastCheck=now;checking=true;
    try{
      const url=new URL('index.html',location.href);
      url.searchParams.set('__buildcheck',String(now));
      const r=await fetch(url.toString(),{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
      if(!r.ok)return false;
      const html=await r.text();
      const liveDoc=new DOMParser().parseFromString(html,'text/html');
      const live=fingerprint(assetList(liveDoc)),cur=currentFingerprint();
      localStorage.setItem(KEY,live);
      if(live&&cur&&live!==cur){
        const reload=new URL(location.href);
        reload.searchParams.set('__build',live);
        reload.searchParams.delete('__buildcheck');
        location.replace(reload.toString());
        return true;
      }
      return false;
    }catch(e){console.warn('Collectish build refresh check failed',e);return false}
    finally{checking=false}
  }

  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')setTimeout(()=>check({force:true}),250)});
  window.addEventListener('focus',()=>setTimeout(()=>check(),250));
  window.addEventListener('pageshow',()=>setTimeout(()=>check({force:true}),350));
  setInterval(()=>{if(document.visibilityState==='visible')check()},CHECK_MS);
  window.CollectishBuildRefresh={check,currentFingerprint};
  setTimeout(()=>check({force:true}),1500);
})();
