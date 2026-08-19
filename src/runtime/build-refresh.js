const ATTEMPT_KEY='collectishBuildReloadAttempt';
let checking=false;

export function loadedBuild(){
  return document.querySelector('meta[name="collectish-build"]')?.content||'unknown';
}

export async function checkForBuildUpdate(){
  if(checking||document.hidden)return {checked:false,reason:'busy_or_hidden'};
  checking=true;
  try{
    const r=await fetch(`build-version.json?cb=${Date.now()}`,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
    if(!r.ok)return {checked:false,reason:`http_${r.status}`};
    const d=await r.json().catch(()=>null);
    const live=String(d?.build||'').trim();
    const current=loadedBuild();
    if(!live||live===current)return {checked:true,current:true,build:live||current};
    if(sessionStorage.getItem(ATTEMPT_KEY)===live)return {checked:true,current:false,attempted:true,build:live};
    sessionStorage.setItem(ATTEMPT_KEY,live);
    const next=new URL(location.href);
    next.searchParams.set('cv',live);
    next.searchParams.set('_cb',Date.now().toString());
    location.replace(next.toString());
    return {checked:true,current:false,reloading:true,build:live};
  }catch(error){
    console.warn('Collectish build check failed',error);
    return {checked:false,reason:'error'};
  }finally{
    checking=false;
  }
}

export function installBuildRefresh(){
  const delayed=ms=>setTimeout(()=>checkForBuildUpdate(),ms);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)delayed(250)});
  window.addEventListener('pageshow',()=>delayed(400));
  // Focus can fire repeatedly during Android tab/app transitions; debounce via checking.
  window.addEventListener('focus',()=>delayed(300));
  delayed(2500);
  setInterval(()=>{if(!document.hidden)checkForBuildUpdate()},5*60*1000);
}

installBuildRefresh();
