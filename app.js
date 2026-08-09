const c=window.COLLECTISH_CONFIG,K="collectishSession",$=id=>document.getElementById(id);
const session=()=>JSON.parse(localStorage.getItem(K)||"null"),save=s=>s?localStorage.setItem(K,JSON.stringify(s)):localStorage.removeItem(K);
const H=t=>({"apikey":c.publishableKey,"Authorization":`Bearer ${t||c.publishableKey}`,"Content-Type":"application/json"});
let scansCache=[],rowsCache=[];
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

function median(v){const a=v.filter(x=>Number.isFinite(Number(x))).map(Number).sort((a,b)=>a-b);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
function chart(id,pts,fmt=v=>String(v)){const s=$(id),W=640,H=220,L=48,R=10,T=15,B=30;if(pts.length<2){s.innerHTML='<text x="320" y="110" text-anchor="middle" class="axis">Need 2+ scans</text>';return}let mn=Math.min(...pts.map(x=>x.v)),mx=Math.max(...pts.map(x=>x.v));if(mn===mx){mn-=1;mx+=1}const x=i=>L+i*(W-L-R)/(pts.length-1),y=v=>T+(mx-v)*(H-T-B)/(mx-mn);const p=pts.map((q,i)=>`${i?"L":"M"} ${x(i)} ${y(q.v)}`).join(" ");s.innerHTML=`<path d="${p}" class="line"/>`+pts.map((q,i)=>`<circle cx="${x(i)}" cy="${y(q.v)}" r="4" class="dot"><title>${dt(q.d)}: ${fmt(q.v)}</title></circle>`).join("")}
async function analytics(){
  const key=$("analyticsProfile").value;if(!key)return;
  const [slug,printing,condition,language]=key.split("|");
  const ss=scansCache.filter(s=>s.set_slug===slug&&s.printing===printing&&s.condition===condition&&s.language===language).sort((a,b)=>new Date(a.captured_at)-new Date(b.captured_at));
  const ids=ss.map(s=>s.scan_id); if(!ids.length)return;
  const all=await rest(`marketplace_scan_rows?select=scan_id,sku_id,product_id,product_name,direct_available,direct_low&scan_id=in.(${ids.join(",")})`);
  const byScan=new Map(ids.map(id=>[id,[]]));all.forEach(r=>byScan.get(r.scan_id)?.push(r));
  const agg=ss.map(s=>{const rs=byScan.get(s.scan_id)||[];return {d:s.captured_at,q:rs.reduce((a,r)=>a+Number(r.direct_available||0),0),p:median(rs.map(r=>r.direct_low))}});
  const first=agg[0],last=agg.at(-1);$("analyticsStats").innerHTML=[["Scans",ss.length],["Direct qty",last.q],["Qty Δ",last.q-first.q],["Median DL",money(last.p)]].map(([a,b])=>`<div class=stat><span>${a}</span><strong>${b}</strong></div>`).join("");
  chart("qtyChart",agg.map(x=>({d:x.d,v:x.q})),v=>Math.round(v).toLocaleString());chart("priceChart",agg.map(x=>({d:x.d,v:x.p??0})),money);
  if(ss.length>=2){const prev=new Map((byScan.get(ss.at(-2).scan_id)||[]).map(r=>[r.sku_id,r])),cur=byScan.get(ss.at(-1).scan_id)||[];const m=[];for(const r of cur){const p=prev.get(r.sku_id);if(!p)continue;m.push({r,qd:Number(r.direct_available||0)-Number(p.direct_available||0),pd:Number(r.direct_low||0)-Number(p.direct_low||0)})}m.sort((a,b)=>Math.abs(b.qd)-Math.abs(a.qd));$("movers").innerHTML=m.slice(0,20).map(x=>`<tr><td>${x.r.product_name}</td><td>${x.qd>0?"+":""}${x.qd}</td><td>${x.pd>0?"+":""}$${x.pd.toFixed(2)}</td></tr>`).join("")}
}
async function load(){
  showActivity("Refreshing dashboard","Loading scans, PC status, requests, and set catalog…");
  $("setLoadStatus").textContent="Loading set catalog…";
  try{
    updateActivity("Loading recent scans…");
    const scansPromise=rest("marketplace_scans?select=*&order=captured_at.desc&limit=100");
    updateActivity("Loading PC heartbeat…");
    const devPromise=rest("marketplace_devices?select=*&order=last_seen_at.desc&limit=5");
    updateActivity("Loading scan requests…");
    const cmdPromise=rest("marketplace_scan_commands?select=*&order=requested_at.desc&limit=20");
    updateActivity("Loading Magic set catalog…");
    const setsPromise=rest("marketplace_set_catalog?select=*&order=set_name.asc");

    const [scans,dev,cmd,sets]=await Promise.all([scansPromise,devPromise,cmdPromise,setsPromise]);
    scansCache=scans;

    $("setLoadStatus").textContent=`${sets.length.toLocaleString()} sets loaded`;

    const d=dev[0],on=d&&Date.now()-new Date(d.last_seen_at).getTime()<300000;
    $("device").innerHTML=d?`<b>${on?"Online":"Offline"}</b> • ${d.device_name||"PC"} • ${dt(d.last_seen_at)}`:"No heartbeat yet";

    $("newSet").innerHTML='<option value="">Select set…</option>'+sets.map(s=>`<option value="${s.set_slug}" data-name="${s.set_name}">${s.set_name} (${s.direct_product_count})</option>`).join("");

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

    $("commands").innerHTML=cmd.map(x=>`<div class=command><div><div class=title>${x.profile_json?.setName||x.profile_json?.setSlug}</div><div class=meta>${dt(x.requested_at)} • ${x.status}${x.error_message?" • "+x.error_message:""}</div></div></div>`).join("");

    $("scans").innerHTML=scans.slice(0,20).map(s=>`<div class=scan><div><div class=title>${s.set_name}</div><div class=meta>${s.printing} / ${s.condition} / ${s.language} • ${dt(s.captured_at)}</div></div><div>${s.unique_skus} SKUs<br><span class=meta>${s.hot_count} HOT / ${s.watch_count} WATCH</span></div></div>`).join("");

    $("stats").innerHTML=[["Profiles",ps.size],["Scans",scans.length],["PC",on?"Online":"Offline"]].map(([a,b])=>`<div class=stat><span>${a}</span><strong>${b}</strong></div>`).join("");

    updateActivity(`Loaded ${scans.length} scans • ${sets.length} sets`);
    setTimeout(hideActivity,700);
  }catch(e){
    $("setLoadStatus").textContent="Set catalog load failed";
    showActivity("Load failed",e.message);
  }
}
async function boot(){const s=await valid();$("login").hidden=!!s;$("app").hidden=!s;if(s)load()}
$("signIn").onclick=login;$("refresh").onclick=load;$("signOut").onclick=()=>{save(null);boot()};$("queueNew").onclick=queueNew;$("analyticsProfile").onchange=async()=>{
  try{
    showActivity("Loading analytics","Fetching scan rows for this profile…");
    await analytics();
    setTimeout(hideActivity,500);
  }catch(e){
    showActivity("Analytics failed",e.message);
  }
};boot();
