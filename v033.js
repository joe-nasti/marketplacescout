// Marketplace Scout web v0.3.4 — combined-printing scans with exact-printing analytics
(() => {
  const el=id=>document.getElementById(id);
  const signed=(v,d=0,prefix="")=>{const n=Number(v);return Number.isFinite(n)?`${n>0?"+":""}${prefix}${n.toFixed(d)}`:"—"};
  const pageUrl=r=>`https://www.tcgplayer.com/product/${encodeURIComponent(r.product_id)}?Language=${encodeURIComponent(r.language||"English")}&Printing=${encodeURIComponent(r.printing||"Normal")}&Condition=${encodeURIComponent(r.condition||"Near Mint")}&direct=true`;
  const badge=el("appVersion"); if(badge) badge.textContent="web v0.3.4";

  const printing=el("newPrinting");
  if(printing){
    const current=printing.value;
    printing.innerHTML='<option value="Both">Both (Normal + Foil)</option><option value="Normal">Normal only</option><option value="Foil">Foil only</option>';
    printing.value=current&&["Both","Normal","Foil"].includes(current)?current:"Both";
  }

  // Clarify the UI and expose printing in tables without requiring an HTML deploy rewrite.
  const analyticsMeta=el("analyticsProfile")?.closest(".toolbar")?.querySelector(".meta");
  if(analyticsMeta)analyticsMeta.textContent='Exact-SKU analytics. In Both mode, Normal and Foil inventory, listings, prices, movers, and signals stay separate.';
  const moverHead=el("movers")?.closest("table")?.querySelector("thead tr");
  if(moverHead&&!moverHead.querySelector('[data-v034-printing]')){
    const th=document.createElement("th");th.textContent="Printing";th.dataset.v034Printing="1";moverHead.insertBefore(th,moverHead.children[1]||null);
  }
  const signalHead=el("signalsBody")?.closest("table")?.querySelector("thead tr");
  if(signalHead&&!signalHead.querySelector('[data-v034-printing]')){
    const th=document.createElement("th");th.textContent="Printing";th.dataset.v034Printing="1";signalHead.insertBefore(th,signalHead.children[2]||null);
  }
  const leaderHead=el("leaderBody")?.closest("table")?.querySelector("thead tr");
  if(leaderHead&&!leaderHead.querySelector('[data-v034-printing]')){
    const th=document.createElement("th");th.textContent="Printing";th.dataset.v034Printing="1";leaderHead.insertBefore(th,leaderHead.children[2]||null);
  }

  const logicalKey=(s,p=s.printing)=>[s.set_slug,p,s.condition,s.language].join("|");
  const baseKey=s=>[s.set_slug,s.condition,s.language].join("|");
  let rebuilding=false;
  function rebuildProfileOptions(){
    const select=el("analyticsProfile");
    if(!select||rebuilding||typeof scansCache==="undefined"||!scansCache.length)return;
    rebuilding=true;
    try{
      const current=select.value,bases=new Map();
      for(const s of scansCache){const k=baseKey(s);if(!bases.has(k))bases.set(k,{sample:s,modes:new Set()});bases.get(k).modes.add(s.printing)}
      const opts=[];
      for(const {sample,modes} of bases.values()){
        if(modes.has("Both")||(modes.has("Normal")&&modes.has("Foil")))opts.push({k:logicalKey(sample,"Both"),label:`${sample.set_name} • Both / ${sample.condition} / ${sample.language}`});
        if(modes.has("Normal")||modes.has("Both"))opts.push({k:logicalKey(sample,"Normal"),label:`${sample.set_name} • Normal / ${sample.condition} / ${sample.language}`});
        if(modes.has("Foil")||modes.has("Both"))opts.push({k:logicalKey(sample,"Foil"),label:`${sample.set_name} • Foil / ${sample.condition} / ${sample.language}`});
      }
      opts.sort((a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true}));
      select.innerHTML=opts.map(o=>`<option value="${o.k}">${o.label}</option>`).join("");
      if(opts.some(o=>o.k===current))select.value=current;else{const both=opts.find(o=>o.k.split("|")[1]==="Both");if(both)select.value=both.k;else if(opts[0])select.value=opts[0].k}
    }finally{rebuilding=false}
  }
  const profileObserver=new MutationObserver(()=>setTimeout(rebuildProfileOptions,0));
  if(el("analyticsProfile"))profileObserver.observe(el("analyticsProfile"),{childList:true});
  setTimeout(rebuildProfileOptions,250);

  function pairLegacy(normals,foils,maxGap=12*60*60*1000){
    const ns=[...normals].sort((a,b)=>new Date(a.captured_at)-new Date(b.captured_at)),fs=[...foils].sort((a,b)=>new Date(a.captured_at)-new Date(b.captured_at)),used=new Set(),pairs=[];
    for(const n of ns){let bi=-1,bg=Infinity;for(let i=0;i<fs.length;i++){if(used.has(i))continue;const g=Math.abs(new Date(n.captured_at)-new Date(fs[i].captured_at));if(g<bg){bg=g;bi=i}}if(bi>=0&&bg<=maxGap){used.add(bi);pairs.push([n,fs[bi]])}}
    return pairs;
  }
  const exactRows=(rows,printing)=>rows.filter(r=>(r.printing||"Normal")===printing);
  const aggregate=runs=>runs.map(r=>({d:r.captured_at,q:sum(r.rows,"direct_available"),p:median(r.rows.map(x=>x.direct_low)),l:sum(r.rows,"direct_listings"),hot:r.rows.filter(x=>x.flag==="HOT").length,watch:r.rows.filter(x=>x.flag==="WATCH").length,signal:r.rows.filter(x=>x.flag==="HOT"||x.flag==="WATCH").length}));
  const printingRuns=(runs,p)=>runs.map(r=>({...r,rows:exactRows(r.rows,p)}));

  // Override movers so Printing is always explicit and all deltas remain exact-SKU.
  window.renderMoversMobile=function(){
    if(!analyticsContext)return;
    const metric=el("moverSort").value,q=el("moverSearch").value.toLowerCase().trim(),field={inventory:"qd",price:"pd",listings:"ld",rank:"rd",score:"sd"}[metric];
    const arr=analyticsContext.movers.filter(x=>!q||x.r.product_name.toLowerCase().includes(q)||String(x.r.sku_id).includes(q)).sort((a,b)=>Math.abs(b[field])-Math.abs(a[field]));
    el("movers").innerHTML=arr.slice(0,50).map(x=>`<tr data-sku="${x.r.sku_id}"><td>${x.r.product_name}</td><td><b>${x.r.printing||"—"}</b></td><td>${x.qd>0?"+":""}${x.qd}</td><td>${x.ld>0?"+":""}${x.ld}</td><td>${x.pd>0?"+":""}$${x.pd.toFixed(2)}</td><td>${x.rd>0?"+":""}${x.rd}</td><td>${x.sd>0?"+":""}${x.sd}</td></tr>`).join("");
    document.querySelectorAll("#movers tr[data-sku]").forEach(tr=>tr.onclick=()=>openProductHistory(tr.dataset.sku));
  };

  window.renderSignalsMobile=function(){
    if(!analyticsContext)return;
    const sig=[];let newlyHot=0,depleting=0,rising=0,squeeze=0;
    for(const x of analyticsContext.movers){
      if(x.r.flag==="HOT"&&x.p.flag!=="HOT"){newlyHot++;sig.push(["New HOT",x.r,"Score moved into HOT"])}
      if(x.qd<=-5){depleting++;sig.push(["Inventory drop",x.r,`${Math.abs(x.qd)} fewer Direct copies`])}
      if(x.pd>0.5){rising++;sig.push(["Price rise",x.r,`Direct Low +$${x.pd.toFixed(2)}`])}
      if(x.qd<0&&x.ld<0&&x.pd>0){squeeze++;sig.push(["Supply squeeze",x.r,`Qty ${x.qd}, listings ${x.ld}, price +$${x.pd.toFixed(2)}`])}
    }
    el("signalCards").innerHTML=[["New HOT",newlyHot],["Qty falling",depleting],["Price rising",rising],["Supply squeeze",squeeze]].map(([a,b])=>`<div class=signal-card><span>${a}</span><strong>${b}</strong></div>`).join("");
    const priority={"Supply squeeze":4,"New HOT":3,"Inventory drop":2,"Price rise":1};sig.sort((a,b)=>priority[b[0]]-priority[a[0]]);
    el("signalsBody").innerHTML=sig.slice(0,50).map(x=>`<tr data-sku="${x[1].sku_id}"><td>${x[0]}</td><td>${x[1].product_name}</td><td><b>${x[1].printing||"—"}</b></td><td>${x[2]}</td></tr>`).join("");
    document.querySelectorAll("#signalsBody tr[data-sku]").forEach(tr=>tr.onclick=()=>openProductHistory(tr.dataset.sku));
  };

  window.analytics=async function(){
    const key=el("analyticsProfile").value;if(!key)return;
    showActivity("Loading analytics","Building exact-printing history…");
    const [slug,mode,condition,language]=key.split("|");
    const candidates=scansCache.filter(s=>s.set_slug===slug&&s.condition===condition&&s.language===language&&(s.printing===mode||s.printing==="Both"||mode==="Both"));
    const ids=[...new Set(candidates.map(s=>s.scan_id))];
    if(!ids.length){hideActivity();return}
    const all=await rest(`marketplace_scan_rows?select=scan_id,sku_id,product_id,product_name,collector_number,printing,condition,language,direct_available,direct_low,direct_listings,sales_rank,opportunity_score,flag,avg_daily_qty_sold&scan_id=in.(${ids.join(",")})`);
    const rawByScan=new Map(ids.map(id=>[id,[]]));all.forEach(r=>rawByScan.get(r.scan_id)?.push(r));
    const runs=[];
    if(mode==="Both"){
      for(const s of candidates.filter(s=>s.printing==="Both"))runs.push({scan_id:s.scan_id,captured_at:s.captured_at,rows:rawByScan.get(s.scan_id)||[],legacy:false});
      const normals=candidates.filter(s=>s.printing==="Normal"),foils=candidates.filter(s=>s.printing==="Foil");
      for(const [n,f] of pairLegacy(normals,foils)){
        const captured_at=new Date(Math.max(new Date(n.captured_at).getTime(),new Date(f.captured_at).getTime())).toISOString();
        runs.push({scan_id:`legacy:${n.scan_id}:${f.scan_id}`,captured_at,rows:[...(rawByScan.get(n.scan_id)||[]),...(rawByScan.get(f.scan_id)||[])],legacy:true});
      }
    }else{
      for(const s of candidates.filter(s=>s.printing===mode||s.printing==="Both")){
        let rows=rawByScan.get(s.scan_id)||[];if(s.printing==="Both")rows=exactRows(rows,mode);
        runs.push({scan_id:`${s.scan_id}:${mode}`,captured_at:s.captured_at,rows,legacy:s.printing==="Both"});
      }
    }
    runs.sort((a,b)=>new Date(a.captured_at)-new Date(b.captured_at));
    if(!runs.length){hideActivity();return}

    if(mode==="Both"){
      const nr=printingRuns(runs,"Normal"),fr=printingRuns(runs,"Foil"),na=aggregate(nr),fa=aggregate(fr),nl=na.at(-1),fl=fa.at(-1);
      el("analyticsStats").innerHTML=[["Normal Direct qty",nl.q.toLocaleString()],["Foil Direct qty",fl.q.toLocaleString()],["Normal listings",nl.l.toLocaleString()],["Foil listings",fl.l.toLocaleString()],["Normal median DL",money(nl.p)],["Foil median DL",money(fl.p)]].map(([a,b])=>`<div class=stat><span>${a}</span><strong>${b}</strong></div>`).join("");
      chart("qtyChart",na.map(x=>({d:x.d,v:x.q})),v=>Math.round(v).toLocaleString(),fa.map(x=>({d:x.d,v:x.q})));
      chart("priceChart",na.map(x=>({d:x.d,v:x.p??0})),money,fa.map(x=>({d:x.d,v:x.p??0})));
      chart("listingChart",na.map(x=>({d:x.d,v:x.l})),v=>Math.round(v).toLocaleString(),fa.map(x=>({d:x.d,v:x.l})));
      chart("signalChart",na.map(x=>({d:x.d,v:x.signal})),v=>Math.round(v),fa.map(x=>({d:x.d,v:x.signal})));
    }else{
      const a=aggregate(runs),first=a[0],last=a.at(-1);
      el("analyticsStats").innerHTML=[["Compatible runs",runs.length],[`${mode} Direct qty`,last.q.toLocaleString()],["Qty Δ",`${last.q-first.q>=0?"+":""}${(last.q-first.q).toLocaleString()}`],[`${mode} listings`,last.l.toLocaleString()],[`${mode} median DL`,money(last.p)],["Printing",mode]].map(([x,y])=>`<div class=stat><span>${x}</span><strong>${y}</strong></div>`).join("");
      chart("qtyChart",a.map(x=>({d:x.d,v:x.q})),v=>Math.round(v).toLocaleString());
      chart("priceChart",a.map(x=>({d:x.d,v:x.p??0})),money);
      chart("listingChart",a.map(x=>({d:x.d,v:x.l})),v=>Math.round(v).toLocaleString());
      chart("signalChart",a.map(x=>({d:x.d,v:x.hot})),v=>Math.round(v),a.map(x=>({d:x.d,v:x.watch})));
    }

    // Movers remain exact-SKU; same product's Normal and Foil are independent rows.
    const prevMap=new Map((runs.at(-2)?.rows||[]).map(r=>[String(r.sku_id),r])),current=runs.at(-1).rows,movers=[];
    for(const r of current){const p=prevMap.get(String(r.sku_id));if(!p)continue;movers.push({r,p,qd:Number(r.direct_available||0)-Number(p.direct_available||0),ld:Number(r.direct_listings||0)-Number(p.direct_listings||0),pd:Number(r.direct_low||0)-Number(p.direct_low||0),rd:Number(r.sales_rank||0)-Number(p.sales_rank||0),sd:Number(r.opportunity_score||0)-Number(p.opportunity_score||0)})}
    const ss=runs.map(r=>({scan_id:r.scan_id,captured_at:r.captured_at})),byScan=new Map(runs.map(r=>[r.scan_id,r.rows]));
    analyticsContext={ss,byScan,current,movers,all:runs.flatMap(r=>r.rows)};
    renderMoversMobile();renderSignalsMobile();renderProductOptionsMobile();hideActivity();
  };

  // Leaderboard is always grouped by exact SKU, never productId, and displays Printing explicitly.
  window.buildLeaderboard=async function(){
    const days=Number(el("leaderPeriod").value),printingMode=el("leaderPrinting").value,condition=el("leaderCondition").value,minPrice=Number(el("leaderMinPrice").value||0),metric=el("leaderMetric").value;
    showActivity("Building leaderboard","Consolidating exact SKUs…");
    try{
      let path="marketplace_scans?select=scan_id,captured_at,set_name,printing,condition,language&order=captured_at.asc";
      if(days>0)path+=`&captured_at=gte.${encodeURIComponent(new Date(Date.now()-days*86400000).toISOString())}`;
      if(condition)path+=`&condition=eq.${encodeURIComponent(condition)}`;
      const scans=await rest(path),ids=scans.map(s=>s.scan_id);if(!ids.length){el("leaderBody").innerHTML="";el("leaderStatus").textContent="No scans in this period.";hideActivity();return}
      const rows=await rest(`marketplace_scan_rows?select=scan_id,sku_id,product_id,product_name,collector_number,set_name,printing,condition,language,sales_rank,direct_low,direct_listings,direct_available,opportunity_score,flag&scan_id=in.(${ids.join(",")})`),sm=new Map(scans.map(s=>[s.scan_id,s.captured_at])),bySku=new Map();
      for(const r of rows){r.captured_at=sm.get(r.scan_id);if(!r.captured_at||Number(r.direct_low||0)<minPrice)continue;if(printingMode&&r.printing!==printingMode)continue;if(condition&&r.condition!==condition)continue;if(!bySku.has(String(r.sku_id)))bySku.set(String(r.sku_id),[]);bySku.get(String(r.sku_id)).push(r)}
      const out=[];for(const s of bySku.values()){s.sort((a,b)=>new Date(a.captured_at)-new Date(b.captured_at));const f=s[0],l=s.at(-1),hw=s.filter(r=>r.flag==="HOT"||r.flag==="WATCH").length,h=s.filter(r=>r.flag==="HOT").length,persist=hw/s.length,qd=Number(l.direct_available||0)-Number(f.direct_available||0),pd=Number(l.direct_low||0)-Number(f.direct_low||0),rd=Number(l.sales_rank||0)-Number(f.sales_rank||0),score=Number(l.opportunity_score||0),dep=qd<0?Math.min(100,Math.abs(qd)/Math.max(1,Number(f.direct_available||0))*100):0,pr=pd>0?Math.min(100,pd/Math.max(.01,Number(f.direct_low||.01))*100):0,ri=rd<0?Math.min(100,Math.abs(rd)/Math.max(1,Number(f.sales_rank||1))*100):0,comp=score*.4+persist*20+dep*.2+pr*.1+ri*.1;out.push({s,f,l,hw,h,persist,qd,pd,rd,score,dep,pr,ri,comp})}
      const val=x=>({composite:x.comp,score:x.score,persistence:x.persist*100,depletion:x.dep,price:x.pr,rank:x.ri})[metric]||0;out.sort((a,b)=>val(b)-val(a));
      el("leaderStatus").textContent=`${out.length} exact SKUs consolidated from ${scans.length} scans. Normal and Foil remain separate rows.`;
      el("leaderBody").innerHTML=out.slice(0,100).map(x=>`<tr><td><a class="card-link" target="_blank" href="${pageUrl(x.l)}">${x.l.product_name}</a><div class="meta">#${x.l.collector_number||"—"} • SKU ${x.l.sku_id}</div></td><td>${x.l.set_name}</td><td><b>${x.l.printing||"—"}</b></td><td>${x.l.direct_available??"—"}</td><td>${x.l.direct_listings??"—"}</td><td>${money(x.l.direct_low)}</td><td>${x.score}</td><td>${x.s.length}</td><td>${x.h}/${x.hw}</td><td>${signed(x.qd)}</td><td>${signed(x.pd,2,"$")}</td></tr>`).join("");
    }catch(e){el("leaderStatus").textContent=`Leaderboard failed: ${e.message}`}finally{hideActivity()}
  };

  if(el("analyticsProfile"))el("analyticsProfile").onchange=async()=>{try{showActivity("Loading analytics","Building exact-printing history…");await window.analytics();setTimeout(hideActivity,500)}catch(e){showActivity("Analytics failed",e.message)}};
  if(el("leaderRefresh"))el("leaderRefresh").onclick=window.buildLeaderboard;
  ["leaderPeriod","leaderPrinting","leaderCondition","leaderMetric"].forEach(id=>{if(el(id))el(id).onchange=window.buildLeaderboard});
  if(el("leaderMinPrice"))el("leaderMinPrice").onchange=window.buildLeaderboard;
})();
