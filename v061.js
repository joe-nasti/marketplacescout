// Collectish web v0.6.3 — deterministic startup finalizer
(() => {
  const VERSION='0.6.3';
  function reset(){
    const badge=document.getElementById('appVersion');
    if(badge && badge.textContent!==`web v${VERSION}`)badge.textContent=`web v${VERSION}`;

    let session=null;
    try{session=JSON.parse(localStorage.getItem('collectishSession')||'null')}catch{}
    const loggedOut=!session?.token;
    if(!loggedOut)return;

    const login=document.getElementById('login');
    const app=document.getElementById('app');
    if(login)login.hidden=false;
    if(app)app.hidden=true;

    const banner=document.getElementById('activityBanner');
    if(banner){banner.hidden=true;banner.style.display='none'}
    const scout=document.getElementById('mobileScoutLoading');
    if(scout){scout.hidden=true;scout.style.display='none'}
    document.documentElement.classList.add('collectish-logged-out-idle');
  }
  reset();
  [250,750,1500,3000,6000].forEach(ms=>setTimeout(reset,ms));
})();
