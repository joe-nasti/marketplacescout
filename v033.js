// Marketplace Scout web v0.3.3 — combined-printing + legacy-history compatibility
(() => {
  const el=id=>document.getElementById(id);
  const signed=(v,d=0,prefix="")=>{const n=Number(v);return Number.isFinite(n)?`${n>0?"+":""}${prefix}${n.toFixed(d)}`:"—"};
  const pageUrl=r=>`https://www.tcgplayer.com/product/${encodeURIComponent(r.product_id)}?Language=${encodeURIComponent(r.language||"English")}&Printing=${encodeURIComponent(r.printing||"Normal")}&Condition=${encodeURIComponent(r.condition||"Near Mint")}&direct=true`;
  const badge=el("appVersion"); if(badge) badge.textContent="web v0.3.3";

  const printing=el("newPrinting");
  if(printing){
    const current=printing.value;
    printing.innerHTML='<option value="Both">Both (Normal + Foil)</option><option value="Normal">Normal only</option><option value="Foil">Foil only</option>';
    printing.value=current&&["Both","Normal","Foil"].includes(current)?current:"Both";
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
        if(modes.has("Both")||(modes.has("Normal")&&modes.has("Foil")))opts.push({k:logicalKey(sample,"Both"),label:`${sample.set_name} • Both/${sample.condition}/${sample.language}`});
        if(modes.has("Normal")||modes.has("Both"))opts.push({k:logicalKey(sample,"Normal"),label:`${sample.set_name} • Normal/${sample.condition}/${sample.language}`});
        if(modes.has("Foil")||modes.has("Both"))opts.push({k:logicalKey(sample,"Foil"),label:`${sample.set_name} • Foil/${sample.condition}/${sample.language}`});
      }
      opts.sort((a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true}));
      select.innerHTML=opts.map(o=>`<option value="${o.k}">${o.label}</option>`).join("");
      if(opts.some(o=>o.k===current))select.value=current;else{const both=opts.find(o=>o.k.split("|")[1]==="Both");if(both)select.value=both.k}
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

  window.analytics=async function(){
    const key=el("analyticsProfile").value;if(!key)return;
    showActivity("Loading analytics","Building printing-compatible history…");
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
        let rows=rawByScan.get(s.scan_id)||[];if(s.printing==="Both")rows=rows.filter(r=>r.printing===mode);
        runs.push({scan_id:`${s.scan_id}:${mode}`,captured_at:s.captured_at,rows,legacy:s.printing==="Both"});
      }
    }
    runs.sort((a,b)=>new Date(a.captured_at)-new Date(b.captured_at));
    if(!runs.length){hideActivity();return}
    const ss=runs.map(r=>({scan_id:r.scan_id,captured_at:r.captured_at})),byScan=new Map(runs.map(r=>[r.scan_id,r.rows]));
    const agg=runs.map(r=>({d:r.captured_at,q:sum(r.rows,"direct_available"),p:median(r.rows.map(x=>x.direct_low)),l:sum(r.rows,"direct_listings"),hot:r.rows.filter(x=>x.flag==="HOT").length,watch:r.rows.filter(x=>x.flag==="WATCH").length}));
    const first=agg[0],last=agg.at(-1),legacyPairs=runs.filter(r=>r.legacy&&mode==="Both").length;
    el("analyticsStats").innerHTML=[["Compatible runs",runs.length],["Direct qty",last.q.toLocaleString()],["Qty Δ",`${last.q-first.q>=0?"+":""}${(last.q-first.q).toLocaleString()}`],["Direct listings",last.l.toLocaleString()],["Median Direct Low",money(last.p)],[mode==="Both"?"Legacy pairs":"Mode",mode==="Both"?legacyPairs:mode]].map(([a,b])=>`<div class=stat><span>${a}</span><strong>${b}</strong></div>`).join("");
    chart("qtyChart",agg.map(x=>({d:x.d,v:x.q})),v=>Math.round(v).toLocaleString());chart("priceChart",agg.map(x=>({d:x.d,v:x.p??0})),money);chart("listingChart",agg.map(x=>({d:x.d,v:x.l})),v=>Math.round(v).toLocaleString());chart("signalChart",agg.map(x=>({d:x.d,v:x.hot})),v=>Math.round(v),agg.map(x=>({d:x.d,v:x.watch})));
    const prevMap=new Map((runs.at(-2)?.rows||[]).map(r=>[r.sku_id,r])),current=runs.at(-1).rows,movers=[];
    for(const r of current){const p=prevMap.get(r.sku_id);if(!p)continue;movers.push({r,p,qd:Number(r.direct_available||0)-Number(p.direct_available||0),ld:Number(r.direct_listings||0)-Number(p.direct_listings||0),pd:Number(r.direct_low||0)-Number(p.direct_low||0),rd:Number(r.sales_rank||0)-Number(p.sales_rank||0),sd:Number(r.opportunity_score||0)-Number(p.opportunity_score||0)})}
    analyticsContext={ss,byScan,current,movers,all:runs.flatMap(r=>r.rows)};renderMoversMobile();renderSignalsMobile();renderProductOptionsMobile();hideActivity();
  };

  window.buildLeaderboard=async function(){
    const days=Number(el("leaderPeriod").value),printingMode=el("leaderPrinting").value,condition=el("leaderCondition").value,minPrice=Number(el("leaderMinPrice").value||0),metric=el("leaderMetric").value;
    showActivity("Building leaderboard","Consolidating compatible scan rows…");
    try{
      let path="marketplace_scans?select=scan_id,captured_at,set_name,printing,condition,language&order=captured_at.asc";
      if(days>0)path+=`&captured_at=gte.${encodeURIComponent(new Date(Date.now()-days*86400000).toISOString())}`;
      if(condition)path+=`&condition=eq.${encodeURIComponent(condition)}`;
      const scans=await rest(path),ids=scans.map(s=>s.scan_id);if(!ids.length){el("leaderBody").innerHTML="";el("leaderStatus").textContent="No scans in this period.";hideActivity();return}
      const rows=await rest(`marketplace_scan_rows?select=scan_id,sku_id,product_id,product_name,collector_number,set_name,printing,condition,language,sales_rank,direct_low,direct_listings,direct_available,opportunity_score,flag&scan_id=in.(${ids.join(",")})`),sm=new Map(scans.map(s=>[s.scan_id,s.captured_at])),bySku=new Map();
      for(const r of rows){r.captured_at=sm.get(r.scan_id);if(!r.captured_at||Number(r.direct_low||0)<minPrice)continue;if(printingMode&&r.printing!==printingMode)continue;if(condition&&r.condition!==condition)continue;if(!bySku.has(r.sku_id))bySku.set(r.sku_id,[]);bySku.get(r.sku_id).push(r)}
      const out=[];for(const s of bySku.values()){s.sort((a,b)=>new Date(a.captured_at)-new Date(b.captured_at));const f=s[0],l=s.at(-1),hw=s.filter(r=>r.flag==="HOT"||r.flag==="WATCH").length,h=s.filter(r=>r.flag==="HOT").length,persist=hw/s.length,qd=Number(l.direct_available||0)-Number(f.direct_available||0),pd=Number(l.direct_low||0)-Number(f.direct_low||0),rd=Number(l.sales_rank||0)-Number(f.sales_rank||0),score=Number(l.opportunity_score||0),dep=qd<0?Math.min(100,Math.abs(qd)/Math.max(1,Number(f.direct_available||0))*100):0,pr=pd>0?Math.min(100,pd/Math.max(.01,Number(f.direct_low||.01))*100):0,ri=rd<0?Math.min(100,Math.abs(rd)/Math.max(1,Number(f.sales_rank||1))*100):0,comp=score*.4+persist*20+dep*.2+pr*.1+ri*.1;out.push({s,f,l,hw,h,persist,qd,pd,rd,score,dep,pr,ri,comp})}
      const val=x=>({composite:x.comp,score:x.score,persistence:x.persist*100,depletion:x.dep,price:x.pr,rank:x.ri})[metric]||0;out.sort((a,b)=>val(b)-val(a));
      el("leaderStatus").textContent=`${out.length} unique SKUs consolidated from ${scans.length} scans.`;
      el("leaderBody").innerHTML=out.slice(0,100).map(x=>`<tr><td><a class="card-link" target="_blank" href="${pageUrl(x.l)}">${x.l.product_name}</a><div class="meta">#${x.l.collector_number||"—"} • SKU ${x.l.sku_id} • ${x.l.printing}</div></td><td>${x.l.set_name}</td><td>${x.l.direct_available??"—"}</td><td>${x.l.direct_listings??"—"}</td><td>${money(x.l.direct_low)}</td><td>${x.score}</td><td>${x.s.length}</td><td>${x.h}/${x.hw}</td><td>${signed(x.qd)}</td><td>${signed(x.pd,2,"$")}</td></tr>`).join("");
    }catch(e){el("leaderStatus").textContent=`Leaderboard failed: ${e.message}`}finally{hideActivity()}
  };

  if(el("analyticsProfile"))el("analyticsProfile").onchange=async()=>{try{showActivity("Loading analytics","Building compatible history…");await window.analytics();setTimeout(hideActivity,500)}catch(e){showActivity("Analytics failed",e.message)}};
  if(el("leaderRefresh"))el("leaderRefresh").onclick=window.buildLeaderboard;
  ["leaderPeriod","leaderPrinting","leaderCondition","leaderMetric"].forEach(id=>{if(el(id))el(id).onchange=window.buildLeaderboard});
  if(el("leaderMinPrice"))el("leaderMinPrice").onchange=window.buildLeaderboard;
})();
