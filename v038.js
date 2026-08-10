// Collectish Marketplace Scout web v0.3.8 — mobile parity / queue + smart-depth visibility
(() => {
  const el=id=>document.getElementById(id);
  const badge=el("appVersion"); if(badge) badge.textContent="web v0.3.8";

  function depthLabel(p={}){
    const requested=p.scanDepthRequested||p.scanDepth||"Smart";
    const resolved=p.scanDepthResolved||requested;
    if(requested==="Smart"&&resolved!=="Smart") return `Smart → ${resolved}`;
    return resolved;
  }
  function statusClass(s){return ["complete","failed","running","pending"].includes(s)?s:"pending"}
  function fmt(v){return v?new Date(v).toLocaleString():"—"}

  // Make Smart scan behavior explicit on mobile.
  if(el("newScanDepth")&&!document.getElementById("mobileSmartDepthHelp")){
    const help=document.createElement("div");
    help.id="mobileSmartDepthHelp";
    help.className="meta mobile-capability-note";
    help.textContent="Smart depth: first/full baseline, then Top 500 refreshes until the full baseline is 7 days old, then Full again. The PC applies the same policy to phone, manual, and auto-sync jobs.";
    el("newScanDepth").closest("label")?.appendChild(help);
  }

  // Add a compact PC capabilities / source note. EDHREC intentionally remains an
  // independent PC-local source until source snapshots are moved to shared cloud storage.
  if(!el("mobileDataSources")){
    const card=document.createElement("section");
    card.id="mobileDataSources";
    card.className="card";
    card.innerHTML=`<h2>Data sources</h2>
      <div class="mobile-source-row"><div><b>Marketplace</b><div class="meta">Shared scans, exact-SKU analytics, Normal/Foil separation, Smart depth.</div></div><span class="mobile-source-badge on">Shared</span></div>
      <div class="mobile-source-row"><div><b>EDHREC Commander demand</b><div class="meta">Optional independent demand / reprint source. Collection and history currently live on the PC extension.</div></div><span class="mobile-source-badge">PC-local</span></div>
      <div class="meta mobile-capability-note">EDHREC does not alter HOT/WATCH yet. Mobile EDHREC browsing will require source snapshots to be synchronized to the shared database; keeping it PC-local for now preserves the independent-source deployment boundary.</div>`;
    const analytics=[...document.querySelectorAll("section.card")].find(s=>s.querySelector("h2")?.textContent==="Mobile analytics");
    analytics?.parentNode?.insertBefore(card,analytics);
  }

  // Add a mobile view of the cloud command queue with the profile fields the PC now honors.
  if(!el("mobileQueueDetail")){
    const card=document.createElement("section");
    card.id="mobileQueueDetail";
    card.className="card";
    card.innerHTML=`<div class="toolbar"><div><h2>PC scan queue</h2><div class="meta">Phone requests with printing, Smart/fixed depth, and enrichment settings.</div></div><button id="mobileQueueRefresh">Refresh</button></div><div id="mobileQueueRows"></div>`;
    const requests=[...document.querySelectorAll("section.card")].find(s=>s.querySelector("h2")?.textContent==="Requests");
    requests?.parentNode?.insertBefore(card,requests);
  }

  async function refreshQueueDetail(){
    if(typeof rest!=="function"||!el("mobileQueueRows"))return;
    try{
      const rows=await rest("marketplace_scan_commands?select=*&order=requested_at.desc&limit=30");
      el("mobileQueueRows").innerHTML=rows.length?rows.map(x=>{
        const p=x.profile_json||{},pr=x.progress_json||{},pct=Math.max(0,Math.min(100,Number(pr.percent||0)));
        return `<div class="mobile-queue-job ${statusClass(x.status)}">
          <div class="mobile-queue-head"><div><b>${p.setName||p.setSlug||"Unknown set"}</b><div class="meta">${p.printing||"Both"} / ${p.condition||"Near Mint"} / ${p.language||"English"} • ${depthLabel(p)} • Top ${Number(p.salesEnrich||0)}</div></div><span class="mobile-status ${statusClass(x.status)}">${String(x.status||"pending").toUpperCase()}</span></div>
          <div class="meta">Requested ${fmt(x.requested_at)}${x.started_at?` • Started ${fmt(x.started_at)}`:""}</div>
          ${["running","pending"].includes(x.status)?`<div class="mobile-progress-line"><progress max="100" value="${pct}"></progress><span>${Math.round(pct)}%</span></div><div class="meta">${pr.detail||pr.stage|| (x.status==="pending"?"Waiting for PC":"Running")}${pr.etaSec?` • ETA ~${Math.ceil(Number(pr.etaSec)/60)}m`:""}</div>`:""}
          ${x.error_message?`<div class="mobile-error">${x.error_message}</div>`:""}
        </div>`;
      }).join(""):'<div class="meta">No recent phone scan requests.</div>';
    }catch(e){el("mobileQueueRows").innerHTML=`<div class="mobile-error">${e.message}</div>`}
  }
  el("mobileQueueRefresh")?.addEventListener("click",refreshQueueDetail);
  setInterval(refreshQueueDetail,15000);
  setTimeout(refreshQueueDetail,600);

  // Decorate Latest scans with depth/coverage when profile_json is available.
  async function refreshCoverageSummary(){
    if(typeof rest!=="function")return;
    try{
      const scans=await rest("marketplace_scans?select=scan_id,captured_at,set_name,printing,condition,language,unique_skus,hot_count,watch_count,profile_json&order=captured_at.desc&limit=15");
      let host=el("mobileCoverageHistory");
      if(!host){
        const latest=[...document.querySelectorAll("section.card")].find(s=>s.querySelector("h2")?.textContent==="Latest scans");
        if(!latest)return;
        host=document.createElement("div");host.id="mobileCoverageHistory";latest.appendChild(host);
      }
      host.innerHTML=`<div class="mobile-coverage-list">${scans.map(s=>{const p=s.profile_json||{};const coverage=p.coverageFull===false?(p.scanDepthResolved||`Top ${p.coverageLimit||p.scannedSearchPositions||"?"}`):(p.scanDepthResolved||p.scanDepthRequested||"Full");return `<div class="mobile-coverage-row"><div><b>${s.set_name}</b><div class="meta">${s.printing} / ${s.condition} / ${s.language} • ${coverage}</div></div><div class="mobile-coverage-metrics"><b>${Number(s.unique_skus||0).toLocaleString()} SKUs</b><span>${Number(s.hot_count||0)} HOT / ${Number(s.watch_count||0)} WATCH</span></div></div>`}).join("")}</div>`;
    }catch(e){/* older schemas may not expose profile_json select in some environments */}
  }
  setTimeout(refreshCoverageSummary,1000);
})();
