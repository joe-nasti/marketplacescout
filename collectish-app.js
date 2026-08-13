// Collectish consolidated web 0.7.0
// Generated from the current working production asset set captured in HAR.
// Historical overlay assets remain in the repo but are not loaded by index.html.
(() => {
  const FINAL_VERSION='0.7.0';
  const originalGetElementById=Document.prototype.getElementById;
  const badge=originalGetElementById.call(document,'appVersion');
  let badgeAnchor=null;
  if(badge){
    badgeAnchor=document.createComment('collectish-version');
    badge.replaceWith(badgeAnchor);
  }

  // Legacy overlays historically injected additional vNNN scripts/styles.
  // Everything needed is already bundled below, so suppress those injections.
  const isLegacyAsset=(node)=>{
    if(!node || node.nodeType!==1) return false;
    const tag=node.tagName;
    const raw=tag==='SCRIPT'?node.getAttribute('src'):tag==='LINK'?node.getAttribute('href'):'';
    if(!raw) return false;
    try{
      const u=new URL(raw,location.href);
      return /^v\d+\.(?:js|css)$/i.test(u.pathname.split('/').pop()||'');
    }catch{ return false; }
  };
  const originalAppendChild=Node.prototype.appendChild;
  Node.prototype.appendChild=function(node){
    if(isLegacyAsset(node)) return node;
    return originalAppendChild.call(this,node);
  };
  const originalAppend=Element.prototype.append;
  Element.prototype.append=function(...nodes){
    return originalAppend.apply(this,nodes.filter(n=>!isLegacyAsset(n)));
  };
  const originalPrepend=Element.prototype.prepend;
  Element.prototype.prepend=function(...nodes){
    return originalPrepend.apply(this,nodes.filter(n=>!isLegacyAsset(n)));
  };
  const originalInsertAdjacentElement=Element.prototype.insertAdjacentElement;
  Element.prototype.insertAdjacentElement=function(position,node){
    if(isLegacyAsset(node)) return node;
    return originalInsertAdjacentElement.call(this,position,node);
  };

  // Hide the version node from old releases while they initialize, preventing
  // them from installing version observers or repainting the badge.
  Document.prototype.getElementById=function(id){
    if(id==='appVersion' && !window.__collectishVersionReady) return null;
    return originalGetElementById.call(this,id);
  };

  window.__collectishConsolidated={version:FINAL_VERSION, startedAt:Date.now()};
})();

/* ===== app.js ===== */
const WEB_APP_VERSION="0.3.1";
const c=window.COLLECTISH_CONFIG,K="collectishSession",$=id=>document.getElementById(id);
const session=()=>JSON.parse(localStorage.getItem(K)||"null"),save=s=>s?localStorage.setItem(K,JSON.stringify(s)):localStorage.removeItem(K);
const H=t=>({"apikey":c.publishableKey,"Authorization":`Bearer ${t||c.publishableKey}`,"Content-Type":"application/json"});
let scansCache=[],rowsCache=[];
const SET_CACHE_KEY="collectishSetCatalog";
const SET_CACHE_MAX_AGE=7*24*60*60*1000;
function getCachedSets(){
  try{
    const cached=JSON.parse(localStorage.getItem(SET_CACHE_KEY)||"null");
    if(!cached?.sets?.length)return null;
    return cached;
  }catch{return null}
}
function saveCachedSets(sets){
  const cached={savedAt:Date.now(),sets};
  localStorage.setItem(SET_CACHE_KEY,JSON.stringify(cached));
  return cached;
}
function setCatalogAgeLabel(savedAt){
  if(!savedAt)return "not cached";
  const ms=Date.now()-savedAt;
  const mins=Math.floor(ms/60000);
  if(mins<60)return `${mins} min ago`;
  const hours=Math.floor(mins/60);
  if(hours<24)return `${hours} hr ago`;
  return `${Math.floor(hours/24)} day${Math.floor(hours/24)===1?"":"s"} ago`;
}
function renderSetOptions(sets){
  $("newSet").innerHTML='<option value="">Select set…</option>'+sets.map(s=>`<option value="${s.set_slug}" data-name="${s.set_name}">${s.set_name} (${s.direct_product_count})</option>`).join("");
}
async function loadSetCatalog(force=false){
  const cached=getCachedSets();
  const fresh=cached && (Date.now()-cached.savedAt)<SET_CACHE_MAX_AGE;

  if(cached?.sets?.length){
    renderSetOptions(cached.sets);
    $("setCacheStatus").textContent=`${cached.sets.length.toLocaleString()} sets cached • ${setCatalogAgeLabel(cached.savedAt)}`;
  }

  if(!force && fresh) return cached.sets;

  showActivity(force?"Refreshing set catalog":"Updating set catalog",cached?"Checking cloud for weekly set updates…":"Downloading set catalog…");
  const sets=await rest("marketplace_set_catalog?select=*&order=set_name.asc");
  saveCachedSets(sets);
  renderSetOptions(sets);
  $("setCacheStatus").textContent=`${sets.length.toLocaleString()} sets cached • just updated`;
  return sets;
}

function showActivity(title,detail=""){
  $("activityTitle").textContent=title;
  $("activityDetail").textContent=detail;
  $("activityBanner").hidden=false;
}
function updateActivity(detail){
  $("activityDetail").textContent=detail;
}
function hideActivity(){
  $("activityBanner").hidden=true;
}

