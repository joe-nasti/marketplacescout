// Collectish consolidated web 0.7.5
// Generated; do not edit directly. Run tools/build-consolidated-web.mjs.
(()=>{
  const realBadge=document.querySelector('#appVersion');
  const legacyBadge=document.createElement('div');
  legacyBadge.id='collectishLegacyVersionSink';
  const nativeGet=Document.prototype.getElementById;
  Document.prototype.getElementById=function(id){return id==='appVersion'?legacyBadge:nativeGet.call(this,id)};
  const NativeMO=window.MutationObserver;
  window.MutationObserver=class extends NativeMO{observe(target,opts){if(target===legacyBadge)return;return super.observe(target,opts)}};
  const isLegacyAsset=node=>{
    if(!node||node.nodeType!==1)return false;
    const raw=node.tagName==='SCRIPT'?node.getAttribute('src'):node.tagName==='LINK'?node.getAttribute('href'):'';
    if(!raw)return false;
    try{const u=new URL(raw,location.href);return /^v\d+\.(?:js|css)$/i.test(u.pathname.split('/').pop()||'')}catch{return false}
  };
  const appendChild=Node.prototype.appendChild;Node.prototype.appendChild=function(n){return isLegacyAsset(n)?n:appendChild.call(this,n)};
  const append=Element.prototype.append;Element.prototype.append=function(...n){return append.apply(this,n.filter(x=>!isLegacyAsset(x)))};
  const prepend=Element.prototype.prepend;Element.prototype.prepend=function(...n){return prepend.apply(this,n.filter(x=>!isLegacyAsset(x)))};
  const adjacent=Element.prototype.insertAdjacentElement;Element.prototype.insertAdjacentElement=function(p,n){return isLegacyAsset(n)?n:adjacent.call(this,p,n)};
  if(realBadge)realBadge.textContent='web 0.7.5';
  window.__collectishConsolidated={version:'0.7.5',builtAt:'2026-08-13T22:17:32.953Z'};
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
function openProductHistory(sku){document.querySelectorAll(".analytics-tab").forEach(b=>b.classList.toggle("active",b.dataset.panel==="productPanel"));document.querySelectorAll(".analytics-panel").forEach(p=>p.classList.toggle("active",p.id==="productPanel"));$("productHistorySelect").value=sku;renderProductHistoryMobile(sku);document.getElementById("productPanel").scrollIntoView({behavior:"smooth",block:"start"})}
function renderProductHistoryMobile(sku){if(!analyticsContext)return;const base=new Date(analyticsContext.ss[0].captured_at).getTime(),series=[];for(const s of analyticsContext.ss){const r=(analyticsContext.byScan.get(s.scan_id)||[]).find(x=>x.sku_id===sku);if(r)series.push({s,r,day:(new Date(s.captured_at).getTime()-base)/86400000})}if(!series.length)return;const latest=series.at(-1).r,first=series[0].r;$("productHistorySummary").innerHTML=[["Direct qty",latest.direct_available],["Qty Δ",Number(latest.direct_available||0)-Number(first.direct_available||0)],["Direct Low",money(latest.direct_low)],["Listings",latest.direct_listings],["Rank",latest.sales_rank],["Score",latest.opportunity_score]].map(([a,b])=>`<div class=stat><span>${a}</span><strong>${b}</strong></div>`).join("");chart("productQtyChart",series.map(x=>({d:x.s.captured_at,v:Number(x.r.direct_available||0)})),v=>Math.round(v));chart("productPriceChart",series.map(x=>({d:x.s.captured_at,v:Number(x.r.direct_low||0)})),money);let pred="Need at least 3 scans for prediction.";if(series.length>=3){const qr=regression(series.map(x=>({x:x.day,y:Number(x.r.direct_available||0)}))),pr=regression(series.map(x=>({x:x.day,y:Number(x.r.direct_low||0)})));let stock="—";if(qr&&qr.slope<0&&latest.direct_available>0){const days=latest.direct_available/(-qr.slope);if(days>0&&days<3650)stock=`${days.toFixed(1)} days`}pred=`<b>${latest.product_name}</b><br>Inventory trend: ${qr?`${qr.slope>=0?"+":""}${qr.slope.toFixed(2)} copies/day`:"—"} • estimated stockout: ${stock}<br>Direct Low trend: ${pr?`${pr.slope>=0?"+":""}$${pr.slope.toFixed(2)}/day`:"—"} • trend confidence: ${qr?`${Math.round(qr.r2*100)}%`:"—"}`} $("productPrediction").innerHTML=pred}
async function load(){
  showActivity("Refreshing dashboard","Loading scans, PC status, and requests…");
  try{
    // Render cached set catalog immediately. Only touch cloud if cache is >7 days old.
    const cached=getCachedSets();
    if(cached?.sets?.length){
      renderSetOptions(cached.sets);
      $("setCacheStatus").textContent=`${cached.sets.length.toLocaleString()} sets cached • ${setCatalogAgeLabel(cached.savedAt)}`;
    }else{
      $("setCacheStatus").textContent="No local set cache yet";
    }

    updateActivity("Loading recent scans…");
    const scansPromise=rest("marketplace_scans?select=*&order=captured_at.desc&limit=100");
    const devPromise=rest("marketplace_devices?select=*&order=last_seen_at.desc&limit=5");
    const cmdPromise=rest("marketplace_scan_commands?select=*&order=requested_at.desc&limit=20");

    const [scans,dev,cmd]=await Promise.all([scansPromise,devPromise,cmdPromise]);
    scansCache=scans;

    // Fetch catalog only if absent/stale. This is intentionally not on the normal refresh critical path.
    const cacheNow=getCachedSets();
    if(!cacheNow || (Date.now()-cacheNow.savedAt)>=SET_CACHE_MAX_AGE){
      try{
        updateActivity("Set catalog is stale • refreshing in background…");
        await loadSetCatalog(false);
      }catch(e){
        $("setCacheStatus").textContent=(cacheNow?.sets?.length)
          ? `${cacheNow.sets.length.toLocaleString()} cached sets • cloud refresh failed`
          : `Set catalog unavailable: ${e.message}`;
      }
    }

    const d=dev[0],on=d&&Date.now()-new Date(d.last_seen_at).getTime()<300000;
    $("device").innerHTML=d?`<b>${on?"Online":"Offline"}</b> • ${d.device_name||"PC"} • ${dt(d.last_seen_at)}`:"No heartbeat yet";

    const ps=new Map();
    for(const s of scans){
      const k=[s.set_slug,s.printing,s.condition,s.language].join("|");
      if(!ps.has(k))ps.set(k,s)
    }

    $("profiles").innerHTML=[...ps.values()].map(s=>`<div class=profile><div><div class=title>${s.set_name}</div><div class=meta>${s.printing} / ${s.condition} / ${s.language} • ${dt(s.captured_at)}</div></div><button class=run data-p='${JSON.stringify(s.profile_json).replaceAll("'","&#39;")}'>Run on PC</button></div>`).join("");
    document.querySelectorAll(".run").forEach(b=>b.onclick=()=>queue(JSON.parse(b.dataset.p)));

    $("analyticsProfile").innerHTML=[...ps.entries()].map(([k,s])=>`<option value="${k}">${s.set_name} • ${s.printing}/${s.condition}/${s.language}</option>`).join("");
    if(ps.size){
      updateActivity("Loading mobile analytics…");
      await analytics();
    }

    $("commands").innerHTML=cmd.map(x=>`<div class=command><div><div class=title>${x.profile_json?.setName||x.profile_json?.setSlug}</div><div class=meta>${dt(x.requested_at)} • ${x.status}${x.error_message?" • "+x.error_message:""}</div>${requestProgressHtml(x)}</div></div>`).join("");

    $("scans").innerHTML=scans.slice(0,20).map(s=>`<div class=scan><div><div class=title>${s.set_name}</div><div class=meta>${s.printing} / ${s.condition} / ${s.language} • ${dt(s.captured_at)}</div></div><div>${s.unique_skus} SKUs<br><span class=meta>${s.hot_count} HOT / ${s.watch_count} WATCH</span></div></div>`).join("");

    $("stats").innerHTML=[["Profiles",ps.size],["Scans",scans.length],["PC",on?"Online":"Offline"]].map(([a,b])=>`<div class=stat><span>${a}</span><strong>${b}</strong></div>`).join("");

    updateActivity(`Loaded ${scans.length} scans`);
    setTimeout(hideActivity,500);
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
    updateActivity("Set catalog updated");
    setTimeout(hideActivity,700);
  }catch(e){
    showActivity("Set catalog refresh failed",e.message);
  }
};$("analyticsProfile").onchange=async()=>{
  try{
    showActivity("Loading analytics","Fetching scan rows for this profile…");
    await analytics();
    setTimeout(hideActivity,500);
  }catch(e){
    showActivity("Analytics failed",e.message);
  }
};document.querySelectorAll(".analytics-tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".analytics-tab").forEach(x=>x.classList.toggle("active",x===b));document.querySelectorAll(".analytics-panel").forEach(p=>p.classList.toggle("active",p.id===b.dataset.panel))});
$("moverSort").onchange=renderMoversMobile;$("moverSearch").oninput=renderMoversMobile;$("productHistorySearch").oninput=renderProductOptionsMobile;$("productHistorySelect").onchange=e=>renderProductHistoryMobile(e.target.value);
boot();

setInterval(async()=>{
  try{
    if(!session()) return;
    const [dev,cmd]=await Promise.all([
      rest("marketplace_devices?select=*&order=last_seen_at.desc&limit=5"),
      rest("marketplace_scan_commands?select=*&order=requested_at.desc&limit=20")
    ]);
    const d=dev[0],on=d&&Date.now()-new Date(d.last_seen_at).getTime()<300000;
    $("device").innerHTML=d?`<b>${on?"Online":"Offline"}</b> • ${d.device_name||"PC"} • ${dt(d.last_seen_at)}`:"No heartbeat yet";
    $("commands").innerHTML=cmd.map(x=>`<div class=command><div><div class=title>${x.profile_json?.setName||x.profile_json?.setSlug}</div><div class=meta>${dt(x.requested_at)} • ${x.status}${x.error_message?" • "+x.error_message:""}</div>${requestProgressHtml(x)}</div></div>`).join("");
  }catch(e){}
},15000);


/* ===== v032.js ===== */
// Marketplace Scout web v0.3.2 enhancements
(() => {
  const el = id => document.getElementById(id);
  const signed = (v,d=0,prefix="") => { const n=Number(v); return Number.isFinite(n) ? `${n>0?"+":""}${prefix}${n.toFixed(d)}` : "—"; };
  const pageUrl = r => `https://www.tcgplayer.com/product/${encodeURIComponent(r.product_id)}?Language=${encodeURIComponent(r.language||"English")}&Printing=${encodeURIComponent(r.printing||"Normal")}&Condition=${encodeURIComponent(r.condition||"Near Mint")}&direct=true`;
  const badge=el("appVersion"); if(badge) badge.textContent="web v0.3.2";

  chart = function(id,pts,fmt=v=>String(v),second=null){
    const s=el(id),W=640,H=220,L=58,R=12,T=12,B=34;
    const vals=[...pts.map(x=>x.v),...(second?second.map(x=>x.v):[])].filter(Number.isFinite);
    if(!s) return;
    if(pts.length<2||!vals.length){s.innerHTML='<text x="320" y="110" text-anchor="middle" class="axis">Need 2+ scans</text>';return}
    let mn=Math.min(...vals),mx=Math.max(...vals); if(mn===mx){mn-=1;mx+=1}
    const x=i=>L+i*(W-L-R)/(pts.length-1), y=v=>T+(mx-v)*(H-T-B)/(mx-mn), path=a=>a.map((q,i)=>`${i?"L":"M"} ${x(i)} ${y(q.v)}`).join(" ");
    const grid=[0,.25,.5,.75,1].map(f=>{const val=mx-(mx-mn)*f,yy=T+(H-T-B)*f;return `<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" class="grid-line"/><text x="${L-6}" y="${yy+4}" text-anchor="end" class="axis">${fmt(val)}</text>`}).join("");
    const inds=[0,Math.floor((pts.length-1)/2),pts.length-1].filter((v,i,a)=>a.indexOf(v)===i);
    const xt=inds.map(i=>`<text x="${x(i)}" y="${H-8}" text-anchor="${i===0?"start":i===pts.length-1?"end":"middle"}" class="axis">${new Date(pts[i].d).toLocaleDateString(undefined,{month:"numeric",day:"numeric"})}</text>`).join("");
    s.innerHTML=grid+`<path d="${path(pts)}" class="line"/>${second?`<path d="${path(second)}" class="line second"/>`:""}`+pts.map((q,i)=>`<circle cx="${x(i)}" cy="${y(q.v)}" r="4" class="dot"><title>${dt(q.d)}: ${fmt(q.v)}</title></circle>`).join("")+(second?second.map((q,i)=>`<circle cx="${x(i)}" cy="${y(q.v)}" r="3" class="dot second"></circle>`).join(""):"")+xt;
  };

  async function globalCardSearch(){
    const q=el("globalCardSearch")?.value.trim()||"";
    if(q.length<2){el("globalCardSearchStatus").textContent="Enter at least 2 characters.";return}
    showActivity("Searching all scans",`Looking for “${q}”…`);
    try{
      const numeric=/^\d+$/.test(q);
      const filter=numeric?`or=(sku_id.eq.${q},product_id.eq.${q},collector_number.eq.${q})`:`product_name=ilike.*${encodeURIComponent(q)}*`;
      const rows=await rest(`marketplace_scan_rows?select=scan_id,sku_id,product_id,product_name,collector_number,set_name,printing,condition,language,direct_available,direct_low,direct_listings,opportunity_score,flag&${filter}&limit=1000`);
      const ids=[...new Set(rows.map(r=>r.scan_id))];
      const scans=ids.length?await rest(`marketplace_scans?select=scan_id,captured_at&scan_id=in.(${ids.join(",")})`):[];
      const sm=new Map(scans.map(s=>[s.scan_id,s.captured_at])), bySku=new Map();
      for(const r of rows){r.captured_at=sm.get(r.scan_id);if(!r.captured_at)continue;if(!bySku.has(r.sku_id))bySku.set(r.sku_id,[]);bySku.get(r.sku_id).push(r)}
      const cards=[...bySku.values()].map(s=>{s.sort((a,b)=>new Date(a.captured_at)-new Date(b.captured_at));const f=s[0],l=s.at(-1);return {s,f,l,qd:Number(l.direct_available||0)-Number(f.direct_available||0),pd:Number(l.direct_low||0)-Number(f.direct_low||0)}}).sort((a,b)=>new Date(b.l.captured_at)-new Date(a.l.captured_at));
      el("globalCardSearchStatus").textContent=`${cards.length} matching SKU${cards.length===1?"":"s"} • ${rows.length} observations`;
      el("globalCardResults").innerHTML=cards.slice(0,100).map(x=>`<div class="global-card-result"><div><a class="card-link" target="_blank" href="${pageUrl(x.l)}">${x.l.product_name}</a><div class="meta">${x.l.set_name} • #${x.l.collector_number||"—"} • SKU ${x.l.sku_id} • ${x.l.printing}/${x.l.condition}/${x.l.language}</div><div class="meta">${x.s.length} observations • latest ${dt(x.l.captured_at)}</div></div><div class="global-card-metrics"><span>Qty <b>${x.l.direct_available??"—"}</b> <em>${signed(x.qd)}</em></span><span>Direct Low <b>${money(x.l.direct_low)}</b> <em>${signed(x.pd,2,"$")}</em></span><span>Direct listings <b>${x.l.direct_listings??"—"}</b></span><span>Score <b>${x.l.opportunity_score??"—"}</b> / ${x.l.flag||"—"}</span></div></div>`).join("");
    }catch(e){el("globalCardSearchStatus").textContent=`Search failed: ${e.message}`}finally{hideActivity()}
  }

  async function buildLeaderboard(){
    const days=Number(el("leaderPeriod")?.value||7),printing=el("leaderPrinting")?.value||"",condition=el("leaderCondition")?.value||"",minPrice=Number(el("leaderMinPrice")?.value||0),metric=el("leaderMetric")?.value||"composite";
    showActivity("Building leaderboard","Consolidating recent scans…");
    try{
      let path="marketplace_scans?select=scan_id,captured_at,set_name,printing,condition,language&order=captured_at.asc";
      if(days>0)path+=`&captured_at=gte.${encodeURIComponent(new Date(Date.now()-days*86400000).toISOString())}`;
      if(printing)path+=`&printing=eq.${encodeURIComponent(printing)}`;
      if(condition)path+=`&condition=eq.${encodeURIComponent(condition)}`;
      const scans=await rest(path), ids=scans.map(s=>s.scan_id);
      if(!ids.length){el("leaderBody").innerHTML="";el("leaderStatus").textContent="No scans in this period.";hideActivity();return}
      updateActivity(`Loading rows from ${scans.length} scans…`);
      const rows=await rest(`marketplace_scan_rows?select=scan_id,sku_id,product_id,product_name,collector_number,set_name,printing,condition,language,sales_rank,direct_low,direct_listings,direct_available,opportunity_score,flag&scan_id=in.(${ids.join(",")})`);
      const sm=new Map(scans.map(s=>[s.scan_id,s.captured_at])), bySku=new Map();
      for(const r of rows){r.captured_at=sm.get(r.scan_id);if(!r.captured_at||Number(r.direct_low||0)<minPrice)continue;if(!bySku.has(r.sku_id))bySku.set(r.sku_id,[]);bySku.get(r.sku_id).push(r)}
      const out=[];
      for(const s of bySku.values()){
        s.sort((a,b)=>new Date(a.captured_at)-new Date(b.captured_at));const f=s[0],l=s.at(-1),hw=s.filter(r=>r.flag==="HOT"||r.flag==="WATCH").length,h=s.filter(r=>r.flag==="HOT").length,persist=hw/s.length,qd=Number(l.direct_available||0)-Number(f.direct_available||0),pd=Number(l.direct_low||0)-Number(f.direct_low||0),rd=Number(l.sales_rank||0)-Number(f.sales_rank||0),score=Number(l.opportunity_score||0),dep=qd<0?Math.min(100,Math.abs(qd)/Math.max(1,Number(f.direct_available||0))*100):0,pr=pd>0?Math.min(100,pd/Math.max(.01,Number(f.direct_low||.01))*100):0,ri=rd<0?Math.min(100,Math.abs(rd)/Math.max(1,Number(f.sales_rank||1))*100):0,comp=score*.4+persist*20+dep*.2+pr*.1+ri*.1;out.push({s,f,l,hw,h,persist,qd,pd,rd,score,dep,pr,ri,comp});
      }
      const val=x=>({composite:x.comp,score:x.score,persistence:x.persist*100,depletion:x.dep,price:x.pr,rank:x.ri})[metric]||0;out.sort((a,b)=>val(b)-val(a));
      el("leaderStatus").textContent=`${out.length} unique SKUs consolidated from ${scans.length} scans.`;
      el("leaderBody").innerHTML=out.slice(0,100).map(x=>`<tr><td><a class="card-link" target="_blank" href="${pageUrl(x.l)}">${x.l.product_name}</a><div class="meta">#${x.l.collector_number||"—"} • SKU ${x.l.sku_id}</div></td><td>${x.l.set_name}</td><td>${x.l.direct_available??"—"}</td><td>${x.l.direct_listings??"—"}</td><td>${money(x.l.direct_low)}</td><td>${x.score}</td><td>${x.s.length}</td><td>${x.h}/${x.hw}</td><td>${signed(x.qd)}</td><td>${signed(x.pd,2,"$")}</td></tr>`).join("");
    }catch(e){el("leaderStatus").textContent=`Leaderboard failed: ${e.message}`}finally{hideActivity()}
  }

  el("globalCardSearchBtn")?.addEventListener("click",globalCardSearch);
  el("globalCardSearch")?.addEventListener("keydown",e=>{if(e.key==="Enter")globalCardSearch()});
  el("leaderRefresh")?.addEventListener("click",buildLeaderboard);
  ["leaderPeriod","leaderPrinting","leaderCondition","leaderMetric"].forEach(id=>el(id)?.addEventListener("change",buildLeaderboard));
  el("leaderMinPrice")?.addEventListener("change",buildLeaderboard);
})();


/* ===== v033.js ===== */
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


/* ===== v035.js ===== */
// Marketplace Scout web v0.3.5 — PC unified queue status
(() => {
  const el=id=>document.getElementById(id);
  const badge=el("appVersion"); if(badge) badge.textContent="web v0.3.5";

  // PC v0.9.0 places phone requests into the same persistent queue used by
  // manual and auto-sync scans. While the cloud command status remains
  // "running" for compatibility, progress.stage="queued" means the PC has
  // accepted it but is waiting behind other work.
  window.requestProgressHtml=function(x){
    if(x.status!=="running")return "";
    const p=x.progress_json||{},stage=p.stage||"running";
    const queued=stage==="queued"||stage==="pending"||stage==="requeued";
    const pct=Math.max(0,Math.min(100,Number(p.percent||0)));
    const eta=typeof etaText==="function"?etaText(p.etaSec):"";
    const title=queued?(p.detail||"Queued on PC"):(p.detail||stage||"Running…");
    return `<div class="request-progress ${queued?"queued":"active"}">
      <div class="request-progress-head"><span>${title}</span><b>${queued?"QUEUED":`${Math.round(pct)}%`}</b></div>
      ${queued?'<div class="queue-wait-track"><span></span></div>':`<progress max="100" value="${pct}"></progress>`}
      <div class="meta">${[
        queued?"Waiting behind earlier PC scans":`Stage: ${stage}`,
        !queued&&eta?`ETA ${eta}`:""
      ].filter(Boolean).join(" • ")}</div>
    </div>`;
  };
})();


/* ===== v036.js ===== */
// Collectish Marketplace Scout web v0.3.7 — reusable templates + smart scan depth
(() => {
  const el=id=>document.getElementById(id);
  const KEY="collectishMobileProfileTemplatesV1";
  const DEFAULT={id:"default-both-nm-en-100",name:"Smart / Both / NM / English / Top 100",printing:"Both",condition:"Near Mint",language:"English",salesEnrich:100,scanDepth:"Smart"};
  const badge=el("appVersion"); if(badge) badge.textContent="web v0.3.7";

  // Insert Scan depth into New Scan without requiring another HTML migration.
  if(!el("newScanDepth")&&el("newPrinting")){
    const label=document.createElement("label");
    label.innerHTML='Scan depth<select id="newScanDepth"><option value="Smart" selected>Smart — full weekly, top 500 between</option><option value="250">Top 250</option><option value="500">Top 500</option><option value="1000">Top 1,000</option><option value="Full">Full set</option></select>';
    const printingLabel=el("newPrinting").closest("label");
    printingLabel?.parentNode?.insertBefore(label,printingLabel.nextSibling);
  }

  function loadTemplates(){
    try{
      const x=JSON.parse(localStorage.getItem(KEY)||"null");
      if(!Array.isArray(x)||!x.length)return [DEFAULT];
      return x.map(t=>({...t,scanDepth:t.scanDepth||"Smart"}));
    }catch{return [DEFAULT]}
  }
  function saveTemplates(x){localStorage.setItem(KEY,JSON.stringify(x))}
  function renderTemplates(selected=""){
    const sel=el("mobileProfileTemplate"); if(!sel)return;
    const t=loadTemplates();
    sel.innerHTML='<option value="">Custom</option>'+t.map(x=>`<option value="${x.id}">${x.name}</option>`).join("");
    if(selected&&t.some(x=>x.id===selected))sel.value=selected;
  }
  function applyTemplate(t){
    if(!t)return;
    el("newPrinting").value=t.printing||"Both";
    el("newCondition").value=t.condition||"Near Mint";
    el("newLanguage").value=t.language||"English";
    el("newEnrich").value=String(t.salesEnrich??100);
    if(el("newScanDepth"))el("newScanDepth").value=String(t.scanDepth||"Smart");
  }
  el("mobileProfileTemplate")?.addEventListener("change",()=>{
    const t=loadTemplates().find(x=>x.id===el("mobileProfileTemplate").value);if(t)applyTemplate(t);
  });
  el("mobileSaveTemplate")?.addEventListener("click",()=>{
    const name=prompt("Template name:",`${el("newScanDepth")?.value||"Smart"} / ${el("newPrinting").value} / ${el("newCondition").value} / ${el("newLanguage").value} / Top ${el("newEnrich").value}`);if(!name)return;
    const t=loadTemplates(),id=(crypto.randomUUID?crypto.randomUUID():String(Date.now()));
    t.push({id,name,printing:el("newPrinting").value,condition:el("newCondition").value,language:el("newLanguage").value,salesEnrich:Number(el("newEnrich").value||0),scanDepth:el("newScanDepth")?.value||"Smart"});
    saveTemplates(t);renderTemplates(id);
  });
  el("mobileDeleteTemplate")?.addEventListener("click",()=>{
    const id=el("mobileProfileTemplate")?.value;if(!id)return;
    saveTemplates(loadTemplates().filter(x=>x.id!==id));renderTemplates("");
  });

  // Override New Scan submission so scanDepth travels through the existing
  // marketplace_scan_commands profile_json. The PC queue honors it identically
  // for phone, manual, and auto-sync work.
  el("queueNew")?.addEventListener("click",async e=>{
    e.preventDefault();e.stopImmediatePropagation();
    const opt=el("newSet")?.selectedOptions?.[0];
    if(!opt?.value){el("newScanMsg").textContent="Select a set.";return}
    const p={
      setSlug:opt.value,setName:opt.dataset.name||opt.textContent,
      printing:el("newPrinting").value,condition:el("newCondition").value,
      language:el("newLanguage").value,salesEnrich:Number(el("newEnrich").value||0),
      scanDepth:el("newScanDepth")?.value||"Smart"
    };
    try{
      showActivity("Queueing scan",`${p.setName} • ${p.scanDepth} depth • sending request to cloud…`);
      el("newScanMsg").textContent="Sending request…";
      const s=await valid();
      await rest("marketplace_scan_commands",{method:"POST",body:[{user_id:s.user.id,profile_json:p,status:"pending"}],prefer:"return=minimal"});
      el("newScanMsg").textContent=`Queued ${p.setName} • ${p.scanDepth}. Waiting for PC.`;
      showActivity("Scan queued",`${p.setName} • ${p.scanDepth} • waiting for PC`);
      setTimeout(hideActivity,1800);
      load();
    }catch(err){hideActivity();el("newScanMsg").textContent=err.message}
  },true);

  // Keep aggregate analytics coverage-compatible. A Smart Top-500 refresh must
  // never look like an inventory collapse versus a prior Full scan. The existing
  // exact-printing analytics implementation remains responsible for Normal/Foil
  // separation; this wrapper only removes incompatible coverage cohorts.
  const priorAnalytics=window.analytics;
  const coverageKey=s=>{
    const p=s?.profile_json||{};
    return p.coverageFull===false?`top-${Number(p.coverageLimit||p.scannedSearchPositions||500)}`:"full";
  };
  if(typeof priorAnalytics==="function"){
    window.analytics=async function(){
      const key=el("analyticsProfile")?.value;
      if(!key||typeof scansCache==="undefined")return priorAnalytics();
      const [slug,mode,condition,language]=key.split("|");
      const relevant=scansCache.filter(s=>s.set_slug===slug&&s.condition===condition&&s.language===language&&(s.printing===mode||s.printing==="Both"||mode==="Both"));
      if(!relevant.length)return priorAnalytics();
      const latest=[...relevant].sort((a,b)=>new Date(a.captured_at)-new Date(b.captured_at)).at(-1);
      const cohort=coverageKey(latest),original=scansCache;
      scansCache=original.filter(s=>{
        const same=s.set_slug===slug&&s.condition===condition&&s.language===language&&(s.printing===mode||s.printing==="Both"||mode==="Both");
        return !same||coverageKey(s)===cohort;
      });
      try{return await priorAnalytics()}finally{scansCache=original}
    };
  }

  renderTemplates("default-both-nm-en-100");
  applyTemplate(DEFAULT);
})();


/* ===== v038.js ===== */
// Collectish Marketplace Scout web v0.3.8 — mobile parity / queue + smart-depth visibility
(() => {
  const el=id=>document.getElementById(id);

  function depthLabel(p={}){
    const requested=p.scanDepthRequested||p.scanDepth||"Smart";
    const resolved=p.scanDepthResolved||requested;
    if(requested==="Smart"&&resolved!=="Smart") return `Smart → ${resolved}`;
    return resolved;
  }
  function statusClass(s){return ["complete","failed","running","pending"].includes(s)?s:"pending"}
  function fmt(v){return v?new Date(v).toLocaleString():"—"}

  if(el("newScanDepth")&&!document.getElementById("mobileSmartDepthHelp")){
    const help=document.createElement("div");
    help.id="mobileSmartDepthHelp";
    help.className="meta mobile-capability-note";
    help.textContent="Smart depth: first/full baseline, then Top 500 refreshes until the full baseline is 7 days old, then Full again. The PC applies the same policy to phone, manual, and auto-sync jobs.";
    el("newScanDepth").closest("label")?.appendChild(help);
  }

  if(!el("mobileDataSources")){
    const card=document.createElement("section");
    card.id="mobileDataSources";
    card.className="card";
    card.innerHTML=`<h2>Data sources</h2>
      <div class="mobile-source-row"><div><b>Marketplace</b><div class="meta">Shared scans, exact-SKU analytics, Normal/Foil separation, Smart depth.</div></div><span class="mobile-source-badge on">Shared</span></div>
      <div class="mobile-source-row"><div><b>EDHREC Commander demand</b><div class="meta">Optional independent demand / reprint source. Collection and history currently live on the PC extension.</div></div><span class="mobile-source-badge">PC-local</span></div>
      <div class="meta mobile-capability-note">EDHREC does not alter HOT/WATCH yet. Mobile EDHREC browsing will require source snapshots to be synchronized to the shared database; keeping it PC-local for now preserves the independent-source deployment boundary.</div>`;
    const analytics=[...document.querySelectorAll("section.card")].find(s=>s.querySelector("h2")?.textContent==="Mobile analytics");
    analytics?.parentNode?.insertBefore(card,analytics);
  }

  if(!el("mobileQueueDetail")){
    const card=document.createElement("section");
    card.id="mobileQueueDetail";
    card.className="card";
    card.innerHTML=`<div class="toolbar"><div><h2>PC scan queue</h2><div class="meta">Phone requests with printing, Smart/fixed depth, and enrichment settings.</div></div><button id="mobileQueueRefresh">Refresh</button></div><div id="mobileQueueRows"></div>`;
    const requests=[...document.querySelectorAll("section.card")].find(s=>s.querySelector("h2")?.textContent==="Requests");
    requests?.parentNode?.insertBefore(card,requests);
  }

  async function refreshQueueDetail(){
    if(typeof rest!=="function"||!el("mobileQueueRows"))return;
    try{
      const rows=await rest("marketplace_scan_commands?select=*&order=requested_at.desc&limit=30");
      el("mobileQueueRows").innerHTML=rows.length?rows.map(x=>{
        const p=x.profile_json||{},pr=x.progress_json||{},pct=Math.max(0,Math.min(100,Number(pr.percent||0)));
        return `<div class="mobile-queue-job ${statusClass(x.status)}">
          <div class="mobile-queue-head"><div><b>${p.setName||p.setSlug||"Unknown set"}</b><div class="meta">${p.printing||"Both"} / ${p.condition||"Near Mint"} / ${p.language||"English"} • ${depthLabel(p)} • Top ${Number(p.salesEnrich||0)}</div></div><span class="mobile-status ${statusClass(x.status)}">${String(x.status||"pending").toUpperCase()}</span></div>
          <div class="meta">Requested ${fmt(x.requested_at)}${x.started_at?` • Started ${fmt(x.started_at)}`:""}</div>
          ${["running","pending"].includes(x.status)?`<div class="mobile-progress-line"><progress max="100" value="${pct}"></progress><span>${Math.round(pct)}%</span></div><div class="meta">${pr.detail||pr.stage||(x.status==="pending"?"Waiting for PC":"Running")}${pr.etaSec?` • ETA ~${Math.ceil(Number(pr.etaSec)/60)}m`:""}</div>`:""}
          ${x.error_message?`<div class="mobile-error">${x.error_message}</div>`:""}
        </div>`;
      }).join(""):'<div class="meta">No recent phone scan requests.</div>';
    }catch(e){el("mobileQueueRows").innerHTML=`<div class="mobile-error">${e.message}</div>`}
  }
  el("mobileQueueRefresh")?.addEventListener("click",refreshQueueDetail);
  setInterval(refreshQueueDetail,15000);
  setTimeout(refreshQueueDetail,600);

  async function refreshCoverageSummary(){
    if(typeof rest!=="function")return;
    try{
      const scans=await rest("marketplace_scans?select=scan_id,captured_at,set_name,printing,condition,language,unique_skus,hot_count,watch_count,profile_json&order=captured_at.desc&limit=15");
      let host=el("mobileCoverageHistory");
      if(!host){
        const latest=[...document.querySelectorAll("section.card")].find(s=>s.querySelector("h2")?.textContent==="Latest scans");
        if(!latest)return;
        host=document.createElement("div");host.id="mobileCoverageHistory";latest.appendChild(host);
      }
      host.innerHTML=`<div class="mobile-coverage-list">${scans.map(s=>{const p=s.profile_json||{};const coverage=p.coverageFull===false?(p.scanDepthResolved||`Top ${p.coverageLimit||p.scannedSearchPositions||"?"}`):(p.scanDepthResolved||p.scanDepthRequested||"Full");return `<div class="mobile-coverage-row"><div><b>${s.set_name}</b><div class="meta">${s.printing} / ${s.condition} / ${s.language} • ${coverage}</div></div><div class="mobile-coverage-metrics"><b>${Number(s.unique_skus||0).toLocaleString()} SKUs</b><span>${Number(s.hot_count||0)} HOT / ${Number(s.watch_count||0)} WATCH</span></div></div>`}).join("")}</div>`;
    }catch(e){}
  }
  setTimeout(refreshCoverageSummary,1000);
})();


/* ===== v039.js ===== */
// Collectish Marketplace Scout web v0.3.9 — local-first card autocomplete
(() => {
  const el=id=>document.getElementById(id);
  const CACHE_KEY="collectishMobileCardAutocompleteV1",MAX_AGE=24*60*60*1000;
  let index=[];

  const norm=s=>String(s||"").normalize("NFKD").toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g," ").trim();
  function getCache(){try{return JSON.parse(localStorage.getItem(CACHE_KEY)||"null")}catch{return null}}
  function saveCache(rows){localStorage.setItem(CACHE_KEY,JSON.stringify({savedAt:Date.now(),rows}))}
  function dedupe(rows){
    const m=new Map();
    for(const r of rows||[]){
      if(!r.product_name)continue;const key=norm(r.product_name),x=m.get(key)||{name:r.product_name,key,skus:new Set(),products:new Set(),sets:new Set()};
      if(r.sku_id)x.skus.add(String(r.sku_id));if(r.product_id)x.products.add(String(r.product_id));if(r.set_name)x.sets.add(r.set_name);m.set(key,x);
    }
    return [...m.values()].map(x=>({...x,skus:[...x.skus],products:[...x.products],sets:[...x.sets]}));
  }
  async function refreshIndex(force=false){
    const cached=getCache();
    if(cached?.rows?.length){index=cached.rows}
    if(!force&&cached&&Date.now()-cached.savedAt<MAX_AGE)return;
    if(typeof rest!=="function")return;
    try{
      const rows=[];let offset=0;
      for(let page=0;page<10;page++){
        const chunk=await rest(`marketplace_scan_rows?select=product_name,sku_id,product_id,set_name&order=product_name.asc&limit=1000&offset=${offset}`);
        rows.push(...chunk);if(chunk.length<1000)break;offset+=1000;
      }
      index=dedupe(rows);saveCache(index);
    }catch(e){console.warn("Mobile autocomplete index",e)}
  }
  function matches(q,limit=10){
    q=norm(q);if(q.length<2)return[];const numeric=/^\d+$/.test(q),out=[];
    for(const x of index){let score=999;
      if(numeric){if(x.skus.includes(q)||x.products.includes(q))score=0;else if(x.skus.some(v=>v.startsWith(q))||x.products.some(v=>v.startsWith(q)))score=2}
      else if(x.key===q)score=0;else if(x.key.startsWith(q))score=1;else{const wi=x.key.split(" ").findIndex(w=>w.startsWith(q));if(wi>=0)score=2+wi*.01;else{const i=x.key.indexOf(q);if(i>=0)score=5+i/100}}
      if(score<999)out.push({x,score});
    }
    return out.sort((a,b)=>a.score-b.score||a.x.name.localeCompare(b.x.name)).slice(0,limit).map(v=>v.x);
  }
  function attach(id,{submit=false}={}){
    const input=el(id);if(!input||el(`${id}Autocomplete`))return;
    const wrap=document.createElement("div");wrap.className="mobile-autocomplete-wrap";input.parentNode.insertBefore(wrap,input);wrap.appendChild(input);
    const menu=document.createElement("div");menu.id=`${id}Autocomplete`;menu.className="mobile-autocomplete-menu";menu.hidden=true;wrap.appendChild(menu);
    let active=-1,current=[];
    const close=()=>{menu.hidden=true;menu.innerHTML="";active=-1};
    const choose=x=>{input.value=x.name;close();input.dispatchEvent(new Event("input",{bubbles:true}));if(submit)el("globalCardSearchBtn")?.click()};
    const render=()=>{current=matches(input.value);if(!current.length){close();return}menu.innerHTML=current.map((x,i)=>`<button type="button" class="mobile-autocomplete-item${i===active?" active":""}" data-i="${i}"><b>${x.name}</b><span>${[x.sets.slice(0,2).join(" • "),x.skus.length?`${x.skus.length} SKU${x.skus.length===1?"":"s"}`:""].filter(Boolean).join(" • ")}</span></button>`).join("");menu.hidden=false;menu.querySelectorAll("button").forEach(b=>b.addEventListener("pointerdown",e=>{e.preventDefault();choose(current[Number(b.dataset.i)])}))};
    input.addEventListener("input",render);input.addEventListener("focus",render);input.addEventListener("blur",()=>setTimeout(close,120));
    input.addEventListener("keydown",e=>{if(menu.hidden||!current.length)return;if(e.key==="ArrowDown"){e.preventDefault();active=(active+1)%current.length;render()}else if(e.key==="ArrowUp"){e.preventDefault();active=(active-1+current.length)%current.length;render()}else if(e.key==="Enter"&&active>=0){e.preventDefault();choose(current[active])}else if(e.key==="Escape")close()});
  }
  function addStyles(){if(el("mobileAutocompleteStyles"))return;const s=document.createElement("style");s.id="mobileAutocompleteStyles";s.textContent=`.mobile-autocomplete-wrap{position:relative;min-width:0;width:100%}.mobile-autocomplete-wrap>input{width:100%}.mobile-autocomplete-menu{position:absolute;left:0;right:0;top:calc(100% + 3px);z-index:200;background:#fff;border:1px solid #c8d0dc;border-radius:10px;box-shadow:0 8px 24px rgba(23,32,51,.18);max-height:320px;overflow:auto;padding:4px}.mobile-autocomplete-menu[hidden]{display:none}.mobile-autocomplete-item{display:flex;width:100%;flex-direction:column;align-items:flex-start;gap:2px;border:0;background:#fff;padding:10px;text-align:left;border-radius:7px}.mobile-autocomplete-item.active,.mobile-autocomplete-item:active{background:#edf4ff}.mobile-autocomplete-item span{font-size:10px;color:#718096}`;document.head.appendChild(s)}
  async function init(){addStyles();const cached=getCache();if(cached?.rows?.length)index=cached.rows;attach("globalCardSearch",{submit:true});attach("productHistorySearch");attach("moverSearch");await refreshIndex(false)}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>init());else init();
})();


/* ===== v042.js ===== */
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


/* ===== v044.js ===== */
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


/* ===== v045.js ===== */
// Collectish Marketplace Scout web v0.4.5 — visual leaderboard event wiring
(() => {
  const el=id=>document.getElementById(id);
  const badge=el("appVersion");if(badge)badge.textContent="web v0.4.5";
  const run=e=>{e?.preventDefault?.();e?.stopImmediatePropagation?.();window.buildLeaderboard?.()};
  el("leaderRefresh")?.addEventListener("click",run,true);
  ["leaderPeriod","leaderPrinting","leaderCondition","leaderMetric","leaderMinPrice"].forEach(id=>el(id)?.addEventListener("change",run,true));
  // Re-run once after the app has populated scan data and the v0.4.4 visual shell exists.
  setTimeout(()=>{try{if(localStorage.getItem("collectishSession"))window.buildLeaderboard?.()}catch{}},1800);
})();

// Load v0.4.6 component-breakdown / power-user layer after the visual leaderboard.
(() => {
  if(!document.querySelector('link[data-collectish-v046]')){
    const l=document.createElement("link");l.rel="stylesheet";l.href="v046.css?v=046";l.dataset.collectishV046="1";document.head.appendChild(l);
  }
  if(document.querySelector('script[data-collectish-v046]'))return;
  const s=document.createElement("script");s.src="v046.js?v=046";s.dataset.collectishV046="1";document.head.appendChild(s);
})();


/* ===== v046.js ===== */
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


/* ===== v047.js ===== */
// Collectish Marketplace Scout web v0.4.7 — scan set release-date ordering
(() => {
  const el=id=>document.getElementById(id);
  const KEY="collectishScryfallSetReleaseDatesV1",MAX_AGE=30*86400000;
  let dates=null,scheduled=false;
  const norm=s=>String(s||"").trim().toLowerCase();
  function read(){try{return JSON.parse(localStorage.getItem(KEY)||"null")}catch{return null}}
  function write(v){try{localStorage.setItem(KEY,JSON.stringify(v))}catch{}}
  async function loadDates(){
    if(dates)return dates;
    const cached=read();
    if(cached?.items&&Date.now()-Number(cached.savedAt||0)<MAX_AGE){dates=cached.items;return dates}
    try{
      const r=await fetch("https://api.scryfall.com/sets",{headers:{"Accept":"application/json;q=0.9,*/*;q=0.8"}});
      if(!r.ok)throw Error(`Scryfall HTTP ${r.status}`);
      const d=await r.json(),items={};
      for(const s of d.data||[])if(s?.name)items[norm(s.name)]={releasedAt:s.released_at||null,code:s.code||null};
      dates=items;write({savedAt:Date.now(),items});return dates;
    }catch(e){console.warn("Set release-date lookup",e);dates=cached?.items||{};return dates}
  }
  function setName(option){return String(option.textContent||"").replace(/\s+\(\d[\d,]*\)\s*$/," ").trim()}
  function releaseFor(option){return dates?.[norm(setName(option))]?.releasedAt||null}
  function reorder(){
    const sel=el("newSet");if(!sel||!dates)return;
    const placeholder=[...sel.options].find(o=>!o.value)||null;
    const opts=[...sel.options].filter(o=>o.value),selected=sel.value;
    const desired=[...opts].sort((a,b)=>{
      const ad=releaseFor(a),bd=releaseFor(b),an=setName(a),bn=setName(b);
      if(ad&&bd&&ad!==bd)return bd.localeCompare(ad);
      if(ad&&!bd)return -1;if(!ad&&bd)return 1;
      return an.localeCompare(bn,undefined,{numeric:true});
    });
    const current=opts.map(o=>o.value).join("\u0001"),next=desired.map(o=>o.value).join("\u0001");
    if(current===next)return;
    const frag=document.createDocumentFragment();if(placeholder)frag.appendChild(placeholder);for(const o of desired){const d=releaseFor(o);if(d)o.dataset.releaseDate=d;frag.appendChild(o)}sel.appendChild(frag);sel.value=selected;
  }
  function schedule(){if(scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;reorder()},40)}
  async function init(){
    await loadDates();reorder();
    const sel=el("newSet");if(sel){new MutationObserver(schedule).observe(sel,{childList:true})}
    const status=el("setCacheStatus");if(status&&!document.getElementById("setReleaseOrderNote")){
      const note=document.createElement("div");note.id="setReleaseOrderNote";note.className="meta";note.textContent="Sets are ordered newest release first; unmatched dates appear last.";status.insertAdjacentElement("afterend",note);
    }
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();

// Bootstrap the unified Collectish shell even for clients still holding an older cached index.html.
(() => {
  if(document.querySelector('script[data-collectish-v050]'))return;
  const s=document.createElement("script");
  s.src=`v050.js?v=050-${Date.now()}`;
  s.dataset.collectishV050="1";
  s.onload=()=>{
    const force=()=>{const b=document.getElementById("appVersion");if(b)b.textContent="web v0.5.0"};
    force();
    let n=0;const t=setInterval(()=>{force();if(++n>=24)clearInterval(t)},250);
  };
  document.head.appendChild(s);
})();


/* ===== v048.js ===== */
// Collectish Marketplace Scout web v0.4.8 — System / Light / Dark theme
(() => {
  const el=id=>document.getElementById(id);
  const badge=el("appVersion"); if(badge) badge.textContent="web v0.4.8";
  const KEY="collectishThemeModeV1";
  const valid=m=>["system","light","dark"].includes(m)?m:"system";
  const effective=m=>m==="dark"?"dark":m==="light"?"light":window.matchMedia?.("(prefers-color-scheme: dark)")?.matches?"dark":"light";
  function apply(mode){
    mode=valid(mode);const e=effective(mode);
    document.documentElement.dataset.theme=e;
    document.documentElement.dataset.themeMode=mode;
    document.documentElement.style.colorScheme=e;
    const s=el("mobileThemeMode");if(s&&s.value!==mode)s.value=mode;
  }
  function ensureControl(){
    const settings=el("mobileSettingsCard");if(!settings||el("mobileThemeMode"))return false;
    const wrap=document.createElement("div");wrap.className="mobile-theme-setting";
    wrap.innerHTML='<label>Appearance<select id="mobileThemeMode"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><div class="meta">System follows your device preference. Card artwork is never inverted.</div>';
    const signout=el("mobileSignOutMirror");settings.insertBefore(wrap,signout||null);
    const select=el("mobileThemeMode");select.value=valid(localStorage.getItem(KEY)||"system");select.addEventListener("change",()=>{localStorage.setItem(KEY,select.value);apply(select.value)});
    return true;
  }
  apply(localStorage.getItem(KEY)||"system");
  const mq=window.matchMedia?.("(prefers-color-scheme: dark)");mq?.addEventListener?.("change",()=>{if((document.documentElement.dataset.themeMode||"system")==="system")apply("system")});
  let tries=0;const t=setInterval(()=>{tries++;if(ensureControl()||tries>80)clearInterval(t)},250);
})();

// Load Scout preparation feedback without another index migration.
(() => {
  if(document.querySelector('script[data-collectish-v049]'))return;
  const s=document.createElement("script");s.src="v049.js?v=049";s.dataset.collectishV049="1";document.head.appendChild(s);
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
  load('062');
})();


/* ===== v050.js ===== */
// Collectish web v0.5.0 — unified cloud app shell
(() => {
  const el=id=>document.getElementById(id);
  const badge=el("appVersion");if(badge)badge.textContent="web v0.5.0";
  if(!document.querySelector('link[data-collectish-v050]')){const l=document.createElement("link");l.rel="stylesheet";l.href="v050.css?v=050";l.dataset.collectishV050="1";document.head.appendChild(l)}

  const money=v=>`$${Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const date=v=>v?new Date(v).toLocaleDateString():"—";
  const esc=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
  const sum=(rows,key)=>rows.reduce((n,r)=>n+Number(r[key]||0),0);
  const agoDays=n=>new Date(Date.now()-n*86400000).toISOString();
  const state={loaded:new Set(),sales:null,direct:null,money:null};

  function classifyOriginalSections(){
    const app=el("app");if(!app)return;
    for(const section of [...app.children].filter(x=>x.tagName==="SECTION")){
      const title=(section.querySelector("h2")?.textContent||"").trim();
      let page="scout";
      if(["PC status","New scan","Scan profiles","Requests"].includes(title))page="operations";
      else if(title==="Find any scanned card")page="cards";
      else page="scout";
      section.dataset.collectishPage=page;
    }
  }

  function makeHost(id,title,subtitle){
    const host=document.createElement("div");host.id=id;host.className="collectish-page-host";
    host.innerHTML=`<div class="collectish-page-title"><div><h2>${title}</h2><p class="meta">${subtitle}</p></div><button class="collectish-refresh" type="button">Refresh</button></div><div class="collectish-page-body"><div class="collectish-section"><div class="collectish-empty">Open this section to load cloud data.</div></div></div>`;
    el("app").appendChild(host);
    return host;
  }

  function installShell(){
    const app=el("app");if(!app||el("collectishProductNav"))return false;
    classifyOriginalSections();
    const nav=document.createElement("nav");nav.id="collectishProductNav";nav.className="collectish-product-nav";
    const pages=[["scout","Scout"],["cards","Cards"],["sales","Sales"],["direct","Direct"],["money","Money"],["operations","Operations"]];
    nav.innerHTML=pages.map(([id,label])=>`<button type="button" data-page="${id}">${label}</button>`).join("");
    app.insertBefore(nav,app.firstChild);
    makeHost("collectishSalesPage","Sales","Orders, realized selling activity, and product performance from the shared Collectish ledger.");
    makeHost("collectishDirectPage","Direct","SYP eligibility, reimbursement invoices, and discrepancy history.");
    makeHost("collectishMoneyPage","Money","Payments, fees, refunds, adjustments, and reconciliation signals.");
    nav.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.page)));
    for(const host of [el("collectishSalesPage"),el("collectishDirectPage"),el("collectishMoneyPage")])host.querySelector(".collectish-refresh").addEventListener("click",()=>loadPage(host.id.replace("collectish","").replace("Page","").toLowerCase(),true));
    showPage(localStorage.getItem("collectishPage")||"scout");
    return true;
  }

  function showPage(page){
    localStorage.setItem("collectishPage",page);
    document.querySelectorAll("#collectishProductNav button").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
    document.querySelectorAll("#app > section[data-collectish-page]").forEach(s=>s.classList.toggle("collectish-page-hidden",s.dataset.collectishPage!==page));
    const hosts={sales:el("collectishSalesPage"),direct:el("collectishDirectPage"),money:el("collectishMoneyPage")};
    Object.entries(hosts).forEach(([k,h])=>h?.classList.toggle("active",k===page));
    if(hosts[page])loadPage(page,false);
    window.scrollTo({top:0,behavior:"smooth"});
  }

  async function query(path){return await rest(path)}

  async function loadPage(page,force){
    if(state.loaded.has(page)&&!force)return;
    const host={sales:el("collectishSalesPage"),direct:el("collectishDirectPage"),money:el("collectishMoneyPage")}[page];if(!host)return;
    const body=host.querySelector(".collectish-page-body");body.innerHTML='<div class="collectish-section"><div class="collectish-empty">Loading Collectish Cloud…</div></div>';
    try{
      if(page==="sales")await loadSales(body);
      if(page==="direct")await loadDirect(body);
      if(page==="money")await loadMoney(body);
      state.loaded.add(page);
    }catch(e){body.innerHTML=`<div class="collectish-section"><div class="collectish-empty">${esc(e.message)}</div></div>`}
  }

  async function loadSales(body){
    const since=encodeURIComponent(agoDays(90));
    const [orders,items]=await Promise.all([
      query(`seller_orders?select=order_number,order_date,order_fulfillment,order_status,gross_amount,fee_amount,direct_fee_amount,net_amount,refund_total&order_date=gte.${since}&order=order_date.desc&limit=1000`),
      query(`seller_order_items?select=order_number,order_date,product_name,product_id,sku_id,quantity,extended_price,order_fulfillment&order_date=gte.${since}&order=order_date.desc&limit=1000`)
    ]);
    const gross=sum(orders,"gross_amount"),refunds=sum(orders,"refund_total"),fees=orders.reduce((n,r)=>n+Number(r.fee_amount||0)+Number(r.direct_fee_amount||0),0),net=orders.reduce((n,r)=>n+Number(r.net_amount||0)-Number(r.refund_total||0),0);
    const bySku=new Map();for(const r of items){const k=r.sku_id||r.product_id||r.product_name;const x=bySku.get(k)||{name:r.product_name,sku:r.sku_id,qty:0,sales:0};x.qty+=Number(r.quantity||0);x.sales+=Number(r.extended_price||0);bySku.set(k,x)}
    const top=[...bySku.values()].sort((a,b)=>b.sales-a.sales).slice(0,15);
    body.innerHTML=`<div class="collectish-kpi-grid">${[["Orders (90d)",orders.length.toLocaleString()],["Gross",money(gross)],["Fees",money(fees)],["Net after refunds",money(net)]].map(([a,b])=>`<div class="collectish-kpi"><span>${a}</span><strong>${b}</strong></div>`).join("")}</div>
      <div class="collectish-section"><h3>Recent orders</h3><div class="meta">Latest cloud-backed orders from the last 90 days. Showing up to 100.</div><div class="collectish-mobile-table"><table><thead><tr><th>Date</th><th>Order</th><th>Type</th><th>Gross</th><th>Fees</th><th>Refund</th><th>Net</th></tr></thead><tbody>${orders.slice(0,100).map(r=>`<tr><td>${date(r.order_date)}</td><td>${esc(r.order_number)}</td><td>${esc(r.order_fulfillment||"")}</td><td>${money(r.gross_amount)}</td><td>${money(Number(r.fee_amount||0)+Number(r.direct_fee_amount||0))}</td><td>${money(r.refund_total)}</td><td>${money(Number(r.net_amount||0)-Number(r.refund_total||0))}</td></tr>`).join("")}</tbody></table></div></div>
      <div class="collectish-section"><h3>Top products in loaded 90-day activity</h3><div class="meta">Based on the most recent cloud order-item rows currently loaded.</div><div class="collectish-mobile-table"><table><thead><tr><th>Product</th><th>SKU</th><th>Units</th><th>Sales</th></tr></thead><tbody>${top.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.sku||"")}</td><td>${x.qty.toLocaleString()}</td><td>${money(x.sales)}</td></tr>`).join("")}</tbody></table></div></div>`;
  }

  async function loadDirect(body){
    const [products,events,ris,disc]=await Promise.all([
      query("syp_products?select=tcgplayer_id,product_name,set_name,condition,market_price,current_max_quantity,first_seen,last_seen,is_currently_eligible&is_currently_eligible=eq.true&order=last_seen.desc&limit=1000"),
      query("syp_events?select=changed_at,event_type,tcgplayer_id,product_name,set_name,old_value,new_value,difference&order=changed_at.desc&limit=100"),
      query("reimbursement_invoices?select=ri_number,created_date,status,total_product_count,total_product_value,total_replacement_fees,discrepancy_quantity,discrepancy_row_count&order=created_date.desc&limit=100"),
      query("ri_discrepancies?select=ri_number,product_name,set_name,expected_condition,quantity,discrepancy,discrepancy_reason,replacement_fee&limit=1000")
    ]);
    const open=ris.filter(r=>String(r.status||"").toUpperCase()!=="COMPLETED"),discQty=sum(disc,"discrepancy"),replacement=sum(ris,"total_replacement_fees");
    body.innerHTML=`<div class="collectish-kpi-grid">${[["SYP eligible",products.length.toLocaleString()],["Recent SYP changes",events.length.toLocaleString()],["Open RIs",open.length.toLocaleString()],["RI replacement fees",money(replacement)]].map(([a,b])=>`<div class="collectish-kpi"><span>${a}</span><strong>${b}</strong></div>`).join("")}</div>
      <div class="collectish-section"><h3>Latest SYP changes</h3><div class="collectish-mobile-table"><table><thead><tr><th>Changed</th><th>Type</th><th>Product</th><th>Set</th><th>Old</th><th>New</th></tr></thead><tbody>${events.slice(0,50).map(r=>`<tr><td>${date(r.changed_at)}</td><td><span class="collectish-status-pill">${esc(r.event_type)}</span></td><td>${esc(r.product_name)}</td><td>${esc(r.set_name)}</td><td>${r.old_value??"—"}</td><td>${r.new_value??"—"}</td></tr>`).join("")}</tbody></table></div></div>
      <div class="collectish-section"><h3>Reimbursement invoices</h3><div class="meta">Newest RI records from Seller History cloud backup.</div><div class="collectish-mobile-table"><table><thead><tr><th>RI</th><th>Date</th><th>Status</th><th>Products</th><th>Value</th><th>Discrepancies</th><th>Replacement fees</th></tr></thead><tbody>${ris.map(r=>`<tr><td>${esc(r.ri_number)}</td><td>${date(r.created_date)}</td><td>${esc(r.status)}</td><td>${Number(r.total_product_count||0).toLocaleString()}</td><td>${money(r.total_product_value)}</td><td>${Number(r.discrepancy_quantity||0).toLocaleString()}</td><td>${money(r.total_replacement_fees)}</td></tr>`).join("")}</tbody></table></div></div>`;
  }

  async function loadMoney(body){
    const [payments,adjustments]=await Promise.all([
      query("seller_payments?select=payment_id,arrival_date,initiated_on,order_count,total_sales,total_fees,refunded_orders,refunded_fees,adjustments,payment,is_pending&order=initiated_on.desc&limit=250"),
      query("seller_payment_adjustments?select=payment_id,amount,reason,order_number,ri_number&limit=1000")
    ]);
    const paid=sum(payments,"payment"),sales=sum(payments,"total_sales"),fees=sum(payments,"total_fees"),refunds=sum(payments,"refunded_orders"),adjustmentTotal=sum(adjustments,"amount");
    body.innerHTML=`<div class="collectish-kpi-grid">${[["Payment batches",payments.length.toLocaleString()],["Sales in batches",money(sales)],["Fees",money(fees)],["Payments",money(paid)]].map(([a,b])=>`<div class="collectish-kpi"><span>${a}</span><strong>${b}</strong></div>`).join("")}</div>
      <div class="collectish-section"><h3>Payment history</h3><div class="meta">Cloud-backed TCGplayer payment batches. Refunds ${money(refunds)} • parsed adjustment rows ${adjustments.length.toLocaleString()} (${money(adjustmentTotal)}).</div><div class="collectish-mobile-table"><table><thead><tr><th>Initiated</th><th>Orders</th><th>Sales</th><th>Fees</th><th>Refunded</th><th>Adjustments</th><th>Payment</th></tr></thead><tbody>${payments.slice(0,100).map(r=>`<tr><td>${date(r.initiated_on||r.arrival_date)}</td><td>${Number(r.order_count||0).toLocaleString()}</td><td>${money(r.total_sales)}</td><td>${money(r.total_fees)}</td><td>${money(r.refunded_orders)}</td><td>${money(r.adjustments)}</td><td><strong>${money(r.payment)}</strong></td></tr>`).join("")}</tbody></table></div></div>
      <div class="collectish-section"><h3>Recent adjustments</h3><div class="collectish-mobile-table"><table><thead><tr><th>Payment</th><th>Amount</th><th>Order</th><th>RI</th><th>Reason</th></tr></thead><tbody>${adjustments.slice(0,100).map(r=>`<tr><td>${esc(r.payment_id)}</td><td>${money(r.amount)}</td><td>${esc(r.order_number||"")}</td><td>${esc(r.ri_number||"")}</td><td>${esc(r.reason||"")}</td></tr>`).join("")}</tbody></table></div></div>`;
  }

  let tries=0;const timer=setInterval(()=>{tries++;if(installShell()||tries>120)clearInterval(timer)},100);
})();


/* ===== v051.js ===== */
// Collectish web v0.5.1 — Supabase project-user password recovery
(() => {
  const el=id=>document.getElementById(id);
  const setBadge=()=>{const b=el("appVersion");if(b)b.textContent="web v0.5.1"};
  setBadge();setTimeout(setBadge,600);setTimeout(setBadge,3000);
  if(!document.querySelector('link[data-collectish-v051]')){
    const l=document.createElement("link");l.rel="stylesheet";l.href="v051.css?v=051";l.dataset.collectishV051="1";document.head.appendChild(l);
  }

  function ensureRecoveryUi(){
    const login=el("login");if(!login||el("forgotPassword"))return false;
    const grid=login.querySelector(".grid");
    const forgot=document.createElement("button");
    forgot.id="forgotPassword";forgot.type="button";forgot.className="collectish-forgot";forgot.textContent="Forgot password?";
    grid?.insertAdjacentElement("afterend",forgot);

    const panel=document.createElement("div");
    panel.id="passwordRecoveryPanel";panel.className="password-recovery-panel";panel.hidden=true;
    panel.innerHTML=`
      <div id="passwordRecoveryRequest" class="password-recovery-step">
        <h3>Reset Collectish password</h3>
        <p class="meta">We'll send a reset link to the Supabase project user email used by Collectish.</p>
        <div class="password-recovery-row"><input id="recoveryEmail" type="email" placeholder="Email"><button id="sendRecoveryEmail" type="button" class="primary">Send reset email</button></div>
      </div>
      <div id="passwordRecoverySet" class="password-recovery-step" hidden>
        <h3>Choose a new password</h3>
        <p class="meta">This changes only the Collectish Supabase Auth user password, not your Supabase dashboard or database password.</p>
        <div class="password-recovery-row"><input id="newRecoveryPassword" type="password" autocomplete="new-password" placeholder="New password"><input id="confirmRecoveryPassword" type="password" autocomplete="new-password" placeholder="Confirm password"><button id="saveRecoveryPassword" type="button" class="primary">Set new password</button></div>
      </div>
      <div id="passwordRecoveryMsg" class="meta password-recovery-message"></div>`;
    login.appendChild(panel);

    forgot.addEventListener("click",()=>{
      panel.hidden=!panel.hidden;
      const email=el("email")?.value||"";if(email)el("recoveryEmail").value=email;
    });
    el("sendRecoveryEmail").addEventListener("click",sendRecovery);
    el("saveRecoveryPassword").addEventListener("click",saveNewPassword);
    return true;
  }

  async function sendRecovery(){
    const email=(el("recoveryEmail")?.value||el("email")?.value||"").trim();
    const msg=el("passwordRecoveryMsg");
    if(!email){msg.textContent="Enter the Collectish account email first.";return}
    msg.textContent="Sending reset email…";
    const redirectTo=location.origin+location.pathname;
    try{
      const r=await fetch(`${c.supabaseUrl}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`,{
        method:"POST",headers:H(),body:JSON.stringify({email})
      });
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw Error(d?.msg||d?.message||`Reset request failed (HTTP ${r.status})`);
      msg.textContent=`Reset email sent to ${email}. Open the link in that email on this device.`;
    }catch(e){msg.textContent=e.message}
  }

  function recoveryHash(){
    const h=new URLSearchParams(location.hash.replace(/^#/,""));
    return {
      type:h.get("type"),token:h.get("access_token"),refresh:h.get("refresh_token"),
      expiresIn:Number(h.get("expires_in")||3600),error:h.get("error_description")||h.get("error")
    };
  }

  async function activateRecoveryIfPresent(){
    const h=recoveryHash();
    if(h.error){
      ensureRecoveryUi();el("passwordRecoveryPanel").hidden=false;el("passwordRecoveryMsg").textContent=decodeURIComponent(h.error);return;
    }
    if(h.type!=="recovery"||!h.token)return;
    ensureRecoveryUi();
    el("login").hidden=false;el("passwordRecoveryPanel").hidden=false;
    el("passwordRecoveryRequest").hidden=true;el("passwordRecoverySet").hidden=false;
    el("passwordRecoveryPanel").dataset.recoveryToken=h.token;
    el("passwordRecoveryPanel").dataset.refreshToken=h.refresh||"";
    el("passwordRecoveryPanel").dataset.expiresIn=String(h.expiresIn||3600);
    el("passwordRecoveryMsg").textContent="Recovery link accepted. Choose a new password.";
  }

  async function saveNewPassword(){
    const p=el("newRecoveryPassword")?.value||"",confirm=el("confirmRecoveryPassword")?.value||"";
    const msg=el("passwordRecoveryMsg"),panel=el("passwordRecoveryPanel");
    if(p.length<8){msg.textContent="Use at least 8 characters.";return}
    if(p!==confirm){msg.textContent="The two passwords don't match.";return}
    const token=panel?.dataset.recoveryToken;if(!token){msg.textContent="Recovery session is missing. Request a new reset email.";return}
    msg.textContent="Updating password…";
    try{
      const r=await fetch(`${c.supabaseUrl}/auth/v1/user`,{
        method:"PUT",headers:{...H(token),Authorization:`Bearer ${token}`},body:JSON.stringify({password:p})
      });
      const user=await r.json().catch(()=>({}));
      if(!r.ok)throw Error(user?.msg||user?.message||`Password update failed (HTTP ${r.status})`);
      const refresh=panel.dataset.refreshToken||null,expiresIn=Number(panel.dataset.expiresIn||3600);
      if(refresh)save({token,refresh,exp:Date.now()+expiresIn*1000,user});
      history.replaceState(null,"",location.pathname+location.search);
      el("newRecoveryPassword").value="";el("confirmRecoveryPassword").value="";
      msg.textContent="Password updated. You can now sign in with the new password.";
      el("passwordRecoverySet").hidden=true;el("passwordRecoveryRequest").hidden=false;
      if(user?.email)el("email").value=user.email;
    }catch(e){msg.textContent=e.message}
  }

  let tries=0;const t=setInterval(()=>{
    tries++;
    if(ensureRecoveryUi())activateRecoveryIfPresent();
    else if(el("forgotPassword")){activateRecoveryIfPresent();clearInterval(t)}
    if(tries>100)clearInterval(t);
  },100);
})();


/* ===== v052.js ===== */
// Collectish web v0.5.2 — unified shell dark-mode contrast + version pin
(() => {
  const setBadge=()=>{const b=document.getElementById("appVersion");if(b)b.textContent="web v0.5.2"};
  setBadge();
  [300,900,3200,5000].forEach(ms=>setTimeout(setBadge,ms));
  if(!document.querySelector('link[data-collectish-v052]')){
    const l=document.createElement("link");
    l.rel="stylesheet";
    l.href="v052.css?v=052";
    l.dataset.collectishV052="1";
    document.head.appendChild(l);
  }
})();


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
    const specs=[['Marketplace scans','marketplace_scans','captured_at',''],['Seller orders','seller_orders','order_date',''],['Payments','seller_payments','initiated_on',''],['RIs','reimbursement_invoices','created_date',''],['SYP snapshots','syp_snapshots','captured_at',''],['SYP events','syp_events','changed_at',''],['Eligible SYP','syp_products','last_seen','is_currently_eligible=eq.true']];
    const rows=[];for(const [label,table,dateField,filter] of specs){try{const [count,range]=await Promise.all([exactCount(table,filter),bounds(table,dateField)]);rows.push({label,count,...range})}catch(e){rows.push({label,error:e.message})}}
    host.innerHTML=rows.map(r=>`<div class="collectish-health-card"><span>${r.label}</span>${r.error?`<strong>Unavailable</strong><small>${r.error}</small>`:`<strong>${r.count.toLocaleString()}</strong><small>${fmt(r.oldest)} → ${fmt(r.newest)}</small>`}</div>`).join('');
    const eligible=rows.find(r=>r.label==='Eligible SYP'&&!r.error)?.count,direct=el('collectishDirectPage');if(direct&&eligible!=null){const card=direct.querySelector('.collectish-kpi');if(card){card.querySelector('span').textContent='SYP eligible';card.querySelector('strong').textContent=eligible.toLocaleString()}}
  }

  async function loadJobs(){
    const body=el('collectishJobBody'),sum=el('collectishJobSummary');if(!body)return;body.innerHTML='<tr><td colspan="6">Loading jobs…</td></tr>';
    try{const [jobs,collectors]=await Promise.all([rest('collector_jobs?select=job_id,source,action,status,created_at,claimed_by,progress_json,error_message,completed_at&order=created_at.desc&limit=100'),rest('collectors?select=collector_id,name,status,last_seen_at,app_version&order=last_seen_at.desc&limit=100')]);const cmap=new Map((collectors||[]).map(x=>[String(x.collector_id),x]));const counts={queued:0,claimed:0,running:0,completed:0,failed:0};for(const j of jobs||[])counts[j.status]=(counts[j.status]||0)+1;sum.innerHTML=`<span>Queued <b>${counts.queued||0}</b></span><span>Claimed <b>${counts.claimed||0}</b></span><span>Running <b>${counts.running||0}</b></span><span>Completed <b>${counts.completed||0}</b></span><span>Failed <b>${counts.failed||0}</b></span>`;body.innerHTML=(jobs||[]).map(j=>{const p=j.progress_json||{},collector=cmap.get(String(j.claimed_by||''));return `<tr><td>${fmt(j.created_at)}</td><td>${j.source} / ${j.action}</td><td><span class="collectish-job-status s-${j.status}">${j.status}</span></td><td>${Math.round(Number(p.percent||0))}% ${p.stage||''}<div class="meta">${p.detail||''}</div></td><td>${collector?`${collector.name}<div class="meta">${collector.app_version||''} • ${fmt(collector.last_seen_at)}</div>`:'—'}</td><td>${j.error_message||''}</td></tr>`}).join('')||'<tr><td colspan="6">No collector jobs yet.</td></tr>'}catch(e){body.innerHTML=`<tr><td colspan="6">${e.message}</td></tr>`}
  }

  async function queueCloudScan(e){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();const msg=el('newScanMsg');try{const set=el('newSet')?.selectedOptions?.[0];if(!set?.value)throw Error('Select a set.');const s=await valid();if(!s)throw Error('Sign in required');const profile={setSlug:set.value,setName:set.dataset.name||set.textContent,printing:el('newPrinting').value,condition:el('newCondition').value,language:el('newLanguage').value,salesEnrich:Number(el('newEnrich').value)};if(msg)msg.textContent='Queueing in Collectish Cloud…';await rest('collector_jobs',{method:'POST',body:[{user_id:s.user.id,source:'marketplace',action:'scan_set',status:'queued',priority:100,required_capability:'marketplace_scan',preferred_executor:'browser_connector',payload_json:{profile},progress_json:{stage:'queued',percent:0,detail:'Waiting for an eligible collector',updatedAt:new Date().toISOString()},max_attempts:5}],prefer:'return=minimal'});if(msg)msg.textContent=`Queued ${profile.setName} in Collectish Cloud.`;await loadJobs()}catch(err){if(msg)msg.textContent=err.message}}
  function installQueueOverride(){const b=el('queueNew');if(!b||b.dataset.collectishCloudJobs)return false;b.dataset.collectishCloudJobs='1';b.addEventListener('click',queueCloudScan,true);return true}
  function monitorPages(){document.addEventListener('click',e=>{const p=e.target?.dataset?.page;if(p==='operations')setTimeout(()=>{loadHealth();loadJobs()},50);if(p==='direct')setTimeout(()=>loadHealth(),100)},true)}
  let tries=0;const t=setInterval(()=>{tries++;setBadge();const a=installOperationsPanels(),b=installQueueOverride();if(a&&b){monitorPages();clearInterval(t)}if(tries>150)clearInterval(t)},100);
})();

