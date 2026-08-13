// Collectish web v0.5.5 — unified navigation bridge + scan queue access
// Startup compatibility guard: newer overlays used MutationObservers that rewrote
// #appVersion from inside the observer callback. That can create an infinite
// microtask loop and starve the rest of page startup. Ignore observers on the
// version badge, while preserving MutationObserver everywhere else.
(() => {
  if(window.__collectishVersionObserverGuard)return;
  window.__collectishVersionObserverGuard=true;
  const NativeMutationObserver=window.MutationObserver;
  window.MutationObserver=class CollectishMutationObserver extends NativeMutationObserver{
    observe(target,options){
      if(target?.id==="appVersion")return;
      return super.observe(target,options);
    }
  };
  // The current index loads these files explicitly. Add markers so legacy
  // chain-loaders do not inject duplicate copies with older cache keys.
  for(const version of ["056","057","058","059","060","061"]){
    if(document.querySelector(`script[data-collectish-v${version}]`))continue;
    const marker=document.createElement("script");
    marker.type="application/json";
    marker.dataset[`collectishV${version}`]="1";
    marker.textContent="{}";
    document.head.appendChild(marker);
  }
})();

(() => {
  const VERSION="0.5.5", el=id=>document.getElementById(id);
  // Historical overlays no longer own the visible application version.
  const setBadge=()=>{};
  if(!document.querySelector('link[data-collectish-v055]')){const l=document.createElement('link');l.rel='stylesheet';l.href='v055.css?v=055';l.dataset.collectishV055='1';document.head.appendChild(l)}

  const map={scout:"scout",cards:"cards",operations:"more"};

  function setUnifiedPage(page){
    const nav=el("collectishProductNav"), legacy=el("mobileProductShell");
    if(!nav)return false;

    localStorage.setItem("collectishPage",page);
    nav.querySelectorAll("button[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===page));

    const hosts={sales:el("collectishSalesPage"),direct:el("collectishDirectPage"),money:el("collectishMoneyPage")};
    Object.entries(hosts).forEach(([k,h])=>h?.classList.toggle("active",k===page));

    const legacyPage=map[page]||null;
    if(legacy){
      legacy.hidden=!legacyPage;
      legacy.style.display=legacyPage?"block":"none";
      legacy.querySelectorAll(".mobile-product-page").forEach(p=>p.classList.toggle("active",p.dataset.mobilePage===legacyPage));
      legacy.querySelectorAll(".mobile-product-nav").forEach(n=>n.style.display="none");
    }

    for(const id of ["collectishCloudHealth","collectishJobs"]){
      const s=el(id);if(s)s.style.display=page==="operations"?"block":"none";
    }

    document.querySelectorAll("#app > section[data-collectish-page]").forEach(s=>{
      if(["collectishCloudHealth","collectishJobs"].includes(s.id))return;
      s.style.display=s.dataset.collectishPage===page?"block":"none";
    });

    if(page==="operations"){
      const more=legacy?.querySelector('.mobile-product-page[data-mobile-page="more"]');
      const scan=[...(more?.querySelectorAll("section.card")||[])].find(s=>(s.querySelector("h2")?.textContent||"").trim()==="New scan");
      const head=more?.querySelector(".mobile-page-head");
      if(scan&&head)head.insertAdjacentElement("afterend",scan);
      setTimeout(()=>{window.loadSetCatalog?.(false)},50);
    }

    if(page==="sales"||page==="direct"||page==="money"){
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

    nav.addEventListener("click",e=>{
      const b=e.target.closest("button[data-page]");if(!b)return;
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
      setUnifiedPage(b.dataset.page);
    },true);

    const more=legacy.querySelector('.mobile-product-page[data-mobile-page="more"]');
    if(more&&!el("collectishQueueHint")){
      const hint=document.createElement("div");hint.id="collectishQueueHint";hint.className="collectish-queue-hint";
      hint.innerHTML='<strong>Queue a test Marketplace job</strong><span>Choose a set below, set Sales enrichment to <b>None</b> or <b>Top 10</b>, then tap <b>Queue new scan</b>. PC v0.15.3 should claim it from Collectish Cloud.</span>';
      more.querySelector(".mobile-page-head")?.insertAdjacentElement("afterend",hint);
    }

    setUnifiedPage(localStorage.getItem("collectishPage")||"scout");
    return true;
  }

  let tries=0;const t=setInterval(()=>{tries++;setBadge();if(install()||tries>160)clearInterval(t)},100);
})();
