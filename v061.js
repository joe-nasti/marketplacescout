// Collectish web v0.6.1 — startup stabilizer
(() => {
  const VERSION='0.6.1';
  function reset(){
    const old=document.getElementById('appVersion');
    if(!old)return;
    const fresh=old.cloneNode(true);
    fresh.removeAttribute('data-collectish-version-guard');
    fresh.textContent=`web v${VERSION}`;
    old.replaceWith(fresh);
    const banner=document.getElementById('activityBanner');
    if(banner&&document.getElementById('login')&&!document.getElementById('login').hidden){banner.hidden=true;banner.style.display='none'}
    const scout=document.getElementById('mobileScoutLoading');
    if(scout&&document.getElementById('login')&&!document.getElementById('login').hidden){scout.hidden=true;scout.style.display='none'}
  }
  [0,500,1500,3000,5000,8000,12000].forEach(ms=>setTimeout(reset,ms));
})();