async function valid(){let s=session();if(!s)return null;if(Date.now()<s.exp-60000)return s;const r=await fetch(`${c.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,{method:"POST",headers:H(),body:JSON.stringify({refresh_token:s.refresh})});if(!r.ok){save(null);return null}const d=await r.json();s={token:d.access_token,refresh:d.refresh_token||s.refresh,exp:Date.now()+d.expires_in*1000,user:d.user};save(s);return s}
async function rest(path,o={}){const s=await valid();if(!s)throw Error("Sign in required");const r=await fetch(`${c.supabaseUrl}/rest/v1/${path}`,{method:o.method||"GET",headers:{...H(s.token),...(o.prefer?{"Prefer":o.prefer}:{})},body:o.body?JSON.stringify(o.body):undefined});const t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw Error(d?.message||`HTTP ${r.status}`);return d}
async function login(){const r=await fetch(`${c.supabaseUrl}/auth/v1/token?grant_type=password`,{method:"POST",headers:H(),body:JSON.stringify({email:$("email").value,password:$("password").value})});const d=await r.json();if(!r.ok){$("msg").textContent=d.message;return}save({token:d.access_token,refresh:d.refresh_token,exp:Date.now()+d.expires_in*1000,user:d.user});$("password").value="";boot()}
const dt=v=>v?new Date(v).toLocaleString():"—",money=v=>v==null?"":`$${Number(v).toFixed(2)}`;
async function queue(p){const s=await valid();await rest("marketplace_scan_commands",{method:"POST",body:[{user_id:s.user.id,profile_json:p,status:"pending"}],prefer:"return=minimal"});load()}
async function queueNew(){
  const opt=$("newSet").selectedOptions[0];
  if(!opt?.value){$("newScanMsg").textContent="Select a set.";return}
  const p={setSlug:opt.value,setName:opt.dataset.name||opt.textContent,printing:$("newPrinting").value,condition:$("newCondition").value,language:$("newLanguage").value,salesEnrich:Number($("newEnrich").value)};
  try{
    showActivity("Queueing scan",`${p.setName} • sending request to cloud…`);
    $("newScanMsg").textContent="Sending request…";
    await queue(p);
    $("newScanMsg").textContent=`Queued ${p.setName}. Waiting for PC to pick it up.`;
    showActivity("Scan queued",`${p.setName} • waiting for PC`);
    setTimeout(hideActivity,1800);
  }catch(e){
    hideActivity();
    $("newScanMsg").textContent=e.message;
  }
}



function etaText(v){
  const s=Number(v);
  if(!Number.isFinite(s)||s<=0)return "";
  if(s<60)return `~${Math.round(s)}s`;
  const m=Math.floor(s/60),r=Math.round(s%60);
  return `~${m}m ${r}s`;
}
function requestProgressHtml(x){
  if(x.status!=="running")return "";
  const p=x.progress_json||{};
  const pct=Math.max(0,Math.min(100,Number(p.percent||0)));
  return `<div class="request-progress">
    <div class="request-progress-head">
      <span>${p.detail||p.stage||"Running…"}</span>
      <b>${Math.round(pct)}%</b>
    </div>
    <progress max="100" value="${pct}"></progress>
    <div class="meta">${
      [
        p.stage?`Stage: ${p.stage}`:"",
        etaText(p.etaSec)?`ETA ${etaText(p.etaSec)}`:""
      ].filter(Boolean).join(" • ")
    }</div>
  </div>`;
}

function median(v){const a=v.filter(x=>Number.isFinite(Number(x))).map(Number).sort((a,b)=>a-b);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
function sum(rows,key){return rows.reduce((a,r)=>a+Number(r[key]||0),0)}
function chart(id,pts,fmt=v=>String(v),second=null){const s=$(id),W=640,H=220,L=48,R=12,T=15,B=30;const vals=[...pts.map(x=>x.v),...(second?second.map(x=>x.v):[])].filter(Number.isFinite);if(pts.length<2||!vals.length){s.innerHTML='<text x="320" y="110" text-anchor="middle" class="axis">Need 2+ scans</text>';return}let mn=Math.min(...vals),mx=Math.max(...vals);if(mn===mx){mn-=1;mx+=1}const x=i=>L+i*(W-L-R)/(pts.length-1),y=v=>T+(mx-v)*(H-T-B)/(mx-mn),path=a=>a.map((q,i)=>`${i?"L":"M"} ${x(i)} ${y(q.v)}`).join(" ");s.innerHTML=`<path d="${path(pts)}" class="line"/>${second?`<path d="${path(second)}" class="line second"/>`:""}`+pts.map((q,i)=>`<circle cx="${x(i)}" cy="${y(q.v)}" r="4" class="dot"><title>${dt(q.d)}: ${fmt(q.v)}</title></circle>`).join("")+(second?second.map((q,i)=>`<circle cx="${x(i)}" cy="${y(q.v)}" r="3" class="dot second"></circle>`).join(""):"")}
function regression(points){if(points.length<3)return null;const xb=points.reduce((a,p)=>a+p.x,0)/points.length,yb=points.reduce((a,p)=>a+p.y,0)/points.length;let n=0,d=0;for(const p of points){n+=(p.x-xb)*(p.y-yb);d+=(p.x-xb)**2}if(!d)return null;const slope=n/d,intercept=yb-slope*xb;let ssr=0,sst=0;for(const p of points){ssr+=(p.y-(intercept+slope*p.x))**2;sst+=(p.y-yb)**2}return {slope,r2:sst===0?1:Math.max(0,1-ssr/sst)}}
let analyticsContext=null;
async function analytics(){const key=$("analyticsProfile").value;if(!key)return;showActivity("Loading analytics","Fetching scan history and SKU observations…");const [slug,printing,condition,language]=key.split("|");const ss=scansCache.filter(s=>s.set_slug===slug&&s.printing===printing&&s.condition===condition&&s.language===language).sort((a,b)=>new Date(a.captured_at)-new Date(b.captured_at));const ids=ss.map(s=>s.scan_id);if(!ids.length){hideActivity();return}const all=await rest(`marketplace_scan_rows?select=scan_id,sku_id,product_id,product_name,collector_number,direct_available,direct_low,direct_listings,sales_rank,opportunity_score,flag,avg_daily_qty_sold&scan_id=in.(${ids.join(",")})`);const byScan=new Map(ids.map(id=>[id,[]]));all.forEach(r=>byScan.get(r.scan_id)?.push(r));const agg=ss.map(s=>{const rs=byScan.get(s.scan_id)||[];return {d:s.captured_at,q:sum(rs,"direct_available"),p:median(rs.map(r=>r.direct_low)),l:sum(rs,"direct_listings"),hot:rs.filter(r=>r.flag==="HOT").length,watch:rs.filter(r=>r.flag==="WATCH").length}});const first=agg[0],last=agg.at(-1);$("analyticsStats").innerHTML=[["Scans",ss.length],["Direct qty",last.q.toLocaleString()],["Qty Δ",`${last.q-first.q>=0?"+":""}${(last.q-first.q).toLocaleString()}`],["Listings",last.l.toLocaleString()],["Median DL",money(last.p)],["HOT / WATCH",`${last.hot} / ${last.watch}`]].map(([a,b])=>`<div class=stat><span>${a}</span><strong>${b}</strong></div>`).join("");chart("qtyChart",agg.map(x=>({d:x.d,v:x.q})),v=>Math.round(v).toLocaleString());chart("priceChart",agg.map(x=>({d:x.d,v:x.p??0})),money);chart("listingChart",agg.map(x=>({d:x.d,v:x.l})),v=>Math.round(v).toLocaleString());chart("signalChart",agg.map(x=>({d:x.d,v:x.hot})),v=>Math.round(v),agg.map(x=>({d:x.d,v:x.watch})));const prevMap=new Map((byScan.get(ss.at(-2)?.scan_id)||[]).map(r=>[r.sku_id,r])),current=byScan.get(ss.at(-1).scan_id)||[],movers=[];for(const r of current){const p=prevMap.get(r.sku_id);if(!p)continue;movers.push({r,p,qd:Number(r.direct_available||0)-Number(p.direct_available||0),ld:Number(r.direct_listings||0)-Number(p.direct_listings||0),pd:Number(r.direct_low||0)-Number(p.direct_low||0),rd:Number(r.sales_rank||0)-Number(p.sales_rank||0),sd:Number(r.opportunity_score||0)-Number(p.opportunity_score||0)})}analyticsContext={ss,byScan,current,movers,all};renderMoversMobile();renderSignalsMobile();renderProductOptionsMobile();hideActivity()}
function renderMoversMobile(){if(!analyticsContext)return;const metric=$("moverSort").value,q=$("moverSearch").value.toLowerCase().trim(),field={inventory:"qd",price:"pd",listings:"ld",rank:"rd",score:"sd"}[metric];const arr=analyticsContext.movers.filter(x=>!q||x.r.product_name.toLowerCase().includes(q)).sort((a,b)=>Math.abs(b[field])-Math.abs(a[field]));$("movers").innerHTML=arr.slice(0,50).map(x=>`<tr data-sku="${x.r.sku_id}"><td>${x.r.product_name}</td><td>${x.qd>0?"+":""}${x.qd}</td><td>${x.ld>0?"+":""}${x.ld}</td><td>${x.pd>0?"+":""}$${x.pd.toFixed(2)}</td><td>${x.rd>0?"+":""}${x.rd}</td><td>${x.sd>0?"+":""}${x.sd}</td></tr>`).join("");document.querySelectorAll("#movers tr[data-sku]").forEach(tr=>tr.onclick=()=>openProductHistory(tr.dataset.sku))}
function renderSignalsMobile(){if(!analyticsContext)return;const sig=[];let newlyHot=0,depleting=0,rising=0,squeeze=0;for(const x of analyticsContext.movers){if(x.r.flag==="HOT"&&x.p.flag!=="HOT"){newlyHot++;sig.push(["New HOT",x.r,"Score moved into HOT"])}if(x.qd<=-5){depleting++;sig.push(["Inventory drop",x.r,`${Math.abs(x.qd)} fewer Direct copies`])}if(x.pd>0.5){rising++;sig.push(["Price rise",x.r,`Direct Low +$${x.pd.toFixed(2)}`])}if(x.qd<0&&x.ld<0&&x.pd>0){squeeze++;sig.push(["Supply squeeze",x.r,`Qty ${x.qd}, listings ${x.ld}, price +$${x.pd.toFixed(2)}`])}}$("signalCards").innerHTML=[["New HOT",newlyHot],["Qty falling",depleting],["Price rising",rising],["Supply squeeze",squeeze]].map(([a,b])=>`<div class=signal-card><span>${a}</span><strong>${b}</strong></div>`).join("");const priority={"Supply squeeze":4,"New HOT":3,"Inventory drop":2,"Price rise":1};sig.sort((a,b)=>priority[b[0]]-priority[a[0]]);$("signalsBody").innerHTML=sig.slice(0,50).map(x=>`<tr data-sku="${x[1].sku_id}"><td>${x[0]}</td><td>${x[1].product_name}</td><td>${x[2]}</td></tr>`).join("");document.querySelectorAll("#signalsBody tr[data-sku]").forEach(tr=>tr.onclick=()=>openProductHistory(tr.dataset.sku))}
function renderProductOptionsMobile(){if(!analyticsContext)return;const q=$("productHistorySearch").value.toLowerCase().trim(),unique=new Map();for(const r of analyticsContext.current)unique.set(r.sku_id,r);const rows=[...unique.values()].filter(r=>!q||r.product_name.toLowerCase().includes(q)||r.sku_id.includes(q)).sort((a,b)=>a.product_name.localeCompare(b.product_name)),old=$("productHistorySelect").value;$("productHistorySelect").innerHTML=rows.slice(0,500).map(r=>`<option value="${r.sku_id}">${r.product_name}${r.collector_number?` #${r.collector_number}`:""}</option>`).join("");if(rows.some(r=>r.sku_id===old))$("productHistorySelect").value=old;if($("productHistorySelect").value)renderProductHistoryMobile($("productHistorySelect").value)}
function openProductHistory(sku){document.querySelectorAll(".analytics-tab").forEach(b=>b.classList.toggle("active",b.dataset.panel==="productPanel"));document.querySelectorAll(".analytics-panel").forEach(p=>p.classList.toggle("active",p.id==="productPanel"));$("productHistorySelect").value=sku;renderProductHistoryMobile(sku)}
function renderProductHistoryMobile(sku){if(!analyticsContext)return;const rows=analyticsContext.ss.map(s=>({s,r:(analyticsContext.byScan.get(s.scan_id)||[]).find(r=>r.sku_id===sku)})).filter(x=>x.r),latest=rows.at(-1)?.r;if(!latest)return;const qpts=rows.map(x=>({d:x.s.captured_at,v:Number(x.r.direct_available||0)})),ppts=rows.map(x=>({d:x.s.captured_at,v:Number(x.r.direct_low||0)}));$("productHistorySummary").innerHTML=[["Card",latest.product_name],["SKU",latest.sku_id],["Direct qty",latest.direct_available],["Direct Low",money(latest.direct_low)],["Listings",latest.direct_listings],["Score",latest.opportunity_score]].map(([a,b])=>`<div class=stat><span>${a}</span><strong>${b}</strong></div>`).join("");chart("productQtyChart",qpts,v=>Math.round(v));chart("productPriceChart",ppts,money);const t0=new Date(rows[0].s.captured_at).getTime(),day=86400000,qreg=regression(rows.map(x=>({x:(new Date(x.s.captured_at)-t0)/day,y:Number(x.r.direct_available||0)}))),preg=regression(rows.map(x=>({x:(new Date(x.s.captured_at)-t0)/day,y:Number(x.r.direct_low||0)})));let txt="Need at least 3 observations for a directional read.";if(qreg&&preg){const q7=qreg.slope*7,p7=preg.slope*7;txt=`7-day directional read: Direct qty ${q7>=0?"+":""}${q7.toFixed(1)} copies; Direct Low ${p7>=0?"+":""}$${p7.toFixed(2)}. Confidence is ${Math.min(qreg.r2,preg.r2)>.65?"higher":Math.min(qreg.r2,preg.r2)>.3?"moderate":"low"} (trend fit only; not a market forecast).`}$("productPrediction").innerHTML=`<b>Trend read</b><div>${txt}</div>`}

async function load(){
  const s=await valid();
  if(!s)return boot();
  try{
    showActivity("Refreshing dashboard","Loading requests, scan history, and analytics…");
    const [dev,cmd,scans]=await Promise.all([
      rest("marketplace_devices?select=*&order=last_seen.desc&limit=1"),
      rest("marketplace_scan_commands?select=*&order=created_at.desc&limit=30"),
      rest("marketplace_scans?select=*&order=captured_at.desc&limit=100")
    ]);
    scansCache=scans;
    $("device").innerHTML=dev.length?`${dev[0].name||dev[0].device_id} • last seen ${dt(dev[0].last_seen)} • ${dev[0].app_version||""}`:"No PC has checked in yet.";
    $("commands").innerHTML=cmd.length?cmd.map(x=>`<div class="item"><div><b>${x.profile_json?.setName||x.profile_json?.setSlug}</b><div class="meta">${x.profile_json?.printing} • ${x.profile_json?.condition} • ${x.profile_json?.language} • ${dt(x.created_at)}</div>${requestProgressHtml(x)}${x.error_message?`<div class="error">${x.error_message}</div>`:""}</div><span class="pill ${x.status}">${x.status}</span></div>`).join(""):"No requests yet.";
    $("scans").innerHTML=scans.length?scans.slice(0,30).map(x=>`<div class="item"><div><b>${x.set_name}</b><div class="meta">${x.printing} • ${x.condition} • ${x.language}</div></div><div><b>${x.unique_skus} SKUs</b><div class="meta">${dt(x.captured_at)}</div></div></div>`).join(""):"No scans uploaded yet.";
    const groups={};scans.forEach(s=>{const k=[s.set_slug,s.printing,s.condition,s.language].join("|");groups[k]??=[];groups[k].push(s)});
    $("profiles").innerHTML=Object.entries(groups).map(([k,a])=>`<div class="profile"><b>${a[0].set_name}</b><span>${a[0].printing} • ${a[0].condition} • ${a[0].language}</span><span>${a.length} scans • latest ${dt(a[0].captured_at)}</span><button data-profile="${k}">Analyze</button></div>`).join("");
    $("analyticsProfile").innerHTML=Object.entries(groups).map(([k,a])=>`<option value="${k}">${a[0].set_name} • ${a[0].printing} • ${a[0].condition} • ${a[0].language}</option>`).join("");
    document.querySelectorAll("button[data-profile]").forEach(b=>b.onclick=()=>{$("analyticsProfile").value=b.dataset.profile;analytics()});
    if($("analyticsProfile").value)await analytics();
    await loadSetCatalog(false);
    hideActivity();
  }catch(e){
    showActivity("Load failed",e.message);
  }
}
async function boot(){document.getElementById("appVersion").textContent=`web v${WEB_APP_VERSION}`;const s=await valid();$("login").hidden=!!s;$("app").hidden=!s;if(s)load()}
$("signIn").onclick=login;$("refresh").onclick=load;$("signOut").onclick=()=>{save(null);boot()};$("queueNew").onclick=queueNew;
$("refreshSetCatalog").onclick=async()=>{
  try{
    showActivity("Refreshing set catalog","Downloading latest set list from cloud…");
    await loadSetCatalog(true);
    hideActivity();
  }catch(e){
    showActivity("Set refresh failed",e.message);
  }
};
$("analyticsProfile").onchange=analytics;$("moverSort").onchange=renderMoversMobile;$("moverSearch").oninput=renderMoversMobile;$("productHistorySearch").oninput=renderProductOptionsMobile;$("productHistorySelect").onchange=e=>renderProductHistoryMobile(e.target.value);
document.querySelectorAll(".analytics-tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".analytics-tab").forEach(x=>x.classList.toggle("active",x===b));document.querySelectorAll(".analytics-panel").forEach(p=>p.classList.toggle("active",p.id===b.dataset.panel))});
boot();
setInterval(async()=>{
  if($("app").hidden)return;
  try{
    const cmd=await rest("marketplace_scan_commands?select=*&order=created_at.desc&limit=30");
    $("commands").innerHTML=cmd.length?cmd.map(x=>`<div class="item"><div><b>${x.profile_json?.setName||x.profile_json?.setSlug}</b><div class="meta">${x.profile_json?.printing} • ${x.profile_json?.condition} • ${x.profile_json?.language} • ${dt(x.created_at)}</div>${requestProgressHtml(x)}${x.error_message?`<div class="error">${x.error_message}</div>`:""}</div><span class="pill ${x.status}">${x.status}</span></div>`).join(""):"No requests yet.";
  }catch(e){}
},15000);

/* ===== v032.js ===== */
(()=>{
  const $=id=>document.getElementById(id);
  const money=v=>v==null?"—":`$${Number(v).toFixed(2)}`;
  const dt=v=>v?new Date(v).toLocaleString():"—";
  function profileKey(s){return [s.set_slug,s.printing,s.condition,s.language].join("|")}
  async function r(path){return await rest(path)}
  async function scannerImages(productIds){
    const ids=[...new Set(productIds.filter(Boolean).map(Number))];
    const out=new Map();
    for(let i=0;i<ids.length;i+=100){
      try{
        const rows=await fetch(`https://api.scryfall.com/cards/collection`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({identifiers:ids.slice(i,i+100).map(id=>({tcgplayer_id:id}))})}).then(x=>x.json());
        for(const card of rows.data||[]){const pid=Number(card.tcgplayer_id);out.set(pid,card.image_uris?.normal||card.card_faces?.[0]?.image_uris?.normal||"")}
      }catch{}
    }
    return out;
  }
  async function currentRowsForProfile(key){
    const ss=scansCache.filter(s=>profileKey(s)===key).sort((a,b)=>new Date(b.captured_at)-new Date(a.captured_at));
    if(!ss.length)return[];
    return await r(`marketplace_scan_rows?select=*&scan_id=eq.${ss[0].scan_id}&order=opportunity_score.desc&limit=1000`)
  }
  async function latestHistoryBySku(key,days){
    const cutoff=days?Date.now()-days*86400000:0;
    const ss=scansCache.filter(s=>profileKey(s)===key&&new Date(s.captured_at).getTime()>=cutoff).sort((a,b)=>new Date(a.captured_at)-new Date(b.captured_at));
    if(!ss.length)return {ss,rows:[]};
    const ids=ss.map(s=>s.scan_id);
    const rows=[];
    for(let i=0;i<ids.length;i+=40){rows.push(...await r(`marketplace_scan_rows?select=scan_id,sku_id,product_id,product_name,collector_number,printing,condition,language,direct_low,direct_available,direct_listings,sku_market_price,opportunity_score,flag,sales_rank,avg_daily_qty_sold&scan_id=in.(${ids.slice(i,i+40).join(",")})`))}
    return {ss,rows}
  }
  function historyMap(ss,rows){
    const scanMap=new Map(ss.map(s=>[s.scan_id,s]));
    const m=new Map();
    for(const row of rows){const x={...row,captured_at:scanMap.get(row.scan_id)?.captured_at};if(!m.has(row.sku_id))m.set(row.sku_id,[]);m.get(row.sku_id).push(x)}
    for(const a of m.values())a.sort((x,y)=>new Date(x.captured_at)-new Date(y.captured_at));
    return m;
  }
  function delta(a,b,k){return Number(b?.[k]||0)-Number(a?.[k]||0)}
  function pctDelta(a,b,k){const x=Number(a?.[k]||0),y=Number(b?.[k]||0);return x?100*(y-x)/x:0}
  function simpleSpark(values,w=92,h=28){
    const vals=values.filter(Number.isFinite);if(vals.length<2)return"";let mn=Math.min(...vals),mx=Math.max(...vals);if(mn===mx){mn-=1;mx+=1}
    const pts=vals.map((v,i)=>`${i*(w-2)/(vals.length-1)+1},${1+(mx-v)*(h-2)/(mx-mn)}`).join(" ");return `<svg class="spark" viewBox="0 0 ${w} ${h}"><polyline points="${pts}"/></svg>`
  }
  function showScoutLoading(on,msg="Loading Scout…"){
    let el=$("scoutLoading");if(!el){el=document.createElement("div");el.id="scoutLoading";el.className="scout-loading";$("leaderStatus")?.parentNode?.insertBefore(el,$("leaderStatus"))}
    el.innerHTML=on?`<span class="spinner"></span><b>${msg}</b>`:"";el.hidden=!on;
  }
  async function renderVisualLeaderboard(){
    const key=$("leaderProfile")?.value||$("analyticsProfile")?.value;if(!key)return;
    showScoutLoading(true,"Ranking opportunities…");
    try{
      const days=Number($("leaderPeriod")?.value||7),minPrice=Number($("leaderMinPrice")?.value||0),metric=$("leaderMetric")?.value||"composite",printing=$("leaderPrinting")?.value||"",condition=$("leaderCondition")?.value||"";
      const {ss,rows}=await latestHistoryBySku(key,days);const by=historyMap(ss,rows),cards=[];
      for(const [sku,a] of by){const first=a[0],last=a.at(-1);if(!last||Number(last.direct_low||0)<minPrice)continue;if(printing&&last.printing!==printing)continue;if(condition&&last.condition!==condition)continue;const seen=a.length,hot=a.filter(x=>x.flag==="HOT"||x.flag==="WATCH").length,qtyD=delta(first,last,"direct_available"),priceD=delta(first,last,"direct_low"),rankD=delta(first,last,"sales_rank"),score=Number(last.opportunity_score||0),persist=seen?hot/seen:0,depletion=-qtyD,pricePct=pctDelta(first,last,"direct_low"),rankImprove=-rankD;const comp=score*.35+persist*100*.25+Math.max(-30,Math.min(30,depletion))*1+Math.max(-30,Math.min(30,pricePct))*.4+Math.max(-50,Math.min(50,rankImprove/10))*.2;cards.push({sku,a,last,score,persist,qtyD,priceD,rankD,comp})}
      const get={composite:x=>x.comp,score:x=>x.score,persistence:x=>x.persist*100,depletion:x=>-x.qtyD,price:x=>x.priceD,rank:x=>-x.rankD}[metric]|| (x=>x.comp);cards.sort((a,b)=>get(b)-get(a));const imgs=await scannerImages(cards.slice(0,80).map(x=>x.last.product_id));
      $("leaderVisual").innerHTML=cards.slice(0,80).map((x,i)=>`<article class="leader-card" data-sku="${x.sku}"><div class="leader-rank">#${i+1}</div><img src="${imgs.get(Number(x.last.product_id))||""}" loading="lazy"><div class="leader-copy"><h3>${x.last.product_name}</h3><div class="meta">${x.last.printing} • ${x.last.condition} • SKU ${x.sku}</div><div class="leader-stats"><span>Direct <b>${x.last.direct_available}</b></span><span>DL <b>${money(x.last.direct_low)}</b></span><span>Score <b>${x.score}</b></span><span>Seen <b>${x.a.length}</b></span></div><div class="leader-trends"><span class="${x.qtyD<0?"good":x.qtyD>0?"bad":""}">Qty ${x.qtyD>0?"+":""}${x.qtyD}</span><span class="${x.priceD>0?"good":x.priceD<0?"bad":""}">Price ${x.priceD>0?"+":""}${money(x.priceD)}</span><span>${simpleSpark(x.a.map(z=>Number(z.direct_low||0)))}</span></div></div></article>`).join("");
      $("leaderStatus").textContent=`${cards.length.toLocaleString()} exact-SKU opportunities across ${ss.length} scans.`;
      document.querySelectorAll(".leader-card").forEach(c=>c.onclick=()=>openProductHistory(c.dataset.sku));
    }finally{showScoutLoading(false)}
  }
  function install(){
    const sec=[...document.querySelectorAll("section.card")].find(s=>s.querySelector("h2")?.textContent.includes("Cross-scan opportunity leaderboard"));if(!sec||$("leaderVisual"))return false;
    const controls=sec.querySelector(".leaderboard-controls");if(controls&&!$("leaderProfile")){const label=document.createElement("label");label.innerHTML='Profile<select id="leaderProfile"></select>';controls.prepend(label)}
    const old=sec.querySelector(".table-wrap.leaderboard-table");if(old)old.style.display="none";
    const vis=document.createElement("div");vis.id="leaderVisual";vis.className="leader-visual-grid";old?.parentNode?.insertBefore(vis,old);
    const help=document.createElement("div");help.className="leader-help";help.id="leaderHelp";help.innerHTML='<b>Scout ranking</b><span>Uses persistence, Direct depletion, price movement, rank improvement, and latest opportunity score. Click a card to open exact-SKU history.</span>';vis.parentNode.insertBefore(help,vis);
    const loadProfiles=()=>{const groups={};scansCache.forEach(s=>{const k=profileKey(s);groups[k]??=s});const old=$("leaderProfile").value;$("leaderProfile").innerHTML=Object.entries(groups).map(([k,s])=>`<option value="${k}">${s.set_name} • ${s.printing} • ${s.condition}</option>`).join("");if(groups[old])$("leaderProfile").value=old};
    $("leaderRefresh").onclick=renderVisualLeaderboard;["leaderProfile","leaderPeriod","leaderPrinting","leaderCondition","leaderMinPrice","leaderMetric"].forEach(id=>$(id).onchange=renderVisualLeaderboard);
    const baseLoad=window.load;if(typeof baseLoad==="function"){window.load=async function(...a){const r=await baseLoad.apply(this,a);loadProfiles();if($("leaderProfile").value)renderVisualLeaderboard();return r}}
    setTimeout(()=>{loadProfiles();if($("leaderProfile").value)renderVisualLeaderboard()},700);
    return true;
  }
  let tries=0;const t=setInterval(()=>{tries++;if(install()||tries>80)clearInterval(t)},100);
})();

