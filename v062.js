// Collectish web v0.6.2 — stable logged-out startup
(() => {
  const version='0.6.2';
  const fix=()=>{
    const b=document.getElementById('appVersion');
    if(b)b.textContent=`web v${version}`;
    let s=null;try{s=JSON.parse(localStorage.getItem('collectishSession')||'null')}catch{}
    if(!s?.token){
      const a=document.getElementById('activityBanner');if(a){a.hidden=true;a.style.display='none'}
      const m=document.getElementById('mobileScoutLoading');if(m){m.hidden=true;m.style.display='none'}
    }
  };
  fix();
  [500,1500,3000,6000,10000,15000].forEach(ms=>setTimeout(fix,ms));
})();
