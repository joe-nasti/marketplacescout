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