/* ===== v033.js ===== */
(()=>{
  const $=id=>document.getElementById(id),dt=v=>v?new Date(v).toLocaleString():"—",money=v=>v==null?"—":`$${Number(v).toFixed(2)}`;
  let cardSearchTimer=null;
  async function cloud(path){return await rest(path)}
  async function globalSearch(){
    const q=$("globalCardSearch").value.trim();if(!q){$("globalCardResults").innerHTML="";$("globalCardSearchStatus").textContent="";return}
    $("globalCardSearchStatus").textContent="Searching cloud scans…";
    try{
      let rows=[];
      if(/^\d+$/.test(q)){
        const [sku,pid]=await Promise.all([
          cloud(`marketplace_scan_rows?select=*&sku_id=eq.${encodeURIComponent(q)}&order=captured_at.desc&limit=100`),
          cloud(`marketplace_scan_rows?select=*&product_id=eq.${encodeURIComponent(q)}&order=captured_at.desc&limit=100`)
        ]);rows=[...sku,...pid]
      }else{
        rows=await cloud(`marketplace_scan_rows?select=*&product_name=ilike.*${encodeURIComponent(q)}*&order=captured_at.desc&limit=100`)
      }
      const seen=new Set();rows=rows.filter(r=>{const k=`${r.scan_id}|${r.sku_id}`;if(seen.has(k))return false;seen.add(k);return true});
      $("globalCardSearchStatus").textContent=`${rows.length} matching observations`;
      $("globalCardResults").innerHTML=rows.slice(0,80).map(r=>`<div class="global-card-hit" data-sku="${r.sku_id}"><div><b>${r.product_name}</b><div class="meta">${r.set_name||""} • ${r.printing} • ${r.condition} • SKU ${r.sku_id}</div></div><div><b>${money(r.direct_low)}</b><div class="meta">Direct ${r.direct_available} • Score ${r.opportunity_score}</div></div></div>`).join("")||'<div class="meta">No matches.</div>';
      document.querySelectorAll(".global-card-hit").forEach(x=>x.onclick=()=>window.openProductHistory?.(x.dataset.sku));
    }catch(e){$("globalCardSearchStatus").textContent=e.message}
  }
  function installGlobalSearch(){
    if(!$("globalCardSearch"))return false;$("globalCardSearchBtn").onclick=globalSearch;$("globalCardSearch").addEventListener("input",()=>{clearTimeout(cardSearchTimer);cardSearchTimer=setTimeout(globalSearch,350)});return true
  }

  function setProfiles(){
    const sel=$("analyticsProfile"),leader=$("leaderProfile");if(!sel||!leader)return;
    const opts=[...sel.options].map(o=>({v:o.value,t:o.textContent}));const old=leader.value;leader.innerHTML=opts.map(o=>`<option value="${o.v}">${o.t}</option>`).join("");if(opts.some(o=>o.v===old))leader.value=old;
  }
  function enhanceLoading(){
    if($("activityBanner")&&!$("activityBanner").dataset.modern){$("activityBanner").dataset.modern="1";const copy=$("activityBanner").querySelector("div:last-child");if(copy&&!copy.querySelector(".activity-track")){const tr=document.createElement("div");tr.className="activity-track";tr.innerHTML='<span></span>';copy.appendChild(tr)}}
  }
  function refreshProfileLinks(){document.querySelectorAll("button[data-profile]").forEach(b=>b.onclick=()=>{const a=$("analyticsProfile");if(a)a.value=b.dataset.profile;a?.dispatchEvent(new Event("change"))})}
  function install(){
    if(!installGlobalSearch())return false;enhanceLoading();setProfiles();refreshProfileLinks();
    return true
  }
  let tries=0;const t=setInterval(()=>{tries++;if(install()||tries>80)clearInterval(t)},100);
})();

