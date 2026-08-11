// Collectish Marketplace Scout web v0.4.5 — visual leaderboard event wiring
(() => {
  const el=id=>document.getElementById(id);
  const badge=el("appVersion");if(badge)badge.textContent="web v0.4.5";
  const run=e=>{e?.preventDefault?.();e?.stopImmediatePropagation?.();window.buildLeaderboard?.()};
  el("leaderRefresh")?.addEventListener("click",run,true);
  ["leaderPeriod","leaderPrinting","leaderCondition","leaderMetric","leaderMinPrice"].forEach(id=>el(id)?.addEventListener("change",run,true));
  // Re-run once after the app has populated scan data and the v0.4.4 visual shell exists.
  setTimeout(()=>{try{if(localStorage.getItem("collectishSession"))window.buildLeaderboard?.()}catch{}},1800);
})();

// Load v0.4.6 component-breakdown / power-user layer after the visual leaderboard.
(() => {
  if(!document.querySelector('link[data-collectish-v046]')){
    const l=document.createElement("link");l.rel="stylesheet";l.href="v046.css?v=046";l.dataset.collectishV046="1";document.head.appendChild(l);
  }
  if(document.querySelector('script[data-collectish-v046]'))return;
  const s=document.createElement("script");s.src="v046.js?v=046";s.dataset.collectishV046="1";document.head.appendChild(s);
})();
