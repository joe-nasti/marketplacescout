// Collectish Marketplace Scout web v0.4.6 — leaderboard detail sheet + power filters
(() => {
  const el=id=>document.getElementById(id);
  const badge=el("appVersion");if(badge)badge.textContent="web v0.4.6";
  let breakdownCache={key:null,map:new Map()};

  const esc=s=>String(s??"").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;","'":"&#39;"}[c]));
  const signed=(v,d=0,prefix="")=>{const n=Number(v);return Number.isFinite(n)?`${n>0?"+":""}${prefix}${n.toFixed(d)}`:"—"};
  const money=v=>v==null?"—":`$${Number(v).toFixed(2)}`;
  const grade=n=>n>=90?"S":n>=80?"A":n>=70?"B":n>=60?"C":n>=50?"D":"F";

  function ensureAdvanced(){
    const metric=el("leaderMetric");if(!metric||el("leaderAdvanced"))return;
    const metricLabel=metric.closest("label");
    const controls=metric.closest(".leaderboard-controls");
    if(!metricLabel||!controls)return;

    const adv=document.createElement("details");adv.id="leaderAdvanced";adv.className="leader-advanced";
    adv.innerHTML='<summary>Power filters & ranking</summary><div class="leader-advanced-body"><div class="meta">Composite is the everyday default. Power users can rank by one component to isolate a specific type of opportunity.</div></div>';
    adv.querySelector(".leader-advanced-body").appendChild(metricLabel);
    controls.appendChild(adv);

    const labels={composite:"Composite opportunity",score:"Latest Scout score",persistence:"HOT/WATCH persistence",depletion:"Direct inventory depletion",price:"Direct Low increase",rank:"Sales-rank improvement"};
    metric.addEventListener("change",()=>{
      const s=adv.querySelector("summary");if(s)s.textContent=`Power filters & ranking • ${labels[metric.value]||metric.value}`;
    });
  }

  function ensureDialog(){
    if(el("leaderBreakdownDialog"))return el("leaderBreakdownDialog");
    const d=document.createElement("dialog");d.id="leaderBreakdownDialog";d.className="leader-breakdown-dialog";
    d.innerHTML='<div id="leaderBreakdownContent"></div>';
    document.body.appendChild(d);
    d.addEventListener("click",e=>{if(e.target===d)d.close()});
    return d;
  }

  function filterKey(){return [el("leaderPeriod")?.value,el("leaderPrinting")?.value,el("leaderCondition")?.value,el("leaderMinPrice")?.value].join("|")}

  async function loadBreakdowns(){
    const key=filterKey();if(breakdownCache.key===key&&breakdownCache.map.size)return breakdownCache.map;
    const days=Number(el("leaderPeriod")?.value||7),printingMode=el("leaderPrinting")?.value||"",condition=el("leaderCondition")?.value||"",minPrice=Number(el("leaderMinPrice")?.value||0);
    let path="marketplace_scans?select=scan_id,captured_at,set_name,printing,condition,language&order=captured_at.asc";
    if(days>0)path+=`&captured_at=gte.${encodeURIComponent(new Date(Date.now()-days*86400000).toISOString())}`;
    if(condition)path+=`&condition=eq.${encodeURIComponent(condition)}`;
    const scans=await rest(path),ids=scans.map(s=>s.scan_id);if(!ids.length)return new Map();
    const rows=await rest(`marketplace_scan_rows?select=scan_id,sku_id,product_id,product_name,collector_number,set_name,printing,condition,language,sales_rank,direct_low,direct_listings,direct_available,opportunity_score,flag&scan_id=in.(${ids.join(",")})`);
    const sm=new Map(scans.map(s=>[s.scan_id,s.captured_at])),bySku=new Map();
    for(const r of rows){r.captured_at=sm.get(r.scan_id);if(!r.captured_at||Number(r.direct_low||0)<minPrice)continue;if(printingMode&&(r.printing||"Normal")!==printingMode)continue;const k=String(r.sku_id);if(!bySku.has(k))bySku.set(k,[]);bySku.get(k).push(r)}
    const map=new Map();
    for(const s of bySku.values()){
      s.sort((a,b)=>new Date(a.captured_at)-new Date(b.captured_at));const f=s[0],l=s.at(-1),hw=s.filter(r=>r.flag==="HOT"||r.flag==="WATCH").length,h=s.filter(r=>r.flag==="HOT").length,persist=hw/s.length,qd=Number(l.direct_available||0)-Number(f.direct_available||0),pd=Number(l.direct_low||0)-Number(f.direct_low||0),rd=Number(l.sales_rank||0)-Number(f.sales_rank||0),score=Number(l.opportunity_score||0),dep=qd<0?Math.min(100,Math.abs(qd)/Math.max(1,Number(f.direct_available||0))*100):0,pr=pd>0?Math.min(100,pd/Math.max(.01,Number(f.direct_low||.01))*100):0,ri=rd<0?Math.min(100,Math.abs(rd)/Math.max(1,Number(f.sales_rank||1))*100):0;
      const parts={scout:score*.4,persistence:persist*20,depletion:dep*.2,price:pr*.1,rank:ri*.1};
      const comp=parts.scout+parts.persistence+parts.depletion+parts.price+parts.rank;
      map.set(String(l.sku_id),{s,f,l,hw,h,persist,qd,pd,rd,score,dep,pr,ri,parts,comp});
    }
    breakdownCache={key,map};return map;
  }

  function bar(label,value,max,raw){
    const pct=Math.max(0,Math.min(100,value/max*100));
    return `<div class="break-row"><div class="break-head"><span>${esc(label)}</span><b>${value.toFixed(1)} / ${max}</b></div><div class="break-track"><i style="width:${pct}%"></i></div><div class="break-raw">${esc(raw)}</div></div>`;
  }

  async function openBreakdown(sku){
    const dialog=ensureDialog(),content=el("leaderBreakdownContent");
    content.innerHTML='<div class="leader-break-loading">Calculating component breakdown…</div>';dialog.showModal();
    try{
      const map=await loadBreakdowns(),x=map.get(String(sku));if(!x)throw Error("Breakdown unavailable for this card.");
      const g=grade(x.comp),obs=x.s.length;
      content.innerHTML=`<button id="leaderBreakClose" class="dialog-close" type="button" aria-label="Close">×</button>
        <div class="break-title"><div><h3>${esc(x.l.product_name)}</h3><div class="meta">${esc(x.l.set_name)} • #${esc(x.l.collector_number||"—")} • ${esc(x.l.printing||"Normal")} • ${esc(x.l.condition||"")}</div></div><div class="break-grade grade-${g}">${g}<small>Composite ${Math.round(x.comp)}</small></div></div>
        <div class="break-summary">${obs<3?'<b>Limited evidence:</b> only '+obs+' compatible observations. Current Scout strength can be high while the cross-scan composite remains modest.':`Composite uses ${obs} compatible observations across the selected period.`}</div>
        <div class="break-components">
          ${bar("Scout score",x.parts.scout,40,`Latest Scout ${Math.round(x.score)} × 40%`)}
          ${bar("HOT/WATCH persistence",x.parts.persistence,20,`${Math.round(x.persist*100)}% of observations were HOT/WATCH`)}
          ${bar("Inventory depletion",x.parts.depletion,20,`${signed(x.qd)} Direct copies vs first observation`)}
          ${bar("Direct Low momentum",x.parts.price,10,`${signed(x.pd,2,"$")} vs first observation`)}
          ${bar("Sales-rank improvement",x.parts.rank,10,`${x.rd<0?Math.abs(x.rd)+" ranks better":x.rd>0?x.rd+" ranks worse":"No rank change"}`)}
        </div>
        <div class="break-total"><span>Composite opportunity</span><strong>${x.comp.toFixed(1)} / 100 • ${g} tier</strong></div>
        <div class="break-actions"><button id="leaderFullHistory" type="button" class="primary">View full card history</button><button id="leaderBreakDismiss" type="button">Close</button></div>`;
      el("leaderBreakClose").onclick=()=>dialog.close();el("leaderBreakDismiss").onclick=()=>dialog.close();
      el("leaderFullHistory").onclick=()=>{dialog.close();const input=el("globalCardSearch");if(input)input.value=x.l.product_name;document.querySelector('[data-mobile-page="cards"]')?.click();setTimeout(()=>el("globalCardSearchBtn")?.click(),50)};
    }catch(e){content.innerHTML=`<button id="leaderBreakClose" class="dialog-close" type="button">×</button><p>${esc(e.message)}</p>`;el("leaderBreakClose").onclick=()=>dialog.close()}
  }

  function wireCards(){
    document.querySelectorAll(".leader-card").forEach(card=>{
      const score=card.querySelector(".leader-score");if(score&&!/^Composite\s/i.test(score.textContent))score.textContent=`Composite ${score.textContent}`;
      const art=card.querySelector(".leader-art");if(art&&!art.dataset.breakdownWired){art.dataset.breakdownWired="1";art.style.cursor="pointer";art.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();openBreakdown(card.dataset.leaderSku)},true)}
    });
  }

  const prior=window.buildLeaderboard;
  if(typeof prior==="function"){
    window.buildLeaderboard=async function(...args){const r=await prior.apply(this,args);breakdownCache={key:null,map:new Map()};setTimeout(wireCards,0);return r};
  }

  function init(){ensureAdvanced();ensureDialog();setTimeout(wireCards,900)}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
