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