/* ===== v035.js ===== */
(()=>{
  const $=id=>document.getElementById(id);
  function install(){
    const head=document.querySelector("header");if(!head||$("themeToggle"))return false;
    const btn=document.createElement("button");btn.id="themeToggle";btn.className="theme-toggle";btn.type="button";head.appendChild(btn);
    const apply=()=>{const dark=localStorage.getItem("collectishTheme")==="dark";document.documentElement.dataset.theme=dark?"dark":"light";btn.textContent=dark?"☀ Light":"☾ Dark"};
    btn.onclick=()=>{localStorage.setItem("collectishTheme",document.documentElement.dataset.theme==="dark"?"light":"dark");apply()};
    apply();return true
  }
  let n=0,t=setInterval(()=>{n++;if(install()||n>50)clearInterval(t)},100)
})();

/* ===== v036.js ===== */
(()=>{
  const $=id=>document.getElementById(id);
  const fmt=(v,d=0)=>Number(v||0).toLocaleString(undefined,{maximumFractionDigits:d});
  function currentLeaderCards(){return [...document.querySelectorAll("#leaderVisual .leader-card")].map((el,i)=>({el,i,sku:el.dataset.sku,title:el.querySelector("h3")?.textContent||"",text:el.textContent}))}
  function installFilters(){
    const sec=$("leaderVisual")?.closest("section.card");if(!sec||$("leaderQuickFilters"))return false;
    const box=document.createElement("div");box.id="leaderQuickFilters";box.className="leader-quick-filters";box.innerHTML='<button data-qf="all" class="active">All</button><button data-qf="hot">HOT</button><button data-qf="watch">WATCH</button><button data-qf="thin">Thin supply</button><button data-qf="rising">Price rising</button><button data-qf="depleting">Qty falling</button>';
    $("leaderHelp")?.insertAdjacentElement("afterend",box);
    box.onclick=e=>{const b=e.target.closest("button[data-qf]");if(!b)return;box.querySelectorAll("button").forEach(x=>x.classList.toggle("active",x===b));const k=b.dataset.qf;currentLeaderCards().forEach(x=>{const t=x.text.toLowerCase();x.el.hidden=!(k==="all"||(k==="hot"&&t.includes("hot"))||(k==="watch"&&t.includes("watch"))||(k==="thin"&&(t.includes("thin")||t.includes("direct 0")||t.includes("direct 1")||t.includes("direct 2")||t.includes("direct 3")))||(k==="rising"&&/price \+\$/.test(t))||(k==="depleting"&&/qty -/.test(t)))})};
    return true
  }
  function installMode(){
    const sec=$("leaderVisual")?.closest("section.card");if(!sec||$("leaderViewMode"))return false;
    const s=document.createElement("select");s.id="leaderViewMode";s.innerHTML='<option value="cards">Cards</option><option value="compact">Compact</option>';s.onchange=()=>sec.classList.toggle("leader-compact",s.value==="compact");sec.querySelector(".toolbar")?.appendChild(s);return true
  }
  function install(){return installFilters()|installMode()}
  let n=0,t=setInterval(()=>{n++;install();if(n>100)clearInterval(t)},100);
})();

/* ===== v038.js ===== */
(()=>{
  const $=id=>document.getElementById(id);
  function installShell(){
    const app=$("app");if(!app||$("mobileProductShell"))return false;
    const shell=document.createElement("div");shell.id="mobileProductShell";shell.className="mobile-product-shell";
    shell.innerHTML='<nav class="mobile-product-nav"><button data-mobile-page="scout" class="active">Scout</button><button data-mobile-page="cards">Cards</button><button data-mobile-page="more">More</button></nav><section class="mobile-product-page active" data-mobile-page="scout"><div class="mobile-page-head"><h2>Scout</h2><span>Opportunity discovery</span></div></section><section class="mobile-product-page" data-mobile-page="cards"><div class="mobile-page-head"><h2>Cards</h2><span>Search and exact-SKU history</span></div></section><section class="mobile-product-page" data-mobile-page="more"><div class="mobile-page-head"><h2>More</h2><span>Scans, profiles, requests, and PC status</span></div></section>';
    app.prepend(shell);
    const pages={scout:shell.querySelector('[data-mobile-page="scout"]'),cards:shell.querySelector('[data-mobile-page="cards"]'),more:shell.querySelector('[data-mobile-page="more"]')};
    const sections=[...app.children].filter(x=>x.tagName==="SECTION"&&x!==shell);
    for(const s of sections){const h=(s.querySelector("h2")?.textContent||"").toLowerCase();if(h.includes("cross-scan"))pages.scout.appendChild(s);else if(h.includes("find any")||h.includes("mobile analytics"))pages.cards.appendChild(s);else pages.more.appendChild(s)}
    shell.querySelectorAll(".mobile-product-nav button").forEach(b=>b.onclick=()=>{shell.querySelectorAll(".mobile-product-nav button").forEach(x=>x.classList.toggle("active",x===b));shell.querySelectorAll(".mobile-product-page").forEach(x=>x.classList.toggle("active",x.dataset.mobilePage===b.dataset.mobilePage));window.scrollTo({top:0,behavior:"auto"})});
    return true
  }
  let n=0,t=setInterval(()=>{n++;if(installShell()||n>80)clearInterval(t)},100)
})();

/* ===== v039.js ===== */
(()=>{
  const $=id=>document.getElementById(id);
  function install(){
    const scout=document.querySelector('.mobile-product-page[data-mobile-page="scout"]');if(!scout||$("mobileScoutStats"))return false;
    const stats=document.createElement("div");stats.id="mobileScoutStats";stats.className="mobile-scout-stats";stats.innerHTML='<div><span>Visible</span><b id="mobileVisibleCount">—</b></div><div><span>HOT</span><b id="mobileHotCount">—</b></div><div><span>WATCH</span><b id="mobileWatchCount">—</b></div><div><span>Thin</span><b id="mobileThinCount">—</b></div>';scout.querySelector(".mobile-page-head")?.insertAdjacentElement("afterend",stats);
    const update=()=>{const cards=[...document.querySelectorAll("#leaderVisual .leader-card")].filter(x=>!x.hidden),txt=cards.map(x=>x.textContent.toLowerCase());$("mobileVisibleCount").textContent=cards.length;$("mobileHotCount").textContent=txt.filter(x=>x.includes("hot")).length;$("mobileWatchCount").textContent=txt.filter(x=>x.includes("watch")).length;$("mobileThinCount").textContent=txt.filter(x=>x.includes("thin")||/direct [0-3]\b/.test(x)).length};
    new MutationObserver(update).observe($("leaderVisual"),{childList:true,subtree:true,attributes:true,attributeFilter:["hidden"]});setInterval(update,1000);update();return true
  }
  let n=0,t=setInterval(()=>{n++;if(install()||n>100)clearInterval(t)},100)
})();

/* ===== v042.js ===== */
(()=>{
  const $=id=>document.getElementById(id);
  function install(){
    const cards=document.querySelector('.mobile-product-page[data-mobile-page="cards"]');if(!cards||$("mobileCardHome"))return false;
    const box=document.createElement("section");box.id="mobileCardHome";box.className="card mobile-card-home";box.innerHTML='<div class="toolbar"><div><h2>Card lookup</h2><div class="meta">Search all cloud observations, then open exact-SKU history.</div></div></div><div class="mobile-card-search"><input id="mobileCardQuery" placeholder="Card name / SKU / Product ID"><button id="mobileCardGo">Search</button></div><div id="mobileCardResults" class="mobile-card-results"></div>';
    cards.querySelector(".mobile-page-head")?.insertAdjacentElement("afterend",box);
    const run=async()=>{const q=$("mobileCardQuery").value.trim();if(!q)return;$("globalCardSearch").value=q;$("globalCardSearchBtn").click();await new Promise(r=>setTimeout(r,450));$("mobileCardResults").innerHTML=$("globalCardResults").innerHTML;$("mobileCardResults").querySelectorAll(".global-card-hit").forEach(x=>x.onclick=()=>window.openProductHistory?.(x.dataset.sku))};
    $("mobileCardGo").onclick=run;$("mobileCardQuery").onkeydown=e=>{if(e.key==="Enter")run()};return true
  }
  let n=0,t=setInterval(()=>{n++;if(install()||n>100)clearInterval(t)},100)
})();

/* ===== v047.js ===== */
(()=>{
  const $=id=>document.getElementById(id);
  function install(){
    const scout=document.querySelector('.mobile-product-page[data-mobile-page="scout"]');if(!scout||$("scoutSavedViews"))return false;
    const sec=[...scout.querySelectorAll("section.card")].find(s=>s.querySelector("h2")?.textContent.includes("Cross-scan"));if(!sec)return false;
    const box=document.createElement("div");box.id="scoutSavedViews";box.className="scout-saved-views";box.innerHTML='<select id="savedScoutView"><option value="">Saved view…</option></select><button id="saveScoutView">Save current</button><button id="deleteScoutView">Delete</button>';sec.querySelector(".leaderboard-controls")?.insertAdjacentElement("afterend",box);
    const key="collectishScoutViews",read=()=>{try{return JSON.parse(localStorage.getItem(key)||"[]")}catch{return[]}},write=a=>localStorage.setItem(key,JSON.stringify(a)),render=()=>{$("savedScoutView").innerHTML='<option value="">Saved view…</option>'+read().map((x,i)=>`<option value="${i}">${x.name}</option>`).join("")};
    $("saveScoutView").onclick=()=>{const name=prompt("View name");if(!name)return;const ids=["leaderProfile","leaderPeriod","leaderPrinting","leaderCondition","leaderMinPrice","leaderMetric"],v={name,values:Object.fromEntries(ids.map(id=>[id,$(id)?.value]))};const a=read();a.push(v);write(a);render()};
    $("deleteScoutView").onclick=()=>{const i=Number($("savedScoutView").value);if(!Number.isInteger(i))return;const a=read();a.splice(i,1);write(a);render()};
    $("savedScoutView").onchange=()=>{const v=read()[Number($("savedScoutView").value)];if(!v)return;Object.entries(v.values||{}).forEach(([id,val])=>{if($(id))$(id).value=val});$("leaderRefresh").click()};render();return true
  }
  let n=0,t=setInterval(()=>{n++;if(install()||n>100)clearInterval(t)},100)
})();

