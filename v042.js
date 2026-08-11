// Collectish Marketplace Scout web v0.4.2 — auth-safe product shell
(() => {
  const el=id=>document.getElementById(id);
  const badge=el("appVersion"); if(badge) badge.textContent="web v0.4.2";
  const KEY="collectishMobileProductPageV1";
  let summaryTimer=null, shellStarted=false, loginBusy=false;

  // Defensive sign-in path. The legacy app normally owns this button, but this
  // capture handler makes auth independent of enhancement-script initialization.
  async function safeLogin(){
    if(loginBusy)return;
    const email=el("email")?.value?.trim(), password=el("password")?.value||"", msg=el("msg");
    if(!email||!password){if(msg)msg.textContent="Enter email and password.";return}
    const c=window.COLLECTISH_CONFIG;
    if(!c?.supabaseUrl||!c?.publishableKey){if(msg)msg.textContent="App configuration is unavailable.";return}
    loginBusy=true;
    const btn=el("signIn"); if(btn){btn.disabled=true;btn.textContent="Signing in…"}
    try{
      const r=await fetch(`${c.supabaseUrl}/auth/v1/token?grant_type=password`,{
        method:"POST",
        headers:{"apikey":c.publishableKey,"Authorization":`Bearer ${c.publishableKey}`,"Content-Type":"application/json"},
        body:JSON.stringify({email,password})
      });
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.message||`Sign in failed (${r.status})`);
      localStorage.setItem("collectishSession",JSON.stringify({token:d.access_token,refresh:d.refresh_token,exp:Date.now()+Number(d.expires_in||3600)*1000,user:d.user}));
      if(el("password"))el("password").value="";
      if(typeof window.boot==="function")await window.boot();
      else location.reload();
    }catch(e){if(msg)msg.textContent=e.message||String(e)}
    finally{loginBusy=false;if(btn){btn.disabled=false;btn.textContent="Sign in"}}
  }
  const signIn=el("signIn");
  if(signIn)signIn.addEventListener("click",e=>{e.preventDefault();e.stopImmediatePropagation();safeLogin()},true);
  el("password")?.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();safeLogin()}});

  function title(s){return (s.querySelector("h2")?.textContent||"").trim().toLowerCase()}
  function classify(s){
    const t=title(s),id=s.id||"";
    if(id==="stats"||t.includes("opportunity leaderboard"))return"scout";
    if(t.includes("find any scanned card"))return"cards";
    if(t.includes("mobile analytics"))return"trends";
    return"operations";
  }
  function showPage(id){
    if(!["scout","cards","trends","more"].includes(id))id="scout";
    document.querySelectorAll(".mobile-product-page").forEach(p=>p.classList.toggle("active",p.dataset.mobilePage===id));
    document.querySelectorAll(".mobile-product-nav button").forEach(b=>b.classList.toggle("active",b.dataset.mobilePage===id));
    localStorage.setItem(KEY,id);window.scrollTo({top:0,behavior:"auto"});
  }
  function updateSummary(){
    const hero=el("mobileScoutSummary"),fresh=el("mobileFreshness");if(!hero&&!fresh)return;
    const scans=(typeof scansCache!=="undefined"&&Array.isArray(scansCache))?scansCache:[];
    const latest=scans.length?[...scans].sort((a,b)=>new Date(b.captured_at)-new Date(a.captured_at))[0]:null;
    if(hero){
      let hot=Number(latest?.hot_count||0),watch=Number(latest?.watch_count||0);
      const next=`<div><span>HOT</span><strong>${hot}</strong></div><div><span>WATCH</span><strong>${watch}</strong></div><div><span>Latest set</span><strong class="small">${latest?.set_name||"—"}</strong></div>`;
      if(hero.innerHTML!==next)hero.innerHTML=next;
    }
    if(fresh){const next=`<span>Marketplace ${latest?.captured_at?new Date(latest.captured_at).toLocaleString():"not loaded"}</span><span>EDHREC currently PC-local</span>`;if(fresh.innerHTML!==next)fresh.innerHTML=next}
  }
  function buildShell(){
    if(shellStarted)return;
    const app=el("app");if(!app||app.hidden)return;
    shellStarted=true;
    const original=[...app.children].filter(x=>x.tagName==="SECTION"||x.id==="stats");
    const shell=document.createElement("div");shell.id="mobileProductShell";shell.className="mobile-product-shell";
    const nav=document.createElement("nav");nav.className="mobile-product-nav";nav.innerHTML='<button data-mobile-page="scout">Scout</button><button data-mobile-page="cards">Cards</button><button data-mobile-page="trends">Trends</button><button data-mobile-page="more">More</button>';
    const body=document.createElement("div");body.className="mobile-product-body";const pages={};
    for(const [id,name,desc] of [["scout","Scout","Actionable opportunities and current signals."],["cards","Cards","Search and investigate exact Marketplace SKUs."],["trends","Trends","Supply, price, listings, movers, and signal history."],["more","More","Operations and administrative controls."]]){const p=document.createElement("div");p.className="mobile-product-page";p.dataset.mobilePage=id;p.innerHTML=`<div class="mobile-page-head"><h2>${name}</h2><div class="meta">${desc}</div></div>`;body.appendChild(p);pages[id]=p}
    const ops=document.createElement("div");ops.id="mobileOperationsGroup";ops.innerHTML='<div class="mobile-admin-heading"><b>Operations</b><span>admin</span></div>';
    const settings=document.createElement("section");settings.className="card";settings.id="mobileSettingsCard";settings.innerHTML='<h2>Settings</h2><div class="meta">Account, source, profile, and deployment controls stay separate from Scout output.</div><button id="mobileSignOutMirror" type="button">Sign out</button>';
    pages.more.append(ops,settings);
    for(const s of original){const bucket=classify(s);if(bucket==="operations")ops.appendChild(s);else pages[bucket].appendChild(s)}
    const hero=document.createElement("div");hero.id="mobileScoutSummary";hero.className="mobile-scout-summary";pages.scout.querySelector(".mobile-page-head").after(hero);
    const fresh=document.createElement("div");fresh.id="mobileFreshness";fresh.className="mobile-freshness";hero.after(fresh);
    shell.append(nav,body);app.prepend(shell);nav.querySelectorAll("button").forEach(b=>b.onclick=()=>showPage(b.dataset.mobilePage));el("mobileSignOutMirror")?.addEventListener("click",()=>el("signOut")?.click());
    showPage(localStorage.getItem(KEY)||"scout");updateSummary();summaryTimer=setInterval(()=>{if(!document.hidden)updateSummary()},5000);
  }
  // Do not touch/reparent the app until the legacy auth flow has actually shown it.
  const waitForAuth=setInterval(()=>{const app=el("app");if(app&&!app.hidden){clearInterval(waitForAuth);buildShell()}},250);
})();

// Load the visual leaderboard as an independent presentation/metadata layer.
(() => {
  if(!document.querySelector('link[data-collectish-v044]')){
    const l=document.createElement("link");l.rel="stylesheet";l.href="v044.css?v=044";l.dataset.collectishV044="1";document.head.appendChild(l);
  }
  if(document.querySelector('script[data-collectish-v044]'))return;
  const s=document.createElement("script");s.src="v044.js?v=044";s.dataset.collectishV044="1";
  s.onload=()=>{
    if(document.querySelector('script[data-collectish-v045]'))return;
    const f=document.createElement("script");f.src="v045.js?v=045";f.dataset.collectishV045="1";document.head.appendChild(f);
  };
  document.head.appendChild(s);
})();
