// Collectish Marketplace Scout web v0.4.4 — visual graded leaderboard + Scryfall metadata
(() => {
  const el=id=>document.getElementById(id);
  const badge=el("appVersion"); if(badge) badge.textContent="web v0.4.4";
  const META_KEY="collectishScryfallMetadataV1", SET_KEY="collectishScryfallSetsV1", META_AGE=30*86400000, SET_AGE=7*86400000;
  let lastBoard=[];
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const esc=s=>String(s??"").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;","'":"&#39;"}[c]));
  const signed=(v,d=0,prefix="")=>{const n=Number(v);return Number.isFinite(n)?`${n>0?"+":""}${prefix}${n.toFixed(d)}`:"—"};
  const money=v=>v==null?"—":`$${Number(v).toFixed(2)}`;
  const grade=n=>n>=90?"S":n>=80?"A":n>=70?"B":n>=60?"C":n>=50?"D":"F";
  const pageUrl=r=>`https://www.tcgplayer.com/product/${encodeURIComponent(r.product_id)}?Language=${encodeURIComponent(r.language||"English")}&Printing=${encodeURIComponent(r.printing||"Normal")}&Condition=${encodeURIComponent(r.condition||"Near Mint")}&direct=true`;
  function read(key){try{return JSON.parse(localStorage.getItem(key)||"null")}catch{return null}}
  function write(key,v){try{localStorage.setItem(key,JSON.stringify(v))}catch{}}
  function metaKey(r){return `${String(r.product_name||"").toLowerCase()}|${String(r.set_name||"").toLowerCase()}`}
  function cachedMeta(r){const x=read(META_KEY)?.items?.[metaKey(r)];return x&&Date.now()-x.savedAt<META_AGE?x:null}
  function bestImage(card){return card?.image_uris?.normal||card?.image_uris?.small||card?.card_faces?.find(f=>f.image_uris)?.image_uris?.normal||null}
  async function scryfallSetMap(){
    const cached=read(SET_KEY);if(cached?.items&&Date.now()-cached.savedAt<SET_AGE)return cached.items;
    try{
      const r=await fetch("https://api.scryfall.com/sets",{headers:{"Accept":"application/json;q=0.9,*/*;q=0.8"}});if(!r.ok)throw Error(`HTTP ${r.status}`);
      const d=await r.json(),items={};for(const s of d.data||[])items[String(s.name||"").toLowerCase()]={code:s.code,name:s.name};
      write(SET_KEY,{savedAt:Date.now(),items});return items;
    }catch(e){console.warn("Scryfall set map",e);return cached?.items||{}}
  }
  async function resolveMeta(rows){
    const store=read(META_KEY)||{items:{}},sets=await scryfallSetMap();let changed=false;
    const missing=[];
    for(const r of rows.slice(0,75)){
      const k=metaKey(r),c=store.items[k];if(c&&Date.now()-c.savedAt<META_AGE)continue;missing.push(r);
    }
    for(const r of missing){
      const k=metaKey(r),setCode=sets[String(r.set_name||"").toLowerCase()]?.code;
      try{
        const q=new URLSearchParams({exact:r.product_name});if(setCode)q.set("set",setCode);
        let resp=await fetch(`https://api.scryfall.com/cards/named?${q}`,{headers:{"Accept":"application/json;q=0.9,*/*;q=0.8"}});
        if(!resp.ok&&setCode)resp=await fetch(`https://api.scryfall.com/cards/named?${new URLSearchParams({exact:r.product_name})}`,{headers:{"Accept":"application/json;q=0.9,*/*;q=0.8"}});
        if(resp.ok){const c=await resp.json();store.items[k]={savedAt:Date.now(),collectorNumber:c.collector_number||null,setCode:c.set||setCode||null,scryfallId:c.id||null,image:bestImage(c),scryfallUri:c.scryfall_uri||null};changed=true}
      }catch(e){console.warn("Scryfall card lookup",r.product_name,e)}
      await sleep(120);
    }
    if(changed)write(META_KEY,store);
    return store.items;
  }
  function collector(x){return x.l.collector_number||cachedMeta(x.l)?.collectorNumber||"—"}
  function image(x){return cachedMeta(x.l)?.image||""}
  function strongest(x){
    const parts=[
      [x.score*.4,`Scout score ${Math.round(x.score)}`],
      [x.persist*20,`${Math.round(x.persist*100)}% HOT/WATCH persistence`],
      [x.dep*.2,x.qd<0?`${Math.abs(x.qd)} fewer Direct copies`:"Supply scarcity"],
      [x.pr*.1,x.pd>0?`Direct Low ${signed(x.pd,2,"$")}`:"Price strength"],
      [x.ri*.1,x.rd<0?`Sales rank improved ${Math.abs(x.rd)}`:"Sales-rank strength"]
    ];return parts.sort((a,b)=>b[0]-a[0])[0][1];
  }
  function openCard(x){
    const input=el("globalCardSearch");if(input)input.value=x.l.product_name;
    document.querySelector('[data-mobile-page="cards"]')?.click();
    setTimeout(()=>el("globalCardSearchBtn")?.click(),50);
  }
  function cardTile(x){
    const g=grade(x.comp),img=image(x),cn=collector(x),print=x.l.printing||"Normal";
    return `<button type="button" class="leader-card" data-leader-sku="${esc(x.l.sku_id)}">
      <div class="leader-art">${img?`<img src="${esc(img)}" loading="lazy" alt="${esc(x.l.product_name)}">`:`<div class="leader-art-placeholder">${esc(x.l.product_name)}</div>`}<span class="leader-grade grade-${g}">${g}</span><span class="leader-score">${Math.round(x.comp)}</span></div>
      <div class="leader-card-copy"><b>${esc(x.l.product_name)}</b><div class="leader-card-meta">${esc(x.l.set_name)} • #${esc(cn)}</div><div class="leader-badges"><span>${esc(print)}</span><span>${esc(x.l.condition||"")}</span></div><div class="leader-price">${money(x.l.direct_low)}</div><div class="leader-supply">${Number(x.l.direct_available||0).toLocaleString()} Direct • ${Number(x.l.direct_listings||0).toLocaleString()} listings</div><div class="leader-reason">${esc(strongest(x))}</div></div>
    </button>`;
  }
  function renderVisual(out){
    const host=el("leaderVisual");if(!host)return;
    const groups={S:[],A:[],B:[],C:[],D:[],F:[]};for(const x of out.slice(0,100))groups[grade(x.comp)].push(x);
    host.innerHTML=["S","A","B","C","D","F"].map(g=>{
      if(!groups[g].length)return"";const low=["C","D","F"].includes(g);
      const inner=`<div class="tier-row"><div class="tier-letter grade-${g}">${g}</div><div class="tier-cards">${groups[g].map(cardTile).join("")}</div></div>`;
      return low?`<details class="tier-collapse"><summary>${g} tier • ${groups[g].length} cards</summary>${inner}</details>`:inner;
    }).join("");
    host.querySelectorAll("[data-leader-sku]").forEach(b=>b.onclick=()=>{const x=out.find(v=>String(v.l.sku_id)===b.dataset.leaderSku);if(x)openCard(x)});
  }
  function renderTable(out){
    const tbody=el("leaderBody");if(!tbody)return;
    const head=tbody.closest("table")?.querySelector("thead tr");if(head)head.innerHTML="<th>Card</th><th>Set / variant</th><th>Grade</th><th>Direct qty</th><th>Listings</th><th>Direct Low</th><th>Scout</th><th>Seen</th><th>HOT/WATCH</th><th>Qty Δ</th><th>Price Δ</th>";
    tbody.innerHTML=out.slice(0,100).map(x=>`<tr><td><a class="card-link" target="_blank" href="${pageUrl(x.l)}">${esc(x.l.product_name)}</a><div class="meta">#${esc(collector(x))}</div></td><td>${esc(x.l.set_name)}<div class="meta">${esc(x.l.printing||"Normal")} • ${esc(x.l.condition||"")}</div></td><td><span class="leader-grade-inline grade-${grade(x.comp)}">${grade(x.comp)}</span> ${Math.round(x.comp)}</td><td>${x.l.direct_available??"—"}</td><td>${x.l.direct_listings??"—"}</td><td>${money(x.l.direct_low)}</td><td>${Math.round(x.score)}</td><td>${x.s.length}</td><td>${x.h}/${x.hw}</td><td>${signed(x.qd)}</td><td>${signed(x.pd,2,"$")}</td></tr>`).join("");
  }
  function setMode(mode){localStorage.setItem("collectishLeaderViewV1",mode);el("leaderVisual").hidden=mode!=="visual";const table=el("leaderBody")?.closest(".table-wrap");if(table)table.hidden=mode!=="table";el("leaderViewVisual")?.classList.toggle("active",mode==="visual");el("leaderViewTable")?.classList.toggle("active",mode==="table")}
  function ensureUi(){
    const body=el("leaderBody"),section=body?.closest("section.card");if(!body||!section||el("leaderVisual"))return;
    const h2=section.querySelector("h2");if(h2&&!el("leaderHelp")){const b=document.createElement("button");b.id="leaderHelp";b.type="button";b.className="leader-help";b.textContent="?";b.title="How ranking works";h2.append(" ",b)}
    const controls=section.querySelector(".leaderboard-controls");if(controls){const views=document.createElement("div");views.className="leader-view-toggle";views.innerHTML='<button id="leaderViewVisual" type="button">Cards</button><button id="leaderViewTable" type="button">Table</button>';controls.appendChild(views)}
    const visual=document.createElement("div");visual.id="leaderVisual";visual.className="leader-visual";body.closest(".table-wrap").before(visual);
    const dialog=document.createElement("dialog");dialog.id="leaderHelpDialog";dialog.className="leader-help-dialog";dialog.innerHTML=`<form method="dialog"><button class="dialog-close" aria-label="Close">×</button><h3>Composite opportunity</h3><p>The composite score is a 0–100 cross-scan ranking. It combines the latest Scout score with evidence that the signal is persistent and actually moving.</p><div class="leader-formula"><div><b>40%</b><span>Latest Scout score</span></div><div><b>20%</b><span>HOT/WATCH persistence</span></div><div><b>20%</b><span>Direct inventory depletion</span></div><div><b>10%</b><span>Direct Low increase</span></div><div><b>10%</b><span>Sales-rank improvement</span></div></div><p class="meta">Latest Scout score itself weighs sales velocity (35%), Direct inventory scarcity (25%), Direct listing scarcity (20%), and Direct premium vs SKU market (20%).</p><h4>Grades</h4><p><b>S</b> 90–100 • <b>A</b> 80–89 • <b>B</b> 70–79 • <b>C</b> 60–69 • <b>D</b> 50–59 • <b>F</b> below 50. Grades are presentation bands over the composite score; they do not change the underlying data.</p><h4>What “Normal / Foil” means</h4><p>It identifies the exact Marketplace printing variant. Supply, listings, prices, and score stay separate for Normal and Foil; they are shown as a small badge rather than a standalone column.</p><h4>Card images & collector numbers</h4><p>Scryfall is used as an independent metadata/visual source when Marketplace history is missing a collector number or an image. Metadata URLs are cached locally; images load from Scryfall's static image host and are not copied into Supabase.</p></form>`;document.body.appendChild(dialog);
    el("leaderHelp").onclick=()=>dialog.showModal();el("leaderViewVisual").onclick=()=>setMode("visual");el("leaderViewTable").onclick=()=>setMode("table");setMode(localStorage.getItem("collectishLeaderViewV1")||"visual");
    const ds=el("mobileDataSources");if(ds&&!el("mobileScryfallSource")){const row=document.createElement("div");row.id="mobileScryfallSource";row.className="mobile-source-row";row.innerHTML='<div><b>Scryfall card metadata</b><div class="meta">Independent identity + artwork source for collector numbers and visual cards. Browser-cached metadata; static images remain hosted by Scryfall.</div></div><span class="mobile-source-badge on">Metadata</span>';ds.appendChild(row)}
  }
  window.buildLeaderboard=async function(){
    const days=Number(el("leaderPeriod")?.value||7),printingMode=el("leaderPrinting")?.value||"",condition=el("leaderCondition")?.value||"",minPrice=Number(el("leaderMinPrice")?.value||0),metric=el("leaderMetric")?.value||"composite";
    if(typeof showActivity==="function")showActivity("Building leaderboard","Consolidating exact SKUs…");
    try{
      let path="marketplace_scans?select=scan_id,captured_at,set_name,printing,condition,language&order=captured_at.asc";
      if(days>0)path+=`&captured_at=gte.${encodeURIComponent(new Date(Date.now()-days*86400000).toISOString())}`;
      if(condition)path+=`&condition=eq.${encodeURIComponent(condition)}`;
      const scans=await rest(path),ids=scans.map(s=>s.scan_id);if(!ids.length){el("leaderBody").innerHTML="";el("leaderVisual").innerHTML="";el("leaderStatus").textContent="No scans in this period.";return}
      const rows=await rest(`marketplace_scan_rows?select=scan_id,sku_id,product_id,product_name,collector_number,set_name,printing,condition,language,sales_rank,direct_low,direct_listings,direct_available,opportunity_score,flag&scan_id=in.(${ids.join(",")})`);
      const sm=new Map(scans.map(s=>[s.scan_id,s.captured_at])),bySku=new Map();
      for(const r of rows){r.captured_at=sm.get(r.scan_id);if(!r.captured_at||Number(r.direct_low||0)<minPrice)continue;if(printingMode&&(r.printing||"Normal")!==printingMode)continue;if(!bySku.has(String(r.sku_id)))bySku.set(String(r.sku_id),[]);bySku.get(String(r.sku_id)).push(r)}
      const out=[];
      for(const s of bySku.values()){
        s.sort((a,b)=>new Date(a.captured_at)-new Date(b.captured_at));const f=s[0],l=s.at(-1),hw=s.filter(r=>r.flag==="HOT"||r.flag==="WATCH").length,h=s.filter(r=>r.flag==="HOT").length,persist=hw/s.length,qd=Number(l.direct_available||0)-Number(f.direct_available||0),pd=Number(l.direct_low||0)-Number(f.direct_low||0),rd=Number(l.sales_rank||0)-Number(f.sales_rank||0),score=Number(l.opportunity_score||0),dep=qd<0?Math.min(100,Math.abs(qd)/Math.max(1,Number(f.direct_available||0))*100):0,pr=pd>0?Math.min(100,pd/Math.max(.01,Number(f.direct_low||.01))*100):0,ri=rd<0?Math.min(100,Math.abs(rd)/Math.max(1,Number(f.sales_rank||1))*100):0,comp=score*.4+persist*20+dep*.2+pr*.1+ri*.1;out.push({s,f,l,hw,h,persist,qd,pd,rd,score,dep,pr,ri,comp});
      }
      const val=x=>({composite:x.comp,score:x.score,persistence:x.persist*100,depletion:x.dep,price:x.pr,rank:x.ri})[metric]||0;out.sort((a,b)=>val(b)-val(a));lastBoard=out;
      ensureUi();renderVisual(out);renderTable(out);setMode(localStorage.getItem("collectishLeaderViewV1")||"visual");
      el("leaderStatus").textContent=`${out.length} exact-SKU variants consolidated from ${scans.length} scans • visual grades use composite opportunity.`;
      resolveMeta(out.map(x=>x.l)).then(()=>{if(lastBoard===out){renderVisual(out);renderTable(out)}});
    }catch(e){el("leaderStatus").textContent=`Leaderboard failed: ${e.message}`}
    finally{if(typeof hideActivity==="function")hideActivity()}
  };
  function init(){ensureUi();const badge=el("appVersion");if(badge)badge.textContent="web v0.4.4";setTimeout(()=>{if(session?.())window.buildLeaderboard?.()},1200)}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