/* ===== v048.js ===== */
(()=>{
  const $=id=>document.getElementById(id);
  function install(){
    const nav=document.querySelector(".mobile-product-nav");if(!nav||$("mobileThemeQuick"))return false;
    const b=document.createElement("button");b.id="mobileThemeQuick";b.textContent="Theme";b.onclick=()=>$("themeToggle")?.click();nav.appendChild(b);return true
  }
  let n=0,t=setInterval(()=>{n++;if(install()||n>100)clearInterval(t)},100)
})();

/* ===== v050.js ===== */
(()=>{
  const VERSION="0.5.0",el=id=>document.getElementById(id);
  const setBadge=()=>{const b=el("appVersion");if(b)b.textContent=`web v${VERSION}`};setBadge();
  const pages=["scout","cards","sales","direct","money","operations"];
  function install(){
    const app=el("app");if(!app||el("collectishProductNav"))return false;
    const nav=document.createElement("nav");nav.id="collectishProductNav";nav.className="collectish-product-nav";nav.innerHTML=pages.map(p=>`<button data-page="${p}">${p[0].toUpperCase()+p.slice(1)}</button>`).join("");app.prepend(nav);
    const placeholders={sales:"Seller sales",direct:"Direct / SYP",money:"Money",operations:"Operations"};
    for(const [p,title] of Object.entries(placeholders)){if(el(`collectish${p[0].toUpperCase()+p.slice(1)}Page`))continue;const s=document.createElement("section");s.id=`collectish${p[0].toUpperCase()+p.slice(1)}Page`;s.className="collectish-product-page";s.dataset.collectishPage=p;s.innerHTML=`<div class="mobile-page-head"><h2>${title}</h2><span>Loading cloud data…</span></div>`;app.appendChild(s)}
    return true
  }
  let tries=0,t=setInterval(()=>{tries++;setBadge();if(install()||tries>120)clearInterval(t)},100)
})();

/* ===== v051.js ===== */
(()=>{
  const $=id=>document.getElementById(id);
  function install(){
    const login=$("login");if(!login||$("forgotPassword"))return false;
    const b=document.createElement("button");b.id="forgotPassword";b.type="button";b.className="link-button";b.textContent="Forgot password?";login.appendChild(b);
    b.onclick=async()=>{const email=$("email").value.trim();if(!email){$("msg").textContent="Enter your email first.";return}try{const r=await fetch(`${window.COLLECTISH_CONFIG.supabaseUrl}/auth/v1/recover`,{method:"POST",headers:{apikey:window.COLLECTISH_CONFIG.publishableKey,"Content-Type":"application/json"},body:JSON.stringify({email,redirect_to:location.href})});$("msg").textContent=r.ok?"Password reset email sent.":"Could not send reset email."}catch(e){$("msg").textContent=e.message}};return true
  }
  let n=0,t=setInterval(()=>{n++;if(install()||n>100)clearInterval(t)},100)
})();

/* ===== v052.js ===== */
(()=>{document.documentElement.dataset.theme=localStorage.getItem("collectishTheme")||"light"})();

