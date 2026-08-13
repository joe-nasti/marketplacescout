// Collectish Marketplace Scout web v0.4.9 — Scout loading feedback
(() => {
  const el=id=>document.getElementById(id);
  const badge=el("appVersion");if(badge)badge.textContent="web v0.4.9";
  if(!document.querySelector('link[data-collectish-v049]')){const l=document.createElement("link");l.rel="stylesheet";l.href="v049.css?v=049";l.dataset.collectishV049="1";document.head.appendChild(l)}
  let wrapped=false,phaseTimer=null;

  function ensureLoader(){
    if(el("mobileScoutLoading"))return el("mobileScoutLoading");
    const body=el("leaderBody"),section=body?.closest("section.card");if(!section)return null;
    const host=document.createElement("div");host.id="mobileScoutLoading";host.className="mobile-scout-loading";host.hidden=true;
    host.innerHTML='<div class="mobile-scout-loading-spinner"></div><div class="mobile-scout-loading-copy"><strong id="mobileScoutLoadingTitle">Preparing Scout…</strong><span id="mobileScoutLoadingDetail">Loading opportunity data…</span><div class="mobile-scout-loading-track"><span></span></div></div>';
    const status=el("leaderStatus");status?.parentNode?.insertBefore(host,status);
    return host;
  }
  function show(title="Preparing Scout…",detail="Loading opportunity data…"){
    const host=ensureLoader();if(!host)return;
    host.hidden=false;el("mobileScoutLoadingTitle").textContent=title;el("mobileScoutLoadingDetail").textContent=detail;
    const bar=host.querySelector(".mobile-scout-loading-track span");if(bar)bar.classList.add("indeterminate");
    clearTimeout(phaseTimer);phaseTimer=setTimeout(()=>{if(!host.hidden)el("mobileScoutLoadingDetail").textContent="Loading scan history, ranking cards, and resolving artwork…"},900);
  }
  function hide(){
    const host=ensureLoader();if(!host)return;clearTimeout(phaseTimer);
    el("mobileScoutLoadingTitle").textContent="Scout ready";el("mobileScoutLoadingDetail").textContent="Opportunity cards are ready.";
    setTimeout(()=>{host.hidden=true},260);
  }
  function install(){
    ensureLoader();
    if(wrapped||!el("leaderVisual")||!el("leaderHelp")||typeof window.buildLeaderboard!=="function")return false;
    const original=window.buildLeaderboard;
    if(original.__collectishLoadingWrapped){wrapped=true;return true}
    const fn=async function(...args){show("Preparing Scout…","Loading cross-scan opportunity history…");try{return await original.apply(this,args)}finally{hide()}};
    fn.__collectishLoadingWrapped=true;window.buildLeaderboard=fn;wrapped=true;return true;
  }
  let tries=0;const t=setInterval(()=>{tries++;if(install()||tries>120)clearInterval(t)},100);
})();

// Load the unified Collectish app shell and subsequent overlays without requiring
// another index.html migration. This keeps the additive overlay chain intact.
(() => {
  const load=(version)=>{
    if(document.querySelector(`script[data-collectish-v${version}]`))return;
    const s=document.createElement('script');
    s.src=`v${version}.js?v=${version}`;
    s.dataset[`collectishV${version}`]='1';
    document.body.appendChild(s);
  };
  load('050');
  load('051');
  load('052');
  load('053');
  load('055');
  load('056');
})();
