// Collectish web v0.5.7 — scheduled cloud verification + parity results
(() => {
  const VERSION="0.5.7",el=id=>document.getElementById(id);
  const setBadge=()=>{const b=el("appVersion");if(b)b.textContent=`web v${VERSION}`};
  setBadge();
  if(!document.querySelector('link[data-collectish-v057]')){const l=document.createElement('link');l.rel='stylesheet';l.href='v057.css?v=057';l.dataset.collectishV057='1';document.head.appendChild(l)}

  function session(){try{return JSON.parse(localStorage.getItem("collectishSession")||"null")}catch{return null}}
  function cfg(){return window.COLLECTISH_CONFIG||{}}
  async function rest(path){
    const s=session(),c=cfg();if(!s?.token)throw Error("Sign in required.");
    const r=await fetch(`${c.supabaseUrl}/rest/v1/${path}`,{headers:{apikey:c.publishableKey,Authorization:`Bearer ${s.token}`,"Content-Type":"application/json"}});
    const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!r.ok)throw Error(data?.message||data?.hint||`Cloud HTTP ${r.status}`);return data;
  }
  const fmt=v=>v?new Date(v).toLocaleString():"—";
  const n=v=>Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2});

  function install(){
    const jobs=el("collectishJobs");if(!jobs||el("collectishParity"))return false;
    const s=document.createElement("section");s.id="collectishParity";s.className="card collectish-ops-panel";s.dataset.collectishPage="operations";
    s.innerHTML=`<div class="toolbar"><div><h2>Cloud verification</h2><div class="meta">The cloud worker checks for verification jobs automatically about every 10 minutes, then compares the result with the latest matching PC scan.</div></div><button id="refreshParity">Refresh</button></div><div id="parityBody" class="collectish-parity-list"><div class="meta">Loading…</div></div>`;
    jobs.insertAdjacentElement("afterend",s);
    el("refreshParity").onclick=loadParity;
    loadParity();return true;
  }

  async function loadParity(){
    const host=el("parityBody");if(!host)return;host.innerHTML='<div class="meta">Loading cloud verification jobs…</div>';
    try{
      const jobs=await rest('collector_jobs?select=job_id,status,created_at,completed_at,claimed_by,payload_json,progress_json,error_message&source=eq.marketplace&action=eq.scan_set&preferred_executor=eq.verification&order=created_at.desc&limit=10');
      if(!jobs?.length){host.innerHTML='<div class="collectish-empty">No cloud verification jobs yet. Choose <b>Cloud verification</b> in New scan and queue one.</div>';return}
      host.innerHTML=jobs.map(j=>{
        const p=j.payload_json?.profile||{},parity=j.progress_json?.parity||null,ps=j.progress_json?.parityStatus||parity?.status||null;
        const cls=ps?` parity-${String(ps).toLowerCase()}`:"";
        const parityText=ps==="PASS"?`PASS • ${n(parity.skuOverlapPct)}% SKU overlap • ${n(parity.directLowMatchPct)}% Direct Low • ${n(parity.scoreMatchPct)}% scores`:ps==="WARN"?`WARN • ${n(parity.skuOverlapPct)}% SKU overlap • ${n(parity.directLowMatchPct)}% Direct Low • ${n(parity.scoreMatchPct)}% scores`:ps==="NO_BASELINE"?"Waiting for a matching PC baseline scan":"Parity check pending";
        return `<div class="collectish-parity-row${cls}"><div><strong>${p.setName||p.setSlug||"Marketplace scan"}</strong><div class="meta">${p.printing||"Both"} / ${p.condition||"Near Mint"} / ${p.language||"English"} • Top ${Number(p.salesEnrich||0)} • queued ${fmt(j.created_at)}</div></div><div><span class="collectish-job-status s-${j.status}">${j.status}</span><div class="parity-result">${parityText}</div>${parity?.pcScanId?`<div class="meta">PC ${String(parity.pcScanId).slice(0,8)}… ↔ Cloud ${String(parity.cloudScanId||"").slice(0,8)}… • ${n(parity.minutesApart)} min apart</div>`:""}${j.error_message?`<div class="meta">${j.error_message}</div>`:""}</div></div>`;
      }).join("");
    }catch(e){host.innerHTML=`<div class="collectish-empty">${e.message}</div>`}
  }

  document.addEventListener("click",e=>{if(e.target?.dataset?.page==="operations")setTimeout(loadParity,100)},true);
  let tries=0;const t=setInterval(()=>{tries++;setBadge();if(install()||tries>180)clearInterval(t)},100);
  const badge=el("appVersion");if(badge)new MutationObserver(setBadge).observe(badge,{childList:true,characterData:true,subtree:true});
})();

// Chain paired verification v0.5.8.
(() => {
  if(document.querySelector('script[data-collectish-v058]'))return;
  const s=document.createElement('script');s.src='v058.js?v=058';s.dataset.collectishV058='1';document.body.appendChild(s);
})();
