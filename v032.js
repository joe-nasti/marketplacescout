document.getElementById("appVersion").textContent="web v0.3.2";

chart=function(id,pts,fmt=v=>String(v),second=null){
  const s=$(id),W=640,H=220,L=58,R=12,T=12,B=34;
  const vals=[...pts.map(x=>x.v),...(second?second.map(x=>x.v):[])].filter(Number.isFinite);
  if(pts.length<2||!vals.length){s.innerHTML='<text x="320" y="110" text-anchor="middle" class="axis">Need 2+ scans</text>';return}
  let mn=Math.min(...vals),mx=Math.max(...vals);if(mn===mx){mn-=1;mx+=1}
  const x=i=>L+i*(W-L-R)/(pts.length-1),y=v=>T+(mx-v)*(H-T-B)/(mx-mn),path=a=>a.map((q,i)=>`${i?"L":"M"} ${x(i)} ${y(q.v)}`).join(" ");
  const grid=[0,.25,.5,.75,1].map(f=>{const val=mx-(mx-mn)*f,yy=T+(H-T-B)*f;return `<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" class="grid-line"/><text x="${L-6}" y="${yy+4}" text-anchor="end" class="axis">${fmt(val)}</text>`}).join("");
  const inds=[0,Math.floor((pts.length-1)/2),pts.length-1].filter((v,i,a)=>a.indexOf(v)===i);
  const xt=inds.map(i=>`<text x="${x(i)}" y="${H-8}" text-anchor="${i===0?"start":i===pts.length-1?"end":"middle"}" class="axis">${new Date(pts[i].d).toLocaleDateString(undefined,{month:"numeric",day:"numeric"})}</text>`).join("");
  s.innerHTML=grid+`<path d="${path(pts)}" class="line"/>${second?`<path d="${path(second)}" class="line second"/>`:""}`+pts.map((q,i)=>`<circle cx="${x(i)}" cy="${y(q.v)}" r="4" class="dot"><title>${dt(q.d)}: ${fmt(q.v)}</title></circle>`).join("")+(second?second.map((q,i)=>`<circle cx="${x(i)}" cy="${y(q.v)}" r="3" class="dot second"></circle>`).join(""):"")+xt;
};

function signed032(v,d=0,prefix=""){const n=Number(v);if(!Number.isFinite(n))return "—";return `${n>0?"+":""}${prefix}${n.toFixed(d)}`}
function pageUrl032(r){return `https://www.tcgplayer.com/product/${encodeURIComponent(r.product_id)}?Language=${encodeURIComponent(r.language||"English")}&Printing=${encodeURIComponent(r.printing||"Normal")}&Condition=${encodeURIComponent(r.condition||"Near Mint")}&direct=true`}

async function globalCardSearch032(){
  const q=$("globalCardSearch").value.trim();if(q.length<2){$("globalCardSearchStatus").textContent="Enter at least 2 characters.";return}
  showActivity("Searching all scans",`Looking for “${q}”…`);
  try{
    const numeric=/^\d+$/.test(q),filter=numeric?`or=(sku_id.eq.${q},product_id.eq.${q},collector_number.eq.${q})`:`product_name=ilike.*${encodeURIComponent(q)}*`;
    const rows=await rest(`marketplace_scan_rows?select=scan_id,sku_id,product_id,product_name,collector_number,set_name,printing,condition,language,direct_available,direct_low,direct_listings,opportunity_score,flag&${filter}&limit=1000`);
    const ids=[...new Set(rows.map(r=>r.scan_id))],scans=ids.length?await rest(`marketplace_scans?select=scan_id,captured_at&scan_id=in.(${ids.join(",")})`):[];
    const sm=new Map(scans.map(s=>[s.scan_id,s.captured_at])),bySku=new Map();
    for(const r of rows){r.captured_at=sm.get(r.scan_id);if(!r.captured_at)continue;if(!bySku.has(r.sku_id))bySku.set(r.sku_id,[]);bySku.get(r.sku_id).push(r)}
    const cards=[...bySku.values()].map(s=>{s.sort((a,b)=>new Date(a.captured_at)-new Date(b.captured_at));const f=s[0],l=s.at(-1);return{s,f,l,qd:Number(l.direct_available||0)-Number(f.direct_available||0),pd:Number(l.direct_low||0)-Number(f.direct_low||0)}}).sort((a,b)=>new Date(b.l.captured_at)-new Date(a.l.captured_at));
    $("globalCardSearchStatus").textContent=`${cards.length} matching SKU${cards.length===1?"":"s"} • ${rows.length} observations`;
    $("globalCardResults").innerHTML=cards.slice(0,100).map(x=>`<div class="global-card-result"><div><a class="card-link" target="_blank" href="${pageUrl032(x.l)}">${x.l.product_name}</a><div class="meta">${x.l.set_name} • #${x.l.collector_number||"—"} • SKU ${x.l.sku_id} • ${x.l.printing}/${x.l.condition}/${x.l.language}</div><div class="meta">${x.s.length} observations • latest ${dt(x.l.captured_at)}</div></div><div class="global-card-metrics"><span>Qty <b>${x.l.direct_available??"—"}</b> <em>${signed032(x.qd)}</em></span><span>Direct Low <b>${money(x.l.direct_low)}</b> <em>${signed032(x.pd,2,"$")}</em></span><span>Direct listings <b>${x.l.direct_listings??"—"}</b></span><span>Score <b>${x.l.opportunity_score??"—"}</b> / ${x.l.flag||"—"}</span></div></div>`).join("");
  }catch(e){$("globalCardSearchStatus").textContent=`Search failed: ${e.message}`}finally{hideActivity()}
}

