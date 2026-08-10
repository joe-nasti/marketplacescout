// Collectish Marketplace Scout web v0.3.7 — reusable templates + smart scan depth
(() => {
  const el=id=>document.getElementById(id);
  const KEY="collectishMobileProfileTemplatesV1";
  const DEFAULT={id:"default-both-nm-en-100",name:"Smart / Both / NM / English / Top 100",printing:"Both",condition:"Near Mint",language:"English",salesEnrich:100,scanDepth:"Smart"};
  const badge=el("appVersion"); if(badge) badge.textContent="web v0.3.7";

  // Insert Scan depth into New Scan without requiring another HTML migration.
  if(!el("newScanDepth")&&el("newPrinting")){
    const label=document.createElement("label");
    label.innerHTML='Scan depth<select id="newScanDepth"><option value="Smart" selected>Smart — full weekly, top 500 between</option><option value="250">Top 250</option><option value="500">Top 500</option><option value="1000">Top 1,000</option><option value="Full">Full set</option></select>';
    const printingLabel=el("newPrinting").closest("label");
    printingLabel?.parentNode?.insertBefore(label,printingLabel.nextSibling);
  }

  function loadTemplates(){
    try{
      const x=JSON.parse(localStorage.getItem(KEY)||"null");
      if(!Array.isArray(x)||!x.length)return [DEFAULT];
      return x.map(t=>({...t,scanDepth:t.scanDepth||"Smart"}));
    }catch{return [DEFAULT]}
  }
  function saveTemplates(x){localStorage.setItem(KEY,JSON.stringify(x))}
  function renderTemplates(selected=""){
    const sel=el("mobileProfileTemplate"); if(!sel)return;
    const t=loadTemplates();
    sel.innerHTML='<option value="">Custom</option>'+t.map(x=>`<option value="${x.id}">${x.name}</option>`).join("");
    if(selected&&t.some(x=>x.id===selected))sel.value=selected;
  }
  function applyTemplate(t){
    if(!t)return;
    el("newPrinting").value=t.printing||"Both";
    el("newCondition").value=t.condition||"Near Mint";
    el("newLanguage").value=t.language||"English";
    el("newEnrich").value=String(t.salesEnrich??100);
    if(el("newScanDepth"))el("newScanDepth").value=String(t.scanDepth||"Smart");
  }
  el("mobileProfileTemplate")?.addEventListener("change",()=>{
    const t=loadTemplates().find(x=>x.id===el("mobileProfileTemplate").value);if(t)applyTemplate(t);
  });
  el("mobileSaveTemplate")?.addEventListener("click",()=>{
    const name=prompt("Template name:",`${el("newScanDepth")?.value||"Smart"} / ${el("newPrinting").value} / ${el("newCondition").value} / ${el("newLanguage").value} / Top ${el("newEnrich").value}`);if(!name)return;
    const t=loadTemplates(),id=(crypto.randomUUID?crypto.randomUUID():String(Date.now()));
    t.push({id,name,printing:el("newPrinting").value,condition:el("newCondition").value,language:el("newLanguage").value,salesEnrich:Number(el("newEnrich").value||0),scanDepth:el("newScanDepth")?.value||"Smart"});
    saveTemplates(t);renderTemplates(id);
  });
  el("mobileDeleteTemplate")?.addEventListener("click",()=>{
    const id=el("mobileProfileTemplate")?.value;if(!id)return;
    saveTemplates(loadTemplates().filter(x=>x.id!==id));renderTemplates("");
  });

  // Override New Scan submission so scanDepth travels through the existing
  // marketplace_scan_commands profile_json. The PC queue honors it identically
  // for phone, manual, and auto-sync work.
  el("queueNew")?.addEventListener("click",async e=>{
    e.preventDefault();e.stopImmediatePropagation();
    const opt=el("newSet")?.selectedOptions?.[0];
    if(!opt?.value){el("newScanMsg").textContent="Select a set.";return}
    const p={
      setSlug:opt.value,setName:opt.dataset.name||opt.textContent,
      printing:el("newPrinting").value,condition:el("newCondition").value,
      language:el("newLanguage").value,salesEnrich:Number(el("newEnrich").value||0),
      scanDepth:el("newScanDepth")?.value||"Smart"
    };
    try{
      showActivity("Queueing scan",`${p.setName} • ${p.scanDepth} depth • sending request to cloud…`);
      el("newScanMsg").textContent="Sending request…";
      const s=await valid();
      await rest("marketplace_scan_commands",{method:"POST",body:[{user_id:s.user.id,profile_json:p,status:"pending"}],prefer:"return=minimal"});
      el("newScanMsg").textContent=`Queued ${p.setName} • ${p.scanDepth}. Waiting for PC.`;
      showActivity("Scan queued",`${p.setName} • ${p.scanDepth} • waiting for PC`);
      setTimeout(hideActivity,1800);
      load();
    }catch(err){hideActivity();el("newScanMsg").textContent=err.message}
  },true);

  // Keep aggregate analytics coverage-compatible. A Smart Top-500 refresh must
  // never look like an inventory collapse versus a prior Full scan. The existing
  // exact-printing analytics implementation remains responsible for Normal/Foil
  // separation; this wrapper only removes incompatible coverage cohorts.
  const priorAnalytics=window.analytics;
  const coverageKey=s=>{
    const p=s?.profile_json||{};
    return p.coverageFull===false?`top-${Number(p.coverageLimit||p.scannedSearchPositions||500)}`:"full";
  };
  if(typeof priorAnalytics==="function"){
    window.analytics=async function(){
      const key=el("analyticsProfile")?.value;
      if(!key||typeof scansCache==="undefined")return priorAnalytics();
      const [slug,mode,condition,language]=key.split("|");
      const relevant=scansCache.filter(s=>s.set_slug===slug&&s.condition===condition&&s.language===language&&(s.printing===mode||s.printing==="Both"||mode==="Both"));
      if(!relevant.length)return priorAnalytics();
      const latest=[...relevant].sort((a,b)=>new Date(a.captured_at)-new Date(b.captured_at)).at(-1);
      const cohort=coverageKey(latest),original=scansCache;
      scansCache=original.filter(s=>{
        const same=s.set_slug===slug&&s.condition===condition&&s.language===language&&(s.printing===mode||s.printing==="Both"||mode==="Both");
        return !same||coverageKey(s)===cohort;
      });
      try{return await priorAnalytics()}finally{scansCache=original}
    };
  }

  renderTemplates("default-both-nm-en-100");
  applyTemplate(DEFAULT);
})();