// Chain all post-0.5.4 unified overlays from one stable bootstrap point.
(() => {
  if(document.querySelector('script[data-collectish-v055]'))return;
  const s=document.createElement('script');s.src='v055.js?v=058';s.dataset.collectishV055='1';document.body.appendChild(s);
})();


/* ===== v055.js ===== */
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
    const small=el('collectishExecutorLabel')?.querySelector('small');if(small)small.textContent='Cloud is the primary Marketplace executor. Browser connectors are reserved for authenticated-session work and automatic fallback.';
    if(!el('collectishCloudPrimaryBadge')){
      const badge=document.createElement('div');badge.id='collectishCloudPrimaryBadge';badge.className='collectish-cloud-primary';badge.innerHTML='<b>Cloud primary</b><span>Routine Marketplace scans run on public server APIs. The PC connector is reserved for authenticated work and explicit fallback.</span>';
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
      await rest('collector_jobs',{method:'POST',body:[{user_id:s.user.id,source:'marketplace',action:'scan_set',status:'queued',priority:30,required_capability:'marketplace_public_api',preferred_executor:'cloud_worker',payload_json:{profile,cloudPrimary:true,executionClass:'cloud_public'},progress_json:{stage:'queued',percent:0,detail:'Waiting for Collectish cloud worker',updatedAt:new Date().toISOString()},max_attempts:3}],prefer:'return=minimal'});
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


/* ===== current-data.js ===== */
// Collectish current data layer — canonical pagination for large cloud tables
(() => {
  if(typeof rest!=="function"||window.__collectishPagedRest)return;
  const baseRest=rest;
  const PAGE_SIZE=1000;
  const MAX_ROWS=100000;
  const fullTables=new Set([
    "marketplace_scan_rows",
    "seller_orders",
    "seller_order_items",
    "seller_payments",
    "seller_payment_adjustments",
    "syp_products",
    "reimbursement_invoices",
    "ri_discrepancies"
  ]);

  const tableFrom=path=>String(path||"").split("?")[0].replace(/^\/+/,"");
  const stripPaging=path=>String(path)
    .replace(/([?&])limit=\d+(&?)/g,(m,p1,p2)=>p2?p1:"")
    .replace(/([?&])offset=\d+(&?)/g,(m,p1,p2)=>p2?p1:"")
    .replace(/[?&]$/g,"");
  const withPaging=(path,limit,offset)=>`${path}${path.includes("?")?"&":"?"}limit=${limit}&offset=${offset}`;

  async function readAll(path){
    const clean=stripPaging(path),rows=[];
    for(let offset=0;offset<MAX_ROWS;offset+=PAGE_SIZE){
      const chunk=await baseRest(withPaging(clean,PAGE_SIZE,offset));
      rows.push(...(chunk||[]));
      if(!chunk||chunk.length<PAGE_SIZE)break;
    }
    return rows;
  }

  rest=async function(path,o={}){
    const method=String(o?.method||"GET").toUpperCase();
    if(method==="GET"&&fullTables.has(tableFrom(path)))return readAll(path);
    return baseRest(path,o);
  };

  window.__collectishPagedRest={pageSize:PAGE_SIZE,maxRows:MAX_ROWS,tables:[...fullTables]};
})();

// Collectish current UI layer — keep product navigation focused and move
// operational/debug surfaces behind a secondary More destination.
(() => {
  const el=id=>document.getElementById(id);
  function sectionByTitle(title){
    return [...document.querySelectorAll('#app > section.card')].find(s=>(s.querySelector('h2')?.textContent||'').trim()===title)||null;
  }
  function install(){
    const app=el('app'),nav=el('collectishProductNav');
    if(!app||!nav||nav.dataset.collectishCurrentUi)return false;
    nav.dataset.collectishCurrentUi='1';
    const opsButton=nav.querySelector('button[data-page="operations"]');
    if(opsButton){
      opsButton.textContent='More';
      opsButton.title='Operations, cloud health, jobs, and connector status';
      opsButton.classList.add('collectish-more-nav');
    }
    if(!el('collectishOperationsIntro')){
      const intro=document.createElement('section');
      intro.id='collectishOperationsIntro';
      intro.className='card collectish-ops-intro';
      intro.dataset.collectishPage='operations';
      intro.innerHTML='<div><h2>Operations</h2><div class="meta">Cloud execution, job queue, data health, and connector controls. Routine Marketplace work runs in the cloud; connector controls are secondary.</div></div>';
      const firstOps=[...app.querySelectorAll(':scope > section[data-collectish-page="operations"]')][0];
      if(firstOps)app.insertBefore(intro,firstOps);else app.appendChild(intro);
    }
    const pc=sectionByTitle('PC status');
    if(pc){pc.querySelector('h2').textContent='PC connector';pc.classList.add('collectish-ops-secondary')}
    const profiles=sectionByTitle('Scan profiles');if(profiles)profiles.classList.add('collectish-ops-secondary');
    const requests=sectionByTitle('Requests');
    if(requests){requests.querySelector('h2').textContent='Legacy requests';requests.classList.add('collectish-ops-secondary')}
    const order=['collectishOperationsIntro','marketplaceExecutionStatus',sectionByTitle('New scan')?.id,'collectishJobs','collectishCloudHealth','collectishParity',pc?.id,profiles?.id,requests?.id].filter(Boolean);
    let anchor=el('collectishOperationsIntro');
    for(const id of order.slice(1)){
      const node=el(id);if(!node||!anchor)continue;
      anchor.insertAdjacentElement('afterend',node);anchor=node;
    }
    return true;
  }
  let tries=0;const timer=setInterval(()=>{tries++;if(install()||tries>160)clearInterval(timer)},100);
})();

// Collectish connector-role layer — the desktop extension is now an agent,
// not a second application. Public Marketplace collection belongs to cloud.
(() => {
  const el=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>\"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));

  function hideLegacyRunOnPc(){
    const profiles=[...document.querySelectorAll('button')].filter(b=>(b.textContent||'').trim()==='Run on PC');
    for(const b of profiles){
      b.hidden=true;
      b.style.display='none';
      const row=b.closest('.profile,.scan-profile,.request-row,article,li,div');
      if(row&&!row.querySelector('.collectish-cloud-owned-note')){
        const n=document.createElement('div');
        n.className='meta collectish-cloud-owned-note';
        n.textContent='Routine scans now run in Collectish Cloud.';
        b.insertAdjacentElement('afterend',n);
      }
    }
  }

  function install(){
    const app=el('app'),intro=el('collectishOperationsIntro');
    if(!app||!intro||el('collectishConnectorRole'))return false;
    const panel=document.createElement('section');
    panel.id='collectishConnectorRole';
    panel.className='card collectish-ops-panel';
    panel.dataset.collectishPage='operations';
    panel.innerHTML=`
      <div class="toolbar"><div><h2>Connector responsibilities</h2><div class="meta">The browser connector only handles work that genuinely needs a signed-in browser session or acts as Marketplace fallback.</div></div></div>
      <div class="collectish-health-grid">
        <div class="collectish-health-card"><span>Cloud-owned</span><strong>Marketplace scans</strong><small>Search, pricepoints, Direct quantities, sales history, scoring, persistence, and analytics.</small></div>
        <div class="collectish-health-card"><span>Browser-owned</span><strong>Authenticated seller data</strong><small>Seller Portal, private account pages, session-only exports, and collectors that cannot run anonymously.</small></div>
        <div class="collectish-health-card"><span>Browser fallback</span><strong>Marketplace recovery</strong><small>Only after a cloud scan explicitly fails or when a job requests browser_connector.</small></div>
        <div class="collectish-health-card"><span>Not browser-owned</span><strong>UI + history</strong><small>Scout, Cards, Sales, Direct, Money, Trends, job history, and analytics live in the cloud app.</small></div>
      </div>`;
    intro.insertAdjacentElement('afterend',panel);

    const pc=[...app.querySelectorAll('section.card')].find(s=>(s.querySelector('h2')?.textContent||'').trim()==='PC connector');
    if(pc){
      const meta=pc.querySelector('.meta');
      if(meta)meta.textContent='Authenticated-session agent and Marketplace fallback. It is no longer the primary scanner or dashboard.';
    }
    hideLegacyRunOnPc();
    return true;
  }

  const observer=new MutationObserver(()=>hideLegacyRunOnPc());
  observer.observe(document.documentElement,{childList:true,subtree:true});
  let tries=0;const timer=setInterval(()=>{tries++;hideLegacyRunOnPc();if(install()||tries>160)clearInterval(timer)},100);
  window.__collectishConnectorPolicy={
    cloudOwned:['marketplace_scan','scout_ui','cards_ui','sales_ui','direct_ui','money_ui','analytics','history'],
    browserOwned:['authenticated_seller_portal','session_only_export','private_account_collection'],
    browserFallback:['marketplace_scan_after_cloud_failure']
  };
})();


/* ===== current-agent.js ===== */
(() => {
  const el=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>\"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  const ago=iso=>{if(!iso)return 'never';const m=Math.max(0,Math.round((Date.now()-new Date(iso))/60000));return m<1?'now':m<60?`${m}m ago`:m<1440?`${Math.round(m/60)}h ago`:`${Math.round(m/1440)}d ago`};
  function dedupeCollectors(rows){
    const out=[],seen=new Set();
    for(const c of rows||[]){
      const key=c.collector_type==='mobile_agent'&&c.platform==='android'
        ? 'mobile_agent|android|Collectish Android'
        : `${c.collector_type||''}|${c.platform||''}|${c.name||''}`;
      if(seen.has(key))continue;
      seen.add(key);out.push(c);
    }
    return out;
  }
  async function load(){
    const host=el('agentStatusBody');if(!host)return;
    try{
      const collectors=await rest('collectors?select=name,collector_type,platform,last_seen_at,app_version,capabilities_json,session_health_json&collector_type=in.(browser_connector,mobile_agent)&order=last_seen_at.desc&limit=20');
      const cards=dedupeCollectors(collectors).slice(0,4).map(c=>{const s=c?.session_health_json||{},cap=c?.capabilities_json||{},ready=Boolean(s.authenticated&&cap.tcgplayer_authenticated_session);return `<div class="collectish-health-card"><span>${c.collector_type==='mobile_agent'?'Android agent':'Browser agent'}</span><strong>${esc(c?.name||'Unknown agent')}</strong><small>${esc(c?.app_version||'')} ${c?.last_seen_at?'• '+ago(c.last_seen_at):''}</small><div class="meta">${ready?'Authenticated • Eligible':'Session '+esc(s.state||'unknown')}</div></div>`}).join('');
      host.innerHTML=`<div class="collectish-health-grid">${cards||'<div class="collectish-health-card"><span>Agent</span><strong>No authenticated agent</strong></div>'}</div>`;
    }catch(e){host.innerHTML=`<div class="collectish-empty">${esc(e.message)}</div>`}
  }
  function install(){
    const anchor=el('collectishConnectorRole');if(!anchor||el('collectishAgentStatus'))return false;
    const panel=document.createElement('section');panel.id='collectishAgentStatus';panel.className='card collectish-ops-panel';panel.dataset.collectishPage='operations';
    panel.innerHTML='<div class="toolbar"><div><h2>Authenticated agents</h2><div class="meta">Live desktop and Android session health.</div></div><button id="refreshAgentStatus" type="button">Refresh</button></div><div id="agentStatusBody"><div class="meta">Loading agent status…</div></div>';
    anchor.insertAdjacentElement('afterend',panel);el('refreshAgentStatus').onclick=load;load();return true;
  }
  document.addEventListener('click',e=>{if(e.target?.dataset?.page==='operations')setTimeout(load,150)},true);
  let tries=0;const timer=setInterval(()=>{tries++;if(install()||tries>160)clearInterval(timer)},100);

  const android=()=>window.CollectishAndroid||null;
  let heartbeatBusy=false;
  async function androidHeartbeat(){
    if(heartbeatBusy)return;
    heartbeatBusy=true;
    try{
      const a=android();if(!a||typeof rest!=='function'||typeof session!=='function')return;
      const s=session();if(!s?.user?.id)return;
      try{if(typeof a.refreshSessionState==='function')a.refreshSessionState()}catch{}
      const collectorId=String(a.getCollectorId()),version=String(a.getVersion()),state=String(a.getSessionState()),authenticated=state==='authenticated',now=new Date().toISOString();
      await rest('collectors?on_conflict=user_id,collector_id',{method:'POST',body:[{user_id:s.user.id,collector_id:collectorId,name:'Collectish Android',collector_type:'mobile_agent',platform:'android',last_seen_at:now,status:'online',app_version:version,capabilities_json:{tcgplayer_authenticated_session:authenticated,authenticated_agent:true,android_agent:true},session_health_json:{authenticated,state,checkedAt:now,provider:'tcgplayer'},metadata_json:{executionRole:'android_agent'}}],prefer:'resolution=merge-duplicates,return=minimal'});
      if(!authenticated)return;
      try{
        const claimed=await rest('rpc/claim_collector_job',{method:'POST',body:{p_source:'agent',p_action:'auth_probe',p_preferred_executors:['android_agent'],p_required_capability:'tcgplayer_authenticated_session',p_collector_id:collectorId,p_lease_seconds:300}});
        const job=Array.isArray(claimed)?claimed[0]:(claimed?.job_id?claimed:null);if(!job)return;
        const doneAt=new Date().toISOString();
        const progress={stage:'completed',percent:100,detail:'Authenticated TCGplayer session confirmed on Android',updatedAt:doneAt};
        await rest(`collector_jobs?job_id=eq.${encodeURIComponent(job.job_id)}`,{method:'PATCH',body:{status:'completed',completed_at:doneAt,lease_expires_at:null,progress_json:progress,error_message:null},prefer:'return=minimal'});
        await rest('collector_job_events',{method:'POST',body:[{job_id:job.job_id,user_id:job.user_id,event_type:'completed',collector_id:collectorId,progress_json:progress,message:'Authenticated TCGplayer session confirmed on Android',metadata_json:{platform:'android',agentVersion:version}}],prefer:'return=minimal'});
      }catch(err){
        const errAt=new Date().toISOString();
        await rest('collectors?on_conflict=user_id,collector_id',{method:'POST',body:[{user_id:s.user.id,collector_id:collectorId,name:'Collectish Android',collector_type:'mobile_agent',platform:'android',last_seen_at:errAt,status:'online',app_version:version,capabilities_json:{tcgplayer_authenticated_session:true,authenticated_agent:true,android_agent:true},session_health_json:{authenticated:true,state:'authenticated',checkedAt:errAt,provider:'tcgplayer'},metadata_json:{executionRole:'android_agent',lastClaimError:String(err?.message||err),lastClaimErrorAt:errAt}}],prefer:'resolution=merge-duplicates,return=minimal'}).catch(()=>{});
      }
    } finally { heartbeatBusy=false; }
  }
  const kick=()=>androidHeartbeat().catch(()=>{});
  setInterval(kick,30000);
  setTimeout(kick,2500);
  window.addEventListener('collectishAgentSessionChanged',()=>setTimeout(kick,250));
  window.addEventListener('pageshow',()=>setTimeout(kick,250));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')setTimeout(kick,250)});
})();


// Consolidated startup finalizer
(()=>{
  const b=document.querySelector('#appVersion');if(b)b.textContent='web 0.7.5';
  let s=null;try{s=JSON.parse(localStorage.getItem('collectishSession')||'null')}catch{}
  if(!s?.token){
    const banner=document.querySelector('#activityBanner');if(banner){banner.hidden=true;banner.style.display='none'}
    const scout=document.querySelector('#mobileScoutLoading');if(scout){scout.hidden=true;scout.style.display='none'}
  }
})();
