// Safe Collectish hosted-build refresh: explicit marker + at-most-once reload per build.
(() => {
  const INITIAL=document.querySelector('meta[name="collectish-build"]')?.content||'r1011-bootstrap-20260818';
  const url=new URL(location.href);
  const CURRENT=url.searchParams.get('cv')||INITIAL;
  const ATTEMPT_KEY='collectishBuildReloadAttempt';
  let checking=false;

  async function check(){
    if(checking||document.hidden)return;
    checking=true;
    try{
      const r=await fetch(`build-version.json?cb=${Date.now()}`,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
      if(!r.ok)return;
      const d=await r.json().catch(()=>null);
      const live=String(d?.build||'').trim();
      if(!live||live===CURRENT)return;
      if(sessionStorage.getItem(ATTEMPT_KEY)===live)return;
      sessionStorage.setItem(ATTEMPT_KEY,live);
      const next=new URL(location.href);
      next.searchParams.set('cv',live);
      next.searchParams.set('_cb',Date.now().toString());
      location.replace(next.toString());
    }catch(e){
      console.warn('Collectish build check failed',e);
    }finally{checking=false}
  }

  document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(check,250)});
  window.addEventListener('focus',()=>setTimeout(check,250));
  window.addEventListener('pageshow',()=>setTimeout(check,400));
  setTimeout(check,2500);
  setInterval(check,5*60*1000);
  window.CollectishBuildRefresh={check,current:CURRENT};
})();