async function buildLeaderboard032(){
  const days=Number($("leaderPeriod").value),printing=$("leaderPrinting").value,condition=$("leaderCondition").value,minPrice=Number($("leaderMinPrice").value||0),metric=$("leaderMetric").value;
  showActivity("Building leaderboard","Consolidating recent scans…");
  try{
    let path="marketplace_scans?select=scan_id,captured_at,set_name,printing,condition,language&order=captured_at.asc";
    if(days>0)path+=`&captured_at=gte.${encodeURIComponent(new Date(Date.now()-days*86400000).toISOString())}`;
    if(printing)path+=`&printing=eq.${encodeURIComponent(printing)}`;
    if(condition)path+=`&condition=eq.${encodeURIComponent(condition)}`;
    const scans=await rest(path),ids=scans.map(s=>s.scan_id);
    if(!ids.length){$("leaderBody").innerHTML="";$("leaderStatus").textContent="No scans in this period.";hideActivity();return}
    updateActivity(`Loading rows from ${scans.length} scans…`);
    const rows=await rest(`marketplace_scan_rows?select=scan_id,sku_id,product_id,product_name,collector_number,set_name,printing,condition,language,sales_rank,direct_low,direct_listings,direct_available,opportunity_score,flag&scan_id=in.(${ids.join(",")})`);
    const sm=new Map(scans.map(s=>[s.scan_id,s.captured_at])),bySku=new Map();
    for(const r of rows){r.captured_at=sm.get(r.scan_id);if(!r.captured_at||Number(r.direct_low||0)<minPrice)continue;if(!bySku.has(r.sku_id))bySku.set(r.sku_id,[]);bySku.get(r.sku_id).push(r)}
    const out=[];
    for(const s of bySku.values()){
      s.sort((a,b)=>new Date(a.captured_at)-new Date(b.captured_at));const f=s[0],l=s.at(-1),hw=s.filter(r=>r.flag==="HOT"||r.flag==="WATCH").length,h=s.filter(r=>r.flag==="HOT").length,persist=hw/s.length,qd=Number(l.direct_available||0)-Number(f.direct_available||0),pd=Number(l.direct_low||0)-Number(f.direct_low||0),rd=Number(l.sales_rank||0)-Number(f.sales_rank||0),score=Number(l.opportunity_score||0),dep=qd<0?Math.min(100,Math.abs(qd)/Math.max(1,Number(f.direct_available||0))*100):0,pr=pd>0?Math.min(100,pd/Math.max(.01,Number(f.direct_low||.01))*100):0,ri=rd<0?Math.min(100,Math.abs(rd)/Math.max(1,Number(f.sales_rank||1))*100):0,comp=score*.4+persist*20+dep*.2+pr*.1+ri*.1;out.push({s,f,l,hw,h,persist,qd,pd,rd,score,dep,pr,ri,comp});
    }
    const val=x=>({composite:x.comp,score:x.score,persistence:x.persist*100,depletion:x.dep,price:x.pr,rank:x.ri})[metric]||0;out.sort((a,b)=>val(b)-val(a));
    $("leaderStatus").textContent=`${out.length} unique SKUs consolidated from ${scans.length} scans.`;
    $("leaderBody").innerHTML=out.slice(0,100).map(x=>`<tr><td><a class="card-link" target="_blank" href="${pageUrl032(x.l)}">${x.l.product_name}</a><div class="meta">#${x.l.collector_number||"—"} • SKU ${x.l.sku_id}</div></td><td>${x.l.set_name}</td><td>${x.l.direct_available??"—"}</td><td>${x.l.direct_listings??"—"}</td><td>${money(x.l.direct_low)}</td><td>${x.score}</td><td>${x.s.length}</td><td>${x.h}/${x.hw}</td><td>${signed032(x.qd)}</td><td>${signed032(x.pd,2,"$")}</td></tr>`).join("");
  }catch(e){$("leaderStatus").textContent=`Leaderboard failed: ${e.message}`}finally{hideActivity()}
}

$("globalCardSearchBtn").addEventListener("click",globalCardSearch032);
$("globalCardSearch").addEventListener("keydown",e=>{if(e.key==="Enter")globalCardSearch032()});
$("leaderRefresh").addEventListener("click",buildLeaderboard032);
["leaderPeriod","leaderPrinting","leaderCondition","leaderMetric"].forEach(id=>$(id).addEventListener("change",buildLeaderboard032));
$("leaderMinPrice").addEventListener("change",buildLeaderboard032);
if($("analyticsProfile").value) analytics();
