// Marketplace Scout web v0.3.5 — PC unified queue status
(() => {
  const el=id=>document.getElementById(id);
  const badge=el("appVersion"); if(badge) badge.textContent="web v0.3.5";

  // PC v0.9.0 places phone requests into the same persistent queue used by
  // manual and auto-sync scans. While the cloud command status remains
  // "running" for compatibility, progress.stage="queued" means the PC has
  // accepted it but is waiting behind other work.
  window.requestProgressHtml=function(x){
    if(x.status!=="running")return "";
    const p=x.progress_json||{},stage=p.stage||"running";
    const queued=stage==="queued"||stage==="pending"||stage==="requeued";
    const pct=Math.max(0,Math.min(100,Number(p.percent||0)));
    const eta=typeof etaText==="function"?etaText(p.etaSec):"";
    const title=queued?(p.detail||"Queued on PC"):(p.detail||stage||"Running…");
    return `<div class="request-progress ${queued?"queued":"active"}">
      <div class="request-progress-head"><span>${title}</span><b>${queued?"QUEUED":`${Math.round(pct)}%`}</b></div>
      ${queued?'<div class="queue-wait-track"><span></span></div>':`<progress max="100" value="${pct}"></progress>`}
      <div class="meta">${[
        queued?"Waiting behind earlier PC scans":`Stage: ${stage}`,
        !queued&&eta?`ETA ${eta}`:""
      ].filter(Boolean).join(" • ")}</div>
    </div>`;
  };
})();
