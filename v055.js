// Collectish web v0.5.5 — unified navigation bridge + scan queue access
(() => {
  const VERSION="0.5.5", el=id=>document.getElementById(id);
  const setBadge=()=>{const b=el("appVersion");if(b)b.textContent=`web v${VERSION}`};
  setBadge();

  const map={scout:"scout",cards:"cards",operations:"more"};

  function setUnifiedPage(page){
    const nav=el("collectishProductNav"), legacy=el("mobileProductShell");
    if(!nav)return false;

    localStorage.setItem("collectishPage",page);
    nav.querySelectorAll("button[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===page));

    // Unified cloud pages.
    const hosts={sales:el("collectishSalesPage"),direct:el("collectishDirectPage"),money:el("collectishMoneyPage")};
    Object.entries(hosts).forEach(([k,h])=>h?.classList.toggle("active",k===page));

    const legacyPage=map[page]||null;
    if(legacy){
      legacy.hidden=!legacyPage;
      legacy.style.display=legacyPage?"block":"none";
      legacy.querySelectorAll(".mobile-product-page").forEach(p=>p.classList.toggle("active",p.dataset.mobilePage===legacyPage));
      // The unified nav replaces this older four-tab nav.
      legacy.querySelectorAll(".mobile-product-nav").forEach(n=>n.style.display="none");
    }

    // v0.5.4 added these outside the legacy shell. They belong to Operations.
    for(const id of ["collectishCloudHealth","collectishJobs"]){
      const s=el(id);if(s)s.style.display=page==="operations"?"block":"none";
    }

    // Any remaining top-level section explicitly classified by v0.5.0/v0.5.4.
    document.querySelectorAll("#app > section[data-collectish-page]").forEach(s=>{
      if(["collectishCloudHealth","collectishJobs"].includes(s.id))return;
      s.style.display=s.dataset.collectishPage===page?"block":"none";
    });

    if(page==="operations"){
      // Bring the New scan card to the top of the legacy Operations page so a test job is obvious.
      const more=legacy?.querySelector('.mobile-product-page[data-mobile-page="more"]');
      const scan=[...(more?.querySelectorAll("section.card")||[])].find(s=>(s.querySelector("h2")?.textContent||"").trim()==="New scan");
      const head=more?.querySelector(".mobile-page-head");
      if(scan&&head)head.insertAdjacentElement("afterend",scan);
      setTimeout(()=>{window.loadSetCatalog?.(false)},50);
    }

    if(page==="sales"||page==="direct"||page==="money"){
      // v0.5.0 owns cloud page loading; invoke by clicking its own handler if available through refresh fallback.
      const h=hosts[page];
      if(h&&!h.querySelector("tbody tr") && h.querySelector(".collectish-refresh"))h.querySelector(".collectish-refresh").click();
    }

    window.scrollTo({top:0,behavior:"auto"});
    return true;
  }

  function install(){
    const nav=el("collectishProductNav"),legacy=el("mobileProductShell");
    if(!nav||!legacy)return false;
    if(nav.dataset.v055)return true;
    nav.dataset.v055="1";

    // Capture first so older v0.5.0 handlers cannot leave Scout/Cards/Operations blank.
    nav.addEventListener("click",e=>{
      const b=e.target.closest("button[data-page]");if(!b)return;
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
      setUnifiedPage(b.dataset.page);
    },true);

    // Make Operations explicitly useful for the first generalized collector_jobs test.
    const more=legacy.querySelector('.mobile-product-page[data-mobile-page="more"]');
    if(more&&!el("collectishQueueHint")){
      const hint=document.createElement("div");hint.id="collectishQueueHint";hint.className="collectish-queue-hint";
      hint.innerHTML='<strong>Queue a test Marketplace job</strong><span>Choose a set below, keep Sales enrichment small, then tap <b>Queue new scan</b>. PC v0.15.3 should claim it from Collectish Cloud.</span>';
      more.querySelector(".mobile-page-head")?.insertAdjacentElement("afterend",hint);
    }

    setUnifiedPage(localStorage.getItem("collectishPage")||"scout");
    return true;
  }

  let tries=0;const t=setInterval(()=>{tries++;setBadge();if(install()||tries>160)clearInterval(t)},100);
})();
