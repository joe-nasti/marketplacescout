// Collectish web v0.6.1 — stabilize version badge and logged-out startup
(() => {
  const VERSION='0.6.1';
  const el=id=>document.getElementById(id);

  // Older additive overlays attached competing MutationObservers to the same
  // version node. Replacing the node detaches those observers and stops the
  // endless mutation loop seen on the logged-out page.
  const old=el('appVersion');
  if(old){
    const fresh=old.cloneNode(true);
    fresh.removeAttribute('data-collectish-version-guard');
    fresh.textContent=`web v${VERSION}`;
    old.replaceWith(fresh);
  }
  const setBadge=()=>{const b=el('appVersion');if(b)b.textContent=`web v${VERSION}`};
  [0,100,250,500,1000,2000,3500,6000,8000].forEach(ms=>setTimeout(setBadge,ms));

  // A logged-out visitor should be visually idle. Older overlays may create
  // activity/loading elements even though no authenticated data can load.
  const settleLoggedOut=()=>{
    let s=null;try{s=JSON.parse(localStorage.getItem('collectishSession')||'null')}catch{}
    if(s?.token)return;
    const banner=el('activityBanner');if(banner){banner.hidden=true;banner.style.display='none'}
    const scout=el('mobileScoutLoading');if(scout){scout.hidden=true;scout.style.display='none'}
    document.documentElement.classList.add('collectish-logged-out-idle');
  };
  settleLoggedOut();
  [250,750,1500,3000,6000].forEach(ms=>setTimeout(settleLoggedOut,ms));
})();
