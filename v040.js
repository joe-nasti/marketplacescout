// Collectish Marketplace Scout web v0.4.0 — mobile product shell
(() => {
  const el=id=>document.getElementById(id);
  const badge=el("appVersion"); if(badge) badge.textContent="web v0.4.0";
  const KEY="collectishMobileProductPageV1";

  function sectionTitle(s){return (s.querySelector("h2")?.textContent||"").trim().toLowerCase()}
  function classify(s){
    const t=sectionTitle(s),id=s.id||"";
    if(id==="stats"||t.includes("opportunity leaderboard")) return "scout";
    if(t.includes("find any scanned card")) return "cards";
    if(t.includes("mobile analytics")) return "trends";
    if(t.includes("pc status")||t.includes("new scan")||t.includes("scan profiles")||t.includes("pc scan queue")||t.includes("requests")||t.includes("latest scans")||t.includes("data sources")) return "operations";
    return "operations";
  }

  function buildShell(){
    const app=el("app"); if(!app||el("mobileProductShell"))return;
    const original=[...app.children].filter(x=>x.tagName==="SECTION"||x.id==="stats");

    const shell=document.createElement("div");shell.id="mobileProductShell";shell.className="mobile-product-shell";
    const nav=document.createElement("nav");nav.className="mobile-product-nav";
    nav.innerHTML=`<button data-mobile-page="scout">Scout</button><button data-mobile-page="cards">Cards</button><button data-mobile-page="trends">Trends</button><button data-mobile-page="more">More</button>`;
    const body=document.createElement("div");body.className="mobile-product-body";
    const pages={};
    for(const [id,title,desc] of [
      ["scout","Scout","Actionable opportunities and current signals."],
      ["cards","Cards","Search and investigate exact Marketplace SKUs."],
      ["trends","Trends","Supply, price, listings, movers, and signal history."],
      ["more","More","Operations and administrative controls."]
    ]){
      const p=document.createElement("div");p.className="mobile-product-page";p.dataset.mobilePage=id;
      p.innerHTML=`<div class="mobile-page-head"><h2>${title}</h2><div class="meta">${desc}</div></div>`;
      body.appendChild(p);pages[id]=p;
    }
    const ops=document.createElement("div");ops.id="mobileOperationsGroup";ops.innerHTML='<div class="mobile-admin-heading"><b>Operations</b><span>admin</span></div>';
    const settings=document.createElement("section");settings.className="card";settings.id="mobileSettingsCard";settings.innerHTML=`<h2>Settings</h2><div class="meta">Account, data-source, and profile configuration stays separated from Scout output. Additional settings will move here as the app becomes server-backed.</div><button id="mobileSignOutMirror" type="button">Sign out</button>`;
    pages.more.appendChild(ops);pages.more.appendChild(settings);

    for(const s of original){
      const bucket=classify(s);
      if(bucket==="operations")ops.appendChild(s);else pages[bucket].appendChild(s);
    }

    const hero=document.createElement("div");hero.id="mobileScoutSummary";hero.className="mobile-scout-summary";
    pages.scout.querySelector(".mobile-page-head").after(hero);
    const fresh=document.createElement("div");fresh.id="mobileFreshness";fresh.className="mobile-freshness";hero.after(fresh);

    app.prepend(shell);shell.append(nav,body);
    nav.querySelectorAll("button").forEach(b=>b.onclick=()=>showPage(b.dataset.mobilePage));
    el("mobileSignOutMirror")?.addEventListener("click",()=>el("signOut")?.click());
    showPage(localStorage.getItem(KEY)||"scout");
    updateSummary();
  }

  function showPage(id){
    if(!["scout","cards","trends","more"].includes(id))id="scout";
    document.querySelectorAll(".mobile-product-page").forEach(p=>p.classList.toggle("active",p.dataset.mobilePage===id));
    document.querySelectorAll(".mobile-product-nav button").forEach(b=>b.classList.toggle("active",b.dataset.mobilePage===id));
    localStorage.setItem(KEY,id);window.scrollTo({top:0,behavior:"instant"});
  }

  function updateSummary(){
    const hero=el("mobileScoutSummary"),fresh=el("mobileFreshness");
    if(hero){
      const cards=el("signalCards");
      let hot=0,watch=0;
      if(cards){
        const txt=cards.textContent||"";
        const hm=txt.match(/HOT\s*(\d+)/i),wm=txt.match(/WATCH\s*(\d+)/i);hot=Number(hm?.[1]||0);watch=Number(wm?.[1]||0);
      }
      const latest=(typeof scansCache!=="undefined"&&Array.isArray(scansCache))?[...scansCache].sort((a,b)=>new Date(b.captured_at)-new Date(a.captured_at))[0]:null;
      if(latest){hot=Number(latest.hot_count||hot);watch=Number(latest.watch_count||watch)}
      hero.innerHTML=`<div><span>HOT</span><strong>${hot}</strong></div><div><span>WATCH</span><strong>${watch}</strong></div><div><span>Latest set</span><strong class="small">${latest?.set_name||"—"}</strong></div>`;
    }
    if(fresh){
      const latest=(typeof scansCache!=="undefined"&&Array.isArray(scansCache))?[...scansCache].sort((a,b)=>new Date(b.captured_at)-new Date(a.captured_at))[0]:null;
      fresh.innerHTML=`<span>Marketplace ${latest?.captured_at?new Date(latest.captured_at).toLocaleString():"not loaded"}</span><span>EDHREC currently PC-local</span>`;
    }
  }

  const observer=new MutationObserver(()=>updateSummary());
  function init(){buildShell();const app=el("app");if(app)observer.observe(app,{subtree:true,childList:true,characterData:true});setTimeout(updateSummary,1000)}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