/* ===== v054.js ===== */
// Collectish web v0.5.4 — cloud job queue + data health + accurate cloud KPIs
(() => {
  const VERSION="0.5.4", el=id=>document.getElementById(id);
  const setBadge=()=>{const b=el("appVersion");if(b)b.textContent=`web v${VERSION}`};
  setBadge();
  if(!document.querySelector('link[data-collectish-v054]')){const l=document.createElement('link');l.rel='stylesheet';l.href='v054.css?v=054';l.dataset.collectishV054='1';document.head.appendChild(l)}

  async function exactCount(table,filter=""){
    const s=await valid();if(!s)throw Error("Sign in required");
    const url=`${c.supabaseUrl}/rest/v1/${table}?select=*&limit=1${filter?`&${filter}`:""}`;
    const r=await fetch(url,{headers:{...H(s.token),Prefer:"count=exact",Range:"0-0"}});
    if(!r.ok)throw Error(`Count ${table}: HTTP ${r.status}`);
    const cr=r.headers.get("content-range")||"";const m=cr.match(/\/(\d+|\*)$/);return m&&m[1]!=="*"?Number(m[1]):0;
  }
  async function bounds(table,dateField){
    const [a,b]=await Promise.all([
      rest(`${table}?select=${dateField}&${dateField}=not.is.null&order=${dateField}.asc&limit=1`),
      rest(`${table}?select=${dateField}&${dateField}=not.is.null&order=${dateField}.desc&limit=1`)
    ]);
    return {oldest:a?.[0]?.[dateField]||null,newest:b?.[0]?.[dateField]||null};
  }
  const fmt=v=>v?new Date(v).toLocaleString():"—";
  const money=v=>`$${Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;

  function installOperationsPanels(){
    if(!el("collectishProductNav")||el("collectishCloudHealth"))return false;
    document.querySelectorAll('.mobile-product-nav').forEach(n=>n.classList.add('collectish-legacy-nav-hidden'));
    const app=el("app");if(!app)return false;
    const health=document.createElement('section');health.id='collectishCloudHealth';health.className='card collectish-ops-panel';health.dataset.collectishPage='operations';
    health.innerHTML=`<div class="toolbar"><div><h2>Cloud data health</h2><div class="meta">Canonical Collectish cloud coverage by source.</div></div><button id="refreshCloudHealth">Refresh</button></div><div id="cloudHealthGrid" class="collectish-health-grid"><div class="meta">Loading…</div></div>`;
    const jobs=document.createElement('section');jobs.id='collectishJobs';jobs.className='card collectish-ops-panel';jobs.dataset.collectishPage='operations';
    jobs.innerHTML=`<div class="toolbar"><div><h2>Collectish jobs</h2><div class="meta">Durable cloud work queue. Marketplace Scout PC v0.15.3+ can claim Marketplace scan jobs.</div></div><button id="refreshCollectishJobs">Refresh</button></div><div id="collectishJobSummary" class="collectish-job-summary"></div><div class="table-wrap"><table><thead><tr><th>Created</th><th>Source / action</th><th>Status</th><th>Progress</th><th>Executor</th><th>Error</th></tr></thead><tbody id="collectishJobBody"></tbody></table></div>`;
    app.append(health,jobs);
    el('refreshCloudHealth').onclick=loadHealth;el('refreshCollectishJobs').onclick=loadJobs;
    loadHealth().catch(()=>{});loadJobs().catch(()=>{});
    return true;
  }

  async function loadHealth(){
    const host=el('cloudHealthGrid');if(!host)return;host.innerHTML='<div class="meta">Refreshing cloud coverage…</div>';
    const specs=[
      ['Marketplace scans','marketplace_scans','captured_at',''],
      ['Seller orders','seller_orders','order_date',''],
      ['Payments','seller_payments','initiated_on',''],
      ['RIs','reimbursement_invoices','created_date',''],
      ['SYP snapshots','syp_snapshots','captured_at',''],
      ['SYP events','syp_events','changed_at',''],
      ['Eligible SYP','syp_products','last_seen','is_currently_eligible=eq.true']
    ];
    const rows=[];
    for(const [label,table,dateField,filter] of specs){
      try{const [count,range]=await Promise.all([exactCount(table,filter),bounds(table,dateField)]);rows.push({label,count,...range})}
      catch(e){rows.push({label,error:e.message})}
    }
    host.innerHTML=rows.map(r=>`<div class="collectish-health-card"><span>${r.label}</span>${r.error?`<strong>Unavailable</strong><small>${r.error}</small>`:`<strong>${r.count.toLocaleString()}</strong><small>${fmt(r.oldest)} → ${fmt(r.newest)}</small>`}</div>`).join('');
    patchAccurateKpis(rows);
  }

  function patchAccurateKpis(healthRows){
    const eligible=healthRows.find(r=>r.label==='Eligible SYP'&&!r.error)?.count;
    const direct=el('collectishDirectPage');
    if(direct&&eligible!=null){const card=direct.querySelector('.collectish-kpi');if(card){const span=card.querySelector('span'),strong=card.querySelector('strong');if(span)span.textContent='SYP eligible';if(strong)strong.textContent=eligible.toLocaleString()}}
  }

  async function loadJobs(){
    const body=el('collectishJobBody'),sum=el('collectishJobSummary');if(!body)return;
    body.innerHTML='<tr><td colspan="6">Loading jobs…</td></tr>';
    try{
      const [jobs,collectors]=await Promise.all([
        rest('collector_jobs?select=job_id,source,action,status,created_at,claimed_by,progress_json,error_message,completed_at&order=created_at.desc&limit=100'),
        rest('collectors?select=collector_id,name,status,last_seen_at,app_version&order=last_seen_at.desc&limit=100')
      ]);
      const cmap=new Map((collectors||[]).map(x=>[String(x.collector_id),x]));
      const counts={queued:0,claimed:0,running:0,completed:0,failed:0};for(const j of jobs||[])counts[j.status]=(counts[j.status]||0)+1;
      sum.innerHTML=`<span>Queued <b>${counts.queued||0}</b></span><span>Claimed <b>${counts.claimed||0}</b></span><span>Running <b>${counts.running||0}</b></span><span>Completed <b>${counts.completed||0}</b></span><span>Failed <b>${counts.failed||0}</b></span>`;
      body.innerHTML=(jobs||[]).map(j=>{const p=j.progress_json||{},collector=cmap.get(String(j.claimed_by||''));return `<tr><td>${fmt(j.created_at)}</td><td>${j.source} / ${j.action}</td><td><span class="collectish-job-status s-${j.status}">${j.status}</span></td><td>${Math.round(Number(p.percent||0))}% ${p.stage||''}<div class="meta">${p.detail||''}</div></td><td>${collector?`${collector.name}<div class="meta">${collector.app_version||''} • ${fmt(collector.last_seen_at)}</div>`:'—'}</td><td>${j.error_message||''}</td></tr>`}).join('')||'<tr><td colspan="6">No collector jobs yet.</td></tr>';
    }catch(e){body.innerHTML=`<tr><td colspan="6">${e.message}</td></tr>`}
  }

  async function queueCloudScan(e){
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    const msg=el('newScanMsg');
    try{
      const set=el('newSet')?.selectedOptions?.[0];if(!set?.value)throw Error('Select a set.');
      const s=await valid();if(!s)throw Error('Sign in required');
      const profile={setSlug:set.value,setName:set.dataset.name||set.textContent,printing:el('newPrinting').value,condition:el('newCondition').value,language:el('newLanguage').value,salesEnrich:Number(el('newEnrich').value)};
      if(msg)msg.textContent='Queueing in Collectish Cloud…';
      await rest('collector_jobs',{method:'POST',body:[{user_id:s.user.id,source:'marketplace',action:'scan_set',status:'queued',priority:100,required_capability:'marketplace_scan',preferred_executor:'browser_connector',payload_json:{profile},progress_json:{stage:'queued',percent:0,detail:'Waiting for an eligible collector',updatedAt:new Date().toISOString()},max_attempts:5}],prefer:'return=minimal'});
      if(msg)msg.textContent=`Queued ${profile.setName} in Collectish Cloud.`;
      await loadJobs();
    }catch(err){if(msg)msg.textContent=err.message}
  }

  function installQueueOverride(){
    const b=el('queueNew');if(!b||b.dataset.collectishCloudJobs)return false;b.dataset.collectishCloudJobs='1';b.addEventListener('click',queueCloudScan,true);return true;
  }

  async function patchMoneyAccuracy(){
    const host=el('collectishMoneyPage');if(!host||!host.classList.contains('active'))return;
    try{
      const adjCount=await exactCount('seller_payment_adjustments');
      const meta=[...host.querySelectorAll('.collectish-section .meta')].find(x=>x.textContent.includes('parsed adjustment rows'));
      if(meta&&adjCount>1000)meta.textContent=meta.textContent.replace(/parsed adjustment rows\s+[\d,]+/,`parsed adjustment rows ${adjCount.toLocaleString()} total`);
    }catch{}
  }

  function monitorPages(){
    document.addEventListener('click',e=>{const p=e.target?.dataset?.page;if(p==='operations')setTimeout(()=>{loadHealth();loadJobs()},50);if(p==='direct')setTimeout(()=>loadHealth(),100);if(p==='money')setTimeout(patchMoneyAccuracy,150)},true);
  }

  let tries=0;const t=setInterval(()=>{tries++;setBadge();const a=installOperationsPanels(),b=installQueueOverride();if(a&&b){monitorPages();clearInterval(t)}if(tries>150)clearInterval(t)},100);
})();

/* ===== v055.js ===== */
// Collectish web v0.5.5 — unified navigation bridge + scan queue access
(() => {
  const VERSION="0.5.5", el=id=>document.getElementById(id);
  const setBadge=()=>{const b=el("appVersion");if(b)b.textContent=`web v${VERSION}`};
  setBadge();
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

// Chain the verification-executor overlay with a unique cache key.
(() => {
  if(document.querySelector('script[data-collectish-v056]'))return;
  const s=document.createElement('script');s.src='v056.js?v=056';s.dataset.collectishV056='1';document.body.appendChild(s);
})();

/* ===== v056.js ===== */
// Collectish web v0.5.6 — explicit PC vs cloud verification executor
(() => {
  const VERSION="0.5.6", el=id=>document.getElementById(id);
  const setBadge=()=>{const b=el("appVersion");if(b)b.textContent=`web v${VERSION}`};
  setBadge();

  function session(){
    try{return JSON.parse(localStorage.getItem("collectishSession")||"null")}catch{return null}
  }
  function cfg(){return window.COLLECTISH_CONFIG||{}}
  async function rest(path,{method="GET",body=null,prefer=null}={}){
    const s=session(),c=cfg();if(!s?.token||!s?.user?.id)throw new Error("Sign in required.");
    const h={apikey:c.publishableKey,Authorization:`Bearer ${s.token}`,"Content-Type":"application/json"};if(prefer)h.Prefer=prefer;
    const r=await fetch(`${c.supabaseUrl}/rest/v1/${path}`,{method,headers:h,body:body==null?undefined:JSON.stringify(body)});
    const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!r.ok)throw new Error(data?.message||data?.hint||`Cloud HTTP ${r.status}`);return data;
  }

  function installExecutor(){
    const queue=el("queueNew"),form=queue?.closest(".form-grid");if(!queue||!form)return false;
    if(!el("collectishExecutor")){
      const label=document.createElement("label");label.id="collectishExecutorLabel";label.innerHTML=`Executor<select id="collectishExecutor"><option value="browser_connector" selected>PC connector</option><option value="verification">Cloud verification</option></select><small class="subtle">Cloud verification is isolated from normal PC jobs until parity testing is complete.</small>`;
      form.insertBefore(label,queue);
    }
    return true;
  }

  async function queueVerification(){
    const msg=el("newScanMsg"),s=session();
    try{
      if(!s?.user?.id)throw new Error("Sign in required.");
      const set=el("newSet")?.selectedOptions?.[0];if(!set?.value)throw new Error("Select a set.");
      const profile={setSlug:set.value,setName:set.dataset.name||set.textContent,printing:el("newPrinting")?.value||"Both",condition:el("newCondition")?.value||"Near Mint",language:el("newLanguage")?.value||"English",salesEnrich:Number(el("newEnrich")?.value||0),scanDepth:"Full"};
      if(msg)msg.textContent="Queueing cloud verification job…";
      await rest("collector_jobs",{method:"POST",body:[{user_id:s.user.id,source:"marketplace",action:"scan_set",status:"queued",priority:50,required_capability:"marketplace_scan",preferred_executor:"verification",payload_json:{profile},progress_json:{stage:"queued",percent:0,detail:"Waiting for cloud verification worker",updatedAt:new Date().toISOString()},max_attempts:3}],prefer:"return=minimal"});
      if(msg)msg.textContent=`Queued ${profile.setName} for cloud verification. The scheduled cloud worker will pick it up automatically.`;
      el("refreshCollectishJobs")?.click();
      setTimeout(()=>el("refreshParity")?.click(),200);
    }catch(e){if(msg)msg.textContent=e.message}
  }

  document.addEventListener("click",e=>{
    const b=e.target?.closest?.("#queueNew");if(!b)return;
    if(el("collectishExecutor")?.value!=="verification")return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    queueVerification();
  },true);

  let tries=0;const t=setInterval(()=>{tries++;setBadge();if(installExecutor()||tries>160)clearInterval(t)},100);
  const observer=new MutationObserver(setBadge);const badge=el("appVersion");if(badge)observer.observe(badge,{childList:true,characterData:true,subtree:true});
})();

// Chain scheduled cloud-worker/parity status UI.
(() => {
  if(document.querySelector('script[data-collectish-v057]'))return;
  const s=document.createElement('script');s.src='v057.js?v=057';s.dataset.collectishV057='1';document.body.appendChild(s);
})();

/* ===== v057.js ===== */
// Collectish web v0.5.7 — scheduled cloud verification + parity results
(() => {
  const VERSION="0.5.7",el=id=>document.getElementById(id);
  const setBadge=()=>{const b=el("appVersion");if(b)b.textContent=`web v${VERSION}`};
  setBadge();
  if(!document.querySelector('link[data-collectish-v057]')){const l=document.createElement('link');l.rel='stylesheet';l.href='v057.css?v=057';l.dataset.collectishV057='1';document.head.appendChild(l)}

  function session(){try{return JSON.parse(localStorage.getItem("collectishSession")||"null")}catch{return null}}
  function cfg(){return window.COLLECTISH_CONFIG||{}}
  async function rest(path){
    const s=session(),c=cfg();if(!s?.token)throw Error("Sign in required.");
    const r=await fetch(`${c.supabaseUrl}/rest/v1/${path}`,{headers:{apikey:c.publishableKey,Authorization:`Bearer ${s.token}`,"Content-Type":"application/json"}});
    const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!r.ok)throw Error(data?.message||data?.hint||`Cloud HTTP ${r.status}`);return data;
  }
  const fmt=v=>v?new Date(v).toLocaleString():"—";
  const n=v=>Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2});

  function install(){
    const jobs=el("collectishJobs");if(!jobs||el("collectishParity"))return false;
    const s=document.createElement("section");s.id="collectishParity";s.className="card collectish-ops-panel";s.dataset.collectishPage="operations";
    s.innerHTML=`<div class="toolbar"><div><h2>Cloud verification</h2><div class="meta">The cloud worker checks for verification jobs automatically about every 10 minutes, then compares the result with the latest matching PC scan.</div></div><button id="refreshParity">Refresh</button></div><div id="parityBody" class="collectish-parity-list"><div class="meta">Loading…</div></div>`;
    jobs.insertAdjacentElement("afterend",s);
    el("refreshParity").onclick=loadParity;
    loadParity();return true;
  }

  async function loadParity(){
    const host=el("parityBody");if(!host)return;host.innerHTML='<div class="meta">Loading cloud verification jobs…</div>';
    try{
      const jobs=await rest('collector_jobs?select=job_id,status,created_at,completed_at,claimed_by,payload_json,progress_json,error_message&source=eq.marketplace&action=eq.scan_set&preferred_executor=eq.verification&order=created_at.desc&limit=10');
      if(!jobs?.length){host.innerHTML='<div class="collectish-empty">No cloud verification jobs yet. Choose <b>Cloud verification</b> in New scan and queue one.</div>';return}
      host.innerHTML=jobs.map(j=>{
        const p=j.payload_json?.profile||{},parity=j.progress_json?.parity||null,ps=j.progress_json?.parityStatus||parity?.status||null;
        const cls=ps?` parity-${String(ps).toLowerCase()}`:"";
        const parityText=ps==="PASS"?`PASS • ${n(parity.skuOverlapPct)}% SKU overlap • ${n(parity.directLowMatchPct)}% Direct Low • ${n(parity.scoreMatchPct)}% scores`:ps==="WARN"?`WARN • ${n(parity.skuOverlapPct)}% SKU overlap • ${n(parity.directLowMatchPct)}% Direct Low • ${n(parity.scoreMatchPct)}% scores`:ps==="NO_BASELINE"?"Waiting for a matching PC baseline scan":"Parity check pending";
        return `<div class="collectish-parity-row${cls}"><div><strong>${p.setName||p.setSlug||"Marketplace scan"}</strong><div class="meta">${p.printing||"Both"} / ${p.condition||"Near Mint"} / ${p.language||"English"} • Top ${Number(p.salesEnrich||0)} • queued ${fmt(j.created_at)}</div></div><div><span class="collectish-job-status s-${j.status}">${j.status}</span><div class="parity-result">${parityText}</div>${parity?.pcScanId?`<div class="meta">PC ${String(parity.pcScanId).slice(0,8)}… ↔ Cloud ${String(parity.cloudScanId||"").slice(0,8)}… • ${n(parity.minutesApart)} min apart</div>`:""}${j.error_message?`<div class="meta">${j.error_message}</div>`:""}</div></div>`;
      }).join("");
    }catch(e){host.innerHTML=`<div class="collectish-empty">${e.message}</div>`}
  }

  document.addEventListener("click",e=>{if(e.target?.dataset?.page==="operations")setTimeout(loadParity,100)},true);
  let tries=0;const t=setInterval(()=>{tries++;setBadge();if(install()||tries>180)clearInterval(t)},100);
  const badge=el("appVersion");if(badge)new MutationObserver(setBadge).observe(badge,{childList:true,characterData:true,subtree:true});
})();

// Chain paired verification v0.5.8.
(() => {
  if(document.querySelector('script[data-collectish-v058]'))return;
  const s=document.createElement('script');s.src='v058.js?v=058';s.dataset.collectishV058='1';document.body.appendChild(s);
})();

/* ===== v058.js ===== */
// Collectish web v0.5.8 — paired PC/cloud verification + mismatch detail
(() => {
  const VERSION="0.5.8",el=id=>document.getElementById(id);
  const setBadge=()=>{const b=el("appVersion");if(b)b.textContent=`web v${VERSION}`};
  setBadge();
  if(!document.querySelector('link[data-collectish-v058]')){const l=document.createElement('link');l.rel='stylesheet';l.href='v058.css?v=058';l.dataset.collectishV058='1';document.head.appendChild(l)}

  function session(){try{return JSON.parse(localStorage.getItem("collectishSession")||"null")}catch{return null}}
  function cfg(){return window.COLLECTISH_CONFIG||{}}
  async function rest(path,{method="GET",body=null,prefer=null}={}){
    const s=session(),c=cfg();if(!s?.token||!s?.user?.id)throw Error("Sign in required.");
    const h={apikey:c.publishableKey,Authorization:`Bearer ${s.token}`,"Content-Type":"application/json"};if(prefer)h.Prefer=prefer;
    const r=await fetch(`${c.supabaseUrl}/rest/v1/${path}`,{method,headers:h,body:body==null?undefined:JSON.stringify(body)});
    const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!r.ok)throw Error(data?.message||data?.hint||`Cloud HTTP ${r.status}`);return data;
  }
  const n=v=>Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2});
  const esc=s=>String(s??"").replace(/[&<>\"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]));

  function install(){
    const parity=el("collectishParity");if(!parity||el("queuePairedVerification"))return false;
    const toolbar=parity.querySelector('.toolbar');
    const btn=document.createElement('button');btn.id='queuePairedVerification';btn.type='button';btn.textContent='Queue paired test';
    toolbar?.appendChild(btn);
    const note=document.createElement('div');note.className='collectish-pair-note';note.innerHTML='<b>Paired test:</b> queues the same current New scan profile once to the PC connector and once to the cloud worker. The parity checker links the two jobs instead of using an older baseline.';
    toolbar?.insertAdjacentElement('afterend',note);
    btn.onclick=queuePair;
    el('refreshParity')?.addEventListener('click',()=>setTimeout(loadEnhancedParity,100));
    loadEnhancedParity();return true;
  }

  async function queuePair(){
    const msg=el('newScanMsg'),s=session();
    try{
      const set=el('newSet')?.selectedOptions?.[0];if(!set?.value)throw Error('Select a set in New scan first.');
      const profile={setSlug:set.value,setName:set.dataset.name||set.textContent,printing:el('newPrinting')?.value||'Both',condition:el('newCondition')?.value||'Near Mint',language:el('newLanguage')?.value||'English',salesEnrich:Number(el('newEnrich')?.value||0),scanDepth:'Full'};
      const pairId=crypto.randomUUID(),now=new Date().toISOString();
      const base={user_id:s.user.id,source:'marketplace',action:'scan_set',status:'queued',required_capability:'marketplace_scan',max_attempts:3};
      await rest('collector_jobs',{method:'POST',body:[
        {...base,priority:40,preferred_executor:'browser_connector',payload_json:{profile,verificationPairId:pairId,verificationRole:'pc'},progress_json:{stage:'queued',percent:0,detail:'Paired verification: waiting for PC connector',pairId,updatedAt:now}},
        {...base,priority:40,preferred_executor:'verification',payload_json:{profile,verificationPairId:pairId,verificationRole:'cloud'},progress_json:{stage:'queued',percent:0,detail:'Paired verification: waiting for cloud worker',pairId,updatedAt:now}}
      ],prefer:'return=minimal'});
      if(msg)msg.textContent=`Queued paired verification for ${profile.setName}. PC and cloud jobs share pair ${pairId.slice(0,8)}…`;
      el('refreshCollectishJobs')?.click();setTimeout(loadEnhancedParity,250);
    }catch(e){if(msg)msg.textContent=e.message}
  }

  function mismatchHtml(m){
    const bits=[];
    if(m.directLow)bits.push(`Direct $${n(m.directLow.pc)}→$${n(m.directLow.cloud)}`);
    if(m.directAvailable)bits.push(`qty ${m.directAvailable.pc}→${m.directAvailable.cloud}`);
    if(m.directListings)bits.push(`Direct listings ${m.directListings.pc}→${m.directListings.cloud}`);
    if(m.marketplaceListings)bits.push(`market listings ${m.marketplaceListings.pc}→${m.marketplaceListings.cloud}`);
    if(m.salesVelocity)bits.push(`sales/day ${n(m.salesVelocity.pc)}→${n(m.salesVelocity.cloud)}`);
    if(m.score)bits.push(`score ${m.score.pc}→${m.score.cloud}`);
    if(m.flag)bits.push(`${m.flag.pc}→${m.flag.cloud}`);
    return `<li><b>${esc(m.productName||`SKU ${m.skuId}`)}</b><span>SKU ${esc(m.skuId)} • ${bits.map(esc).join(' • ')}</span></li>`;
  }

  async function loadEnhancedParity(){
    const host=el('parityBody');if(!host)return;
    try{
      const jobs=await rest('collector_jobs?select=job_id,status,created_at,completed_at,claimed_by,payload_json,progress_json,error_message&source=eq.marketplace&action=eq.scan_set&preferred_executor=eq.verification&order=created_at.desc&limit=10');
      if(!jobs?.length)return;
      host.innerHTML=jobs.map(j=>{
        const p=j.payload_json?.profile||{},par=j.progress_json?.parity||null,ps=j.progress_json?.parityStatus||par?.status||null,pair=j.payload_json?.verificationPairId;
        const cls=ps?` parity-${String(ps).toLowerCase()}`:'';
        const exact=par?`${n(par.directLowMatchPct)}% exact / ${n(par.directLowTolerantMatchPct??par.directLowMatchPct)}% tolerant Direct Low`:'';
        const core=par?`Qty ${n(par.directAvailableMatchPct)}% • Direct listings ${n(par.directListingsMatchPct)}% • Market listings ${n(par.marketplaceListingsMatchPct)}% • Sales ${n(par.salesVelocityMatchPct)}%`:'';
        const samples=par?.mismatchSamples?.length?`<details class="parity-mismatches"><summary>${par.mismatchSamples.length} mismatch samples</summary><ul>${par.mismatchSamples.map(mismatchHtml).join('')}</ul></details>`:'';
        return `<div class="collectish-parity-row${cls}"><div><strong>${esc(p.setName||p.setSlug||'Marketplace scan')}</strong><div class="meta">${esc(p.printing||'Both')} / ${esc(p.condition||'Near Mint')} / ${esc(p.language||'English')} • Top ${Number(p.salesEnrich||0)}${pair?` • pair ${esc(pair.slice(0,8))}…`:''}</div></div><div><span class="collectish-job-status s-${esc(j.status)}">${esc(j.status)}</span>${ps?`<div class="parity-result"><b>${esc(ps)}</b> • ${n(par.skuOverlapPct)}% SKU overlap • ${exact} • ${n(par.scoreMatchPct)}% score</div><div class="meta">${core}</div><div class="meta">PC ↔ cloud ${n(par.minutesApart)} min apart</div>${samples}`:'<div class="parity-result">Parity check pending</div>'}${j.error_message?`<div class="meta">${esc(j.error_message)}</div>`:''}</div></div>`;
      }).join('');
    }catch(e){host.innerHTML=`<div class="collectish-empty">${esc(e.message)}</div>`}
  }

  document.addEventListener('click',e=>{if(e.target?.dataset?.page==='operations')setTimeout(loadEnhancedParity,150)},true);
  let tries=0;const t=setInterval(()=>{tries++;setBadge();if(install()||tries>180)clearInterval(t)},100);
  const badge=el('appVersion');if(badge)new MutationObserver(setBadge).observe(badge,{childList:true,characterData:true,subtree:true});
})();

// Chain cloud-default executor release.
(()=>{
  if(document.querySelector('script[data-collectish-v059]'))return;
  const s=document.createElement('script');s.src='v059.js?v=059';s.dataset.collectishV059='1';document.body.appendChild(s);
})();

/* ===== v059.js ===== */
// Collectish web v0.5.9 — cloud-primary Marketplace execution with PC fallback
(() => {
  const VERSION='0.5.9',el=id=>document.getElementById(id);
  const setBadge=()=>{const b=el('appVersion');if(b)b.textContent=`web v${VERSION}`};
  setBadge();
  if(!document.querySelector('link[data-collectish-v059]')){const l=document.createElement('link');l.rel='stylesheet';l.href='v059.css?v=059';l.dataset.collectishV059='1';document.head.appendChild(l)}
  function session(){try{return JSON.parse(localStorage.getItem('collectishSession')||'null')}catch{return null}}
  function cfg(){return window.COLLECTISH_CONFIG||{}}
  async function rest(path,{method='GET',body=null,prefer=null}={}){
    const s=session(),c=cfg();if(!s?.token||!s?.user?.id)throw Error('Sign in required.');
    const h={apikey:c.publishableKey,Authorization:`Bearer ${s.token}`,'Content-Type':'application/json'};if(prefer)h.Prefer=prefer;
    const r=await fetch(`${c.supabaseUrl}/rest/v1/${path}`,{method,headers:h,body:body==null?undefined:JSON.stringify(body)});
    const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!r.ok)throw Error(data?.message||data?.hint||`Cloud HTTP ${r.status}`);return data;
  }
  function install(){
    const sel=el('collectishExecutor'),queue=el('queueNew');if(!sel||!queue)return false;
    if(!sel.querySelector('option[value="cloud_worker"]')){
      sel.innerHTML='<option value="cloud_worker">Cloud worker (default)</option><option value="browser_connector">PC connector fallback</option><option value="verification">Cloud verification</option>';
    }
    sel.value='cloud_worker';
    const small=el('collectishExecutorLabel')?.querySelector('small');if(small)small.textContent='Cloud is now the primary Marketplace executor. Failed cloud jobs are requeued automatically to the PC connector.';
    if(!el('collectishCloudPrimaryBadge')){
      const badge=document.createElement('div');badge.id='collectishCloudPrimaryBadge';badge.className='collectish-cloud-primary';badge.innerHTML='<b>Cloud primary</b><span>Marketplace scans run server-side first. PC v0.15.6 remains the fallback executor.</span>';
      queue.closest('.form-grid')?.insertAdjacentElement('beforebegin',badge);
    }
    return true;
  }
  async function queueCloudPrimary(){
    const msg=el('newScanMsg'),s=session();
    try{
      const set=el('newSet')?.selectedOptions?.[0];if(!set?.value)throw Error('Select a set.');
      const profile={setSlug:set.value,setName:set.dataset.name||set.textContent,printing:el('newPrinting')?.value||'Both',condition:el('newCondition')?.value||'Near Mint',language:el('newLanguage')?.value||'English',salesEnrich:Number(el('newEnrich')?.value||0),scanDepth:'Smart'};
      if(msg)msg.textContent='Queueing cloud Marketplace scan…';
      await rest('collector_jobs',{method:'POST',body:[{user_id:s.user.id,source:'marketplace',action:'scan_set',status:'queued',priority:30,required_capability:'marketplace_scan',preferred_executor:'cloud_worker',payload_json:{profile,cloudPrimary:true},progress_json:{stage:'queued',percent:0,detail:'Waiting for Collectish cloud worker',updatedAt:new Date().toISOString()},max_attempts:3}],prefer:'return=minimal'});
      if(msg)msg.textContent=`Queued ${profile.setName} for cloud execution. The worker checks about every 5 minutes; PC fallback is automatic if cloud execution fails.`;
      el('refreshCollectishJobs')?.click();
    }catch(e){if(msg)msg.textContent=e.message}
  }
  document.addEventListener('click',e=>{
    const b=e.target?.closest?.('#queueNew');if(!b)return;
    if(el('collectishExecutor')?.value!=='cloud_worker')return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();queueCloudPrimary();
  },true);
  let tries=0;const t=setInterval(()=>{tries++;setBadge();if(install()||tries>180)clearInterval(t)},100);
  const badge=el('appVersion');if(badge)new MutationObserver(setBadge).observe(badge,{childList:true,characterData:true,subtree:true});
})();

// Chain production cloud operations status.
(()=>{
  if(document.querySelector('script[data-collectish-v060]'))return;
  const s=document.createElement('script');s.src='v060.js?v=060';s.dataset.collectishV060='1';document.body.appendChild(s);
})();

/* ===== v060.js ===== */
// Collectish web v0.6.0 — cloud-primary Marketplace operations status
(() => {
  const VERSION='0.6.0',el=id=>document.getElementById(id);
  const setBadge=()=>{const b=el('appVersion');if(b)b.textContent=`web v${VERSION}`};
  setBadge();
  if(!document.querySelector('link[data-collectish-v060]')){const l=document.createElement('link');l.rel='stylesheet';l.href='v060.css?v=060';l.dataset.collectishV060='1';document.head.appendChild(l)}
  function session(){try{return JSON.parse(localStorage.getItem('collectishSession')||'null')}catch{return null}}
  function cfg(){return window.COLLECTISH_CONFIG||{}}
  async function rest(path){
    const s=session(),c=cfg();if(!s?.token)throw Error('Sign in required.');
    const r=await fetch(`${c.supabaseUrl}/rest/v1/${path}`,{headers:{apikey:c.publishableKey,Authorization:`Bearer ${s.token}`,'Content-Type':'application/json'}});
    const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!r.ok)throw Error(data?.message||data?.hint||`Cloud HTTP ${r.status}`);return data;
  }
  const fmt=v=>v?new Date(v).toLocaleString():'—';
  const esc=s=>String(s??'').replace(/[&<>\"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));

  function install(){
    const jobs=el('collectishJobs');if(!jobs||el('marketplaceExecutionStatus'))return false;
    const sec=document.createElement('section');sec.id='marketplaceExecutionStatus';sec.className='card collectish-ops-panel';sec.dataset.collectishPage='operations';
    sec.innerHTML=`<div class="toolbar"><div><h2>Marketplace execution</h2><div class="meta">Cloud is the production executor. The PC connector is fallback only.</div></div><button id="refreshMarketplaceExecution">Refresh</button></div><div id="marketplaceExecutionBody" class="marketplace-exec-grid"><div class="meta">Loading…</div></div>`;
    jobs.insertAdjacentElement('beforebegin',sec);
    el('refreshMarketplaceExecution').onclick=load;
    load();return true;
  }

  async function load(){
    const host=el('marketplaceExecutionBody');if(!host)return;
    host.innerHTML='<div class="meta">Refreshing Marketplace execution status…</div>';
    try{
      const [jobs,scans,collectors]=await Promise.all([
        rest('collector_jobs?select=job_id,status,preferred_executor,created_at,completed_at,error_message,payload_json,progress_json&source=eq.marketplace&action=eq.scan_set&order=created_at.desc&limit=50'),
        rest('marketplace_scans?select=scan_id,set_name,captured_at,unique_skus,profile_json&order=captured_at.desc&limit=10'),
        rest('collectors?select=collector_id,name,status,last_seen_at,app_version,collector_type&order=last_seen_at.desc&limit=50')
      ]);
      const cloudJobs=(jobs||[]).filter(j=>j.preferred_executor==='cloud_worker');
      const pending=cloudJobs.filter(j=>['queued','claimed','running'].includes(j.status));
      const failed=cloudJobs.filter(j=>j.status==='failed');
      const fallback=(jobs||[]).filter(j=>j.preferred_executor==='browser_connector'&&j.payload_json?.fallbackFromCloudJobId);
      const latestCloud=(scans||[]).find(s=>s.profile_json?.executor==='cloud_worker')||null;
      const worker=(collectors||[]).find(c=>c.collector_type==='cloud_worker')||null;
      host.innerHTML=`
        <div class="marketplace-exec-card"><span>Primary executor</span><strong>Cloud worker</strong><small>Checks queue every ~5 minutes</small></div>
        <div class="marketplace-exec-card"><span>Worker</span><strong>${worker?esc(worker.status||'online'):'registered'}</strong><small>${worker?`${esc(worker.app_version||'')} • ${fmt(worker.last_seen_at)}`:'Server-side public Marketplace APIs'}</small></div>
        <div class="marketplace-exec-card"><span>Latest cloud scan</span><strong>${latestCloud?esc(latestCloud.set_name||'Marketplace scan'):'—'}</strong><small>${latestCloud?`${Number(latestCloud.unique_skus||0).toLocaleString()} SKUs • ${fmt(latestCloud.captured_at)}`:'No cloud scan found'}</small></div>
        <div class="marketplace-exec-card"><span>Cloud queue</span><strong>${pending.length}</strong><small>queued / claimed / running</small></div>
        <div class="marketplace-exec-card"><span>Cloud failures</span><strong>${failed.length}</strong><small>within latest 50 Marketplace jobs</small></div>
        <div class="marketplace-exec-card"><span>PC fallbacks</span><strong>${fallback.length}</strong><small>automatically created after cloud failure</small></div>`;
    }catch(e){host.innerHTML=`<div class="collectish-empty">${esc(e.message)}</div>`}
  }

  document.addEventListener('click',e=>{if(e.target?.dataset?.page==='operations')setTimeout(load,120)},true);
  let tries=0;const t=setInterval(()=>{tries++;setBadge();if(install()||tries>180)clearInterval(t)},100);
  const badge=el('appVersion');if(badge)new MutationObserver(setBadge).observe(badge,{childList:true,characterData:true,subtree:true});
})();

/* ===== v044.js ===== */
(()=>{
  const $=id=>document.getElementById(id);
  function install(){
    const more=document.querySelector('.mobile-product-page[data-mobile-page="more"]');if(!more||$("mobileMoreSummary"))return false;
    const s=document.createElement("section");s.id="mobileMoreSummary";s.className="card mobile-more-summary";s.innerHTML='<div class="mobile-more-grid"><button data-jump="New scan"><b>New scan</b><span>Queue a Marketplace scan</span></button><button data-jump="Scan profiles"><b>Profiles</b><span>Saved scan groups</span></button><button data-jump="Requests"><b>Requests</b><span>PC queue status</span></button><button data-jump="Latest scans"><b>History</b><span>Recent uploaded scans</span></button></div>';more.querySelector(".mobile-page-head")?.insertAdjacentElement("afterend",s);s.onclick=e=>{const b=e.target.closest("button[data-jump]");if(!b)return;const target=[...more.querySelectorAll("section.card")].find(x=>x.querySelector("h2")?.textContent.trim()===b.dataset.jump);target?.scrollIntoView({behavior:"smooth",block:"start"})};return true
  }
  let n=0,t=setInterval(()=>{n++;if(install()||n>100)clearInterval(t)},100)
})();

/* ===== v049.js ===== */
// Collectish Marketplace Scout web v0.4.9 — Scout loading feedback
(() => {
  const el=id=>document.getElementById(id);
  const badge=el("appVersion");if(badge)badge.textContent="web v0.4.9";
  if(!document.querySelector('link[data-collectish-v049]')){const l=document.createElement("link");l.rel="stylesheet";l.href="v049.css?v=049";l.dataset.collectishV049="1";document.head.appendChild(l)}
  let wrapped=false,phaseTimer=null;

  function ensureLoader(){
    if(el("mobileScoutLoading"))return el("mobileScoutLoading");
    const body=el("leaderBody"),section=body?.closest("section.card");if(!section)return null;
    const host=document.createElement("div");host.id="mobileScoutLoading";host.className="mobile-scout-loading";host.hidden=true;
    host.innerHTML='<div class="mobile-scout-loading-spinner"></div><div class="mobile-scout-loading-copy"><strong id="mobileScoutLoadingTitle">Preparing Scout…</strong><span id="mobileScoutLoadingDetail">Loading opportunity data…</span><div class="mobile-scout-loading-track"><span></span></div></div>';
    const status=el("leaderStatus");status?.parentNode?.insertBefore(host,status);
    return host;
  }
  function show(title="Preparing Scout…",detail="Loading opportunity data…"){
    const host=ensureLoader();if(!host)return;
    host.hidden=false;el("mobileScoutLoadingTitle").textContent=title;el("mobileScoutLoadingDetail").textContent=detail;
    const bar=host.querySelector(".mobile-scout-loading-track span");if(bar)bar.classList.add("indeterminate");
    clearTimeout(phaseTimer);phaseTimer=setTimeout(()=>{if(!host.hidden)el("mobileScoutLoadingDetail").textContent="Loading scan history, ranking cards, and resolving artwork…"},900);
  }
  function hide(){
    const host=ensureLoader();if(!host)return;clearTimeout(phaseTimer);
    el("mobileScoutLoadingTitle").textContent="Scout ready";el("mobileScoutLoadingDetail").textContent="Opportunity cards are ready.";
    setTimeout(()=>{host.hidden=true},260);
  }
  function install(){
    ensureLoader();
    if(wrapped||!el("leaderVisual")||!el("leaderHelp")||typeof window.buildLeaderboard!=="function")return false;
    const original=window.buildLeaderboard;
    if(original.__collectishLoadingWrapped){wrapped=true;return true}
    const fn=async function(...args){show("Preparing Scout…","Loading cross-scan opportunity history…");try{return await original.apply(this,args)}finally{hide()}};
    fn.__collectishLoadingWrapped=true;window.buildLeaderboard=fn;wrapped=true;return true;
  }
  let tries=0;const t=setInterval(()=>{tries++;if(install()||tries>120)clearInterval(t)},100);
})();

// Load the unified Collectish app shell and subsequent overlays without requiring
// another index.html migration. This keeps the additive overlay chain intact.
(() => {
  const load=(version)=>{
    if(document.querySelector(`script[data-collectish-v${version}]`))return;
    const s=document.createElement('script');
    s.src=`v${version}.js?v=${version}`;
    s.dataset[`collectishV${version}`]='1';
    document.body.appendChild(s);
  };
  load('050');
  load('051');
  load('052');
  load('053');
  load('055');
  load('056');
  load('061');
})();

/* ===== v045.js ===== */
(()=>{
  const $=id=>document.getElementById(id);
  function install(){
    const scout=document.querySelector('.mobile-product-page[data-mobile-page="scout"]');if(!scout||$("mobileScoutToolbar"))return false;
    const t=document.createElement("div");t.id="mobileScoutToolbar";t.className="mobile-scout-toolbar";t.innerHTML='<button data-mobile-qf="all" class="active">All</button><button data-mobile-qf="hot">HOT</button><button data-mobile-qf="watch">WATCH</button><button data-mobile-qf="depleting">Qty ↓</button><button data-mobile-qf="rising">Price ↑</button>';$("leaderHelp")?.insertAdjacentElement("afterend",t);t.onclick=e=>{const b=e.target.closest("button[data-mobile-qf]");if(!b)return;t.querySelectorAll("button").forEach(x=>x.classList.toggle("active",x===b));const k=b.dataset.mobileQf;document.querySelectorAll("#leaderVisual .leader-card").forEach(c=>{const s=c.textContent.toLowerCase();c.hidden=!(k==="all"||(k==="hot"&&s.includes("hot"))||(k==="watch"&&s.includes("watch"))||(k==="depleting"&&/qty -/.test(s))||(k==="rising"&&/price \+\$/.test(s)))})};return true
  }
  let n=0,t=setInterval(()=>{n++;if(install()||n>100)clearInterval(t)},100)
})();

/* ===== v046.js ===== */
(()=>{
  const $=id=>document.getElementById(id);
  function install(){
    const scout=document.querySelector('.mobile-product-page[data-mobile-page="scout"]');if(!scout||$("mobileScoutSort"))return false;const c=scout.querySelector(".leaderboard-controls");if(!c)return false;const label=document.createElement("label");label.innerHTML='Quick sort<select id="mobileScoutSort"><option value="composite">Opportunity</option><option value="score">Score</option><option value="depletion">Qty depletion</option><option value="price">Price rise</option><option value="rank">Rank improvement</option></select>';c.appendChild(label);$("mobileScoutSort").onchange=e=>{if($("leaderMetric")){$("leaderMetric").value=e.target.value;$("leaderRefresh").click()}};return true
  }
  let n=0,t=setInterval(()=>{n++;if(install()||n>100)clearInterval(t)},100)
})();

/* ===== consolidated startup finalizer ===== */
(() => {
  const FINAL_VERSION='0.7.0';
  const originalGetElementById=Document.prototype.getElementById;
  const finish=()=>{
    window.__collectishVersionReady=true;
    // Restore normal lookup before installing the final badge.
    const descriptor=window.__collectishOriginalGetElementById;
    const anchor=[...document.childNodes];
    let existing=originalGetElementById.call(document,'appVersion');
    if(!existing){
      const commentWalker=document.createTreeWalker(document,NodeFilter.SHOW_COMMENT);
      let n,mark=null;
      while((n=commentWalker.nextNode())){ if(n.nodeValue==='collectish-version'){mark=n;break} }
      if(mark){
        const b=document.createElement('div');
        b.id='appVersion';b.className='version-badge';b.textContent=`web ${FINAL_VERSION}`;
        mark.replaceWith(b);existing=b;
      }
    }
    if(existing){
      existing.style.visibility='visible';
      const enforce=()=>{if(existing.textContent!==`web ${FINAL_VERSION}`)existing.textContent=`web ${FINAL_VERSION}`};
      enforce();
      new MutationObserver(enforce).observe(existing,{childList:true,characterData:true,subtree:true});
    }
    // Logged-out visitors must remain idle.
    let session=null;try{session=JSON.parse(localStorage.getItem('collectishSession')||'null')}catch{}
    if(!session?.token){
      const banner=originalGetElementById.call(document,'activityBanner');
      if(banner){banner.hidden=true;banner.style.display='none'}
      const scout=originalGetElementById.call(document,'mobileScoutLoading');
      if(scout){scout.hidden=true;scout.style.display='none'}
    }
  };
  // Legacy installation timers run at 100ms cadence and settle quickly.
  setTimeout(finish,1200);
})();