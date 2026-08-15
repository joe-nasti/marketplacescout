// Collectish product UX — Scout / Seller / SYP / Admin
(() => {
  const el=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const money=n=>Number(n||0).toLocaleString(undefined,{style:'currency',currency:'USD'}), num=n=>Number(n||0).toLocaleString(), pct=n=>`${Number(n||0).toFixed(1)}%`;
  const shortDate=v=>v?new Date(v).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'—';
  const dt=v=>v?new Date(v).toLocaleString():'—';
  const pageNames={scout:'Scout',seller:'Seller',syp:'SYP',admin:'Admin'};
  const userId=()=>{try{return JSON.parse(localStorage.getItem('collectishSession')||'null')?.user?.id||null}catch{return null}};
  let active='scout', selectedScout=null;

  function install(){
    const app=el('app'); if(!app||el('collectishUxShell'))return false;
    [...app.children].forEach(n=>n.classList.add('collectish-legacy-surface'));
    const shell=document.createElement('section'); shell.id='collectishUxShell'; shell.className='collectish-product-shell';
    shell.innerHTML=`
      <aside class="cx-side"><div class="cx-brand">collectish</div><nav class="cx-nav">${Object.entries(pageNames).map(([k,v])=>`<button data-cx-page="${k}" class="${k==='scout'?'active':''}">${v}</button>`).join('')}</nav><div class="cx-side-spacer"></div><div class="cx-side-meta">Smarter data.<br>Better decisions.</div></aside>
      <div class="cx-main">
        <section id="cxScout" class="cx-page active"></section>
        <section id="cxSeller" class="cx-page"></section>
        <section id="cxSyp" class="cx-page"></section>
        <section id="cxAdmin" class="cx-page"></section>
      </div>
      <nav class="cx-mobile-nav">${Object.entries(pageNames).map(([k,v])=>`<button data-cx-page="${k}" class="${k==='scout'?'active':''}">${v}</button>`).join('')}</nav>`;
    app.insertBefore(shell,app.firstChild);
    document.addEventListener('click',e=>{const b=e.target.closest('[data-cx-page]');if(b)switchPage(b.dataset.cxPage)});
    loadScout(); loadSeller(); loadSyp(); loadAdmin();
    return true;
  }

  function switchPage(name){
    active=name;
    document.querySelectorAll('.cx-page').forEach(x=>x.classList.toggle('active',x.id===`cx${name[0].toUpperCase()+name.slice(1)}`));
    document.querySelectorAll('[data-cx-page]').forEach(x=>x.classList.toggle('active',x.dataset.cxPage===name));
    if(name==='scout')loadScout(); if(name==='seller')loadSeller(); if(name==='syp')loadSyp(); if(name==='admin')loadAdmin();
    window.scrollTo({top:0,behavior:'smooth'});
  }

  const label=(s)=>`data-label="${esc(s)}"`;
  function flagClass(f){f=String(f||'').toUpperCase();return f==='HOT'?'cx-hot':f==='WATCH'?'cx-watch':'cx-pass'}
  function thesis(r){
    const bits=[]; const spread=Number(r.direct_low||0)-Number(r.sku_market_price||0);
    if(Number(r.direct_available||0)<=10)bits.push('Direct supply is thin');
    if(spread>0)bits.push(`Direct Low is ${pct(100*spread/Math.max(.01,Number(r.sku_market_price||1)))} above Market`);
    if(Number(r.avg_daily_qty_sold||0)>=1)bits.push(`${Number(r.avg_daily_qty_sold).toFixed(1)} sales/day`);
    if(Number(r.opportunity_score||0)>=80)bits.push('Scout score is unusually strong');
    return bits.length?bits.join(', ')+'.':'Interesting price/supply setup; review ladder and recent velocity before buying.';
  }

  async function loadScout(){
    const host=el('cxScout'); if(!host)return;
    host.innerHTML=`<div class="cx-page-head"><div><h2>Scout</h2><p>What should I buy?</p></div><button class="cx-refresh" id="cxScoutRefresh">Refresh</button></div><div class="cx-empty">Loading opportunities…</div>`;
    el('cxScoutRefresh').onclick=loadScout;
    try{
      const rows=await rest('marketplace_scan_rows?select=id,sku_id,product_id,product_name,collector_number,set_name,rarity,printing,condition,language,sales_rank,direct_low,sku_market_price,tcg_low,low_with_shipping,direct_listings,direct_available,avg_daily_qty_sold,opportunity_score,flag,supply_type,raw_json&order=id.desc&limit=3000');
      const latest=new Map(); for(const r of rows||[]){const k=r.sku_id||r.product_id||r.id;if(!latest.has(k))latest.set(k,r)}
      const data=[...latest.values()].sort((a,b)=>Number(b.opportunity_score||0)-Number(a.opportunity_score||0)).slice(0,100);
      if(!selectedScout)selectedScout=data[0]||null;
      renderScout(host,data);
    }catch(e){host.innerHTML=`<div class="cx-page-head"><div><h2>Scout</h2><p>What should I buy?</p></div></div><div class="cx-empty">${esc(e.message)}</div>`}
  }

  function renderScout(host,data){
    const setOptions=[...new Set(data.map(x=>x.set_name).filter(Boolean))].sort();
    host.innerHTML=`<div class="cx-page-head"><div><h2>Scout</h2><p>Ranked buying and speculation opportunities.</p></div><button class="cx-refresh" id="cxScoutRefresh">Refresh</button></div>
      <div class="cx-filters"><input id="cxScoutSearch" placeholder="Search cards, sets, SKUs…"><select id="cxScoutFlag"><option value="">All signals</option><option>HOT</option><option>WATCH</option><option>PASS</option></select><select id="cxScoutSet"><option value="">All sets</option>${setOptions.map(s=>`<option>${esc(s)}</option>`).join('')}</select><select id="cxScoutMin"><option value="0">Any score</option><option value="60">60+ score</option><option value="75">75+ score</option><option value="85">85+ score</option></select></div>
      <div class="cx-grid"><div class="cx-card cx-span-8"><div class="cx-section-title">Opportunities</div><div id="cxScoutTable"></div></div><div class="cx-card cx-span-4" id="cxScoutDetail"></div></div>`;
    const rerender=()=>{
      const q=el('cxScoutSearch').value.toLowerCase(),f=el('cxScoutFlag').value,s=el('cxScoutSet').value,min=Number(el('cxScoutMin').value||0);
      const filtered=data.filter(r=>(!q||`${r.product_name} ${r.set_name} ${r.sku_id}`.toLowerCase().includes(q))&&(!f||String(r.flag||'').toUpperCase()===f)&&(!s||r.set_name===s)&&Number(r.opportunity_score||0)>=min);
      renderScoutTable(filtered); renderScoutDetail(selectedScout||filtered[0]);
    };
    ['cxScoutSearch','cxScoutFlag','cxScoutSet','cxScoutMin'].forEach(id=>el(id).addEventListener(id==='cxScoutSearch'?'input':'change',rerender));
    el('cxScoutRefresh').onclick=loadScout; rerender();
  }

  function renderScoutTable(rows){
    const host=el('cxScoutTable');if(!host)return;
    if(!rows.length){host.innerHTML='<div class="cx-empty">No opportunities match these filters.</div>';return}
    host.innerHTML=`<div class="cx-table-wrap"><table class="cx-table"><thead><tr><th>Card</th><th>Market</th><th>Direct Low</th><th>Sales/day</th><th>Direct qty</th><th>Score</th></tr></thead><tbody>${rows.slice(0,50).map(r=>`<tr data-cx-sku="${esc(r.sku_id||'')}"><td class="cx-cardname" ${label('Card')}>${esc(r.product_name)}<span class="cx-sub">${esc(r.set_name)} • ${esc(r.printing)} • ${esc(r.condition)}</span></td><td ${label('TCG Market')}>${money(r.sku_market_price)}</td><td ${label('Direct Low')}>${money(r.direct_low)}</td><td ${label('Sales/day')}>${Number(r.avg_daily_qty_sold||0).toFixed(1)}</td><td ${label('Direct qty')}>${num(r.direct_available)}</td><td ${label('Score')}><span class="cx-badge ${flagClass(r.flag)}">${num(r.opportunity_score)} ${esc(r.flag||'')}</span></td></tr>`).join('')}</tbody></table></div>`;
    host.querySelectorAll('tr[data-cx-sku]').forEach(tr=>tr.onclick=()=>{const sku=tr.dataset.cxSku;selectedScout=rows.find(r=>String(r.sku_id||'')===sku)||rows[0];renderScoutDetail(selectedScout)});
  }
  function renderScoutDetail(r){
    const h=el('cxScoutDetail');if(!h)return;if(!r){h.innerHTML='<div class="cx-empty">Select an opportunity.</div>';return}
    h.innerHTML=`<div class="cx-detail-title"><div><div class="cx-section-title" style="margin:0">${esc(r.product_name)}</div><span class="cx-sub">${esc(r.set_name)} • ${esc(r.printing)} • ${esc(r.condition)}</span></div><span class="cx-badge ${flagClass(r.flag)}">${esc(r.flag||'')}</span></div><div style="margin-top:15px;color:var(--cx-muted);font-size:11px;text-transform:uppercase;font-weight:800">Opportunity score</div><div class="cx-score">${num(r.opportunity_score)}<span style="font-size:14px;color:var(--cx-muted)">/100</span></div><div class="cx-detail-list"><div class="cx-detail-stat"><span>Market</span><strong>${money(r.sku_market_price)}</strong></div><div class="cx-detail-stat"><span>Direct Low</span><strong>${money(r.direct_low)}</strong></div><div class="cx-detail-stat"><span>Sales / day</span><strong>${Number(r.avg_daily_qty_sold||0).toFixed(1)}</strong></div><div class="cx-detail-stat"><span>Direct qty</span><strong>${num(r.direct_available)}</strong></div><div class="cx-detail-stat"><span>Listings</span><strong>${num(r.direct_listings)}</strong></div><div class="cx-detail-stat"><span>Sales rank</span><strong>${num(r.sales_rank)}</strong></div></div><div class="cx-thesis"><strong>Why Scout likes it</strong><br>${esc(thesis(r))}</div>`;
  }

  async function loadSeller(){
    const host=el('cxSeller');if(!host)return;host.innerHTML=`<div class="cx-page-head"><div><h2>Seller</h2><p>How is the business doing?</p></div><button id="cxSellerRefresh" class="cx-refresh">Refresh</button></div><div class="cx-empty">Loading seller history…</div>`;
    try{
      const [orders,refunds,reviews,payments]=await Promise.all([
        rest('seller_orders?select=order_number,order_date,order_status,order_channel,buyer_name,gross_amount,fee_amount,net_amount,refund_total,review_rating,tracking_status,has_details&order=order_date.desc&limit=1000'),
        rest('seller_refunds?select=refund_id,order_number,amount,reason,reason_text,origin,created_at_source&order=created_at_source.desc&limit=200'),
        rest('seller_reviews?select=order_number,rating,review_text,created_at_source&order=created_at_source.desc&limit=200'),
        rest('seller_payments?select=payment_id,arrival_date,total_sales,total_fees,payment,is_pending&order=arrival_date.desc&limit=200')
      ]);
      renderSeller(host,orders||[],refunds||[],reviews||[],payments||[]);
    }catch(e){host.innerHTML=`<div class="cx-page-head"><div><h2>Seller</h2><p>How is the business doing?</p></div></div><div class="cx-empty">${esc(e.message)}</div>`}
  }
  function renderSeller(host,orders,refunds,reviews,payments){
    const cutoff=Date.now()-30*86400000, recent=orders.filter(o=>new Date(o.order_date).getTime()>=cutoff);
    const sum=(a,k)=>a.reduce((n,x)=>n+Number(x[k]||0),0),gross=sum(recent,'gross_amount'),fees=sum(recent,'fee_amount'),net=sum(recent,'net_amount'),ref=sum(recent,'refund_total');
    const avg=recent.length?gross/recent.length:0, lowReviews=reviews.filter(r=>Number(r.rating||0)<=3).length, missingDetails=orders.filter(o=>!o.has_details).length;
    host.innerHTML=`<div class="cx-page-head"><div><h2>Seller</h2><p>Last 30 days • order-centric business cockpit.</p></div><button id="cxSellerRefresh" class="cx-refresh">Refresh</button></div><div class="cx-kpis"><div class="cx-kpi"><span>Gross sales</span><strong>${money(gross)}</strong><small>30 days</small></div><div class="cx-kpi"><span>Net sales</span><strong>${money(net)}</strong></div><div class="cx-kpi"><span>Fees</span><strong>${money(fees)}</strong><small>${gross?pct(100*fees/gross):'0%'}</small></div><div class="cx-kpi"><span>Refunds</span><strong>${money(ref)}</strong></div><div class="cx-kpi"><span>Orders</span><strong>${num(recent.length)}</strong></div><div class="cx-kpi"><span>AOV</span><strong>${money(avg)}</strong></div></div><div class="cx-grid"><div class="cx-card cx-span-9"><div class="cx-section-title">Recent orders</div><div class="cx-table-wrap"><table class="cx-table"><thead><tr><th>Order</th><th>Date</th><th>Channel</th><th>Status</th><th>Gross</th><th>Fees</th><th>Net</th></tr></thead><tbody>${orders.slice(0,40).map(o=>`<tr><td class="cx-cardname" ${label('Order')}>${esc(o.order_number)}<span class="cx-sub">${esc(o.buyer_name||'')}</span></td><td ${label('Date')}>${shortDate(o.order_date)}</td><td ${label('Channel')}>${esc(o.order_channel||'')}</td><td ${label('Status')}>${esc(o.order_status||'')}</td><td ${label('Gross')}>${money(o.gross_amount)}</td><td ${label('Fees')}>${money(o.fee_amount)}</td><td ${label('Net')}>${money(o.net_amount)}</td></tr>`).join('')}</tbody></table></div></div><div class="cx-card cx-span-3"><div class="cx-section-title">Exceptions</div><div class="cx-exception"><span>Refund records</span><strong>${num(refunds.length)}</strong></div><div class="cx-exception"><span>Low reviews (≤3)</span><strong>${num(lowReviews)}</strong></div><div class="cx-exception"><span>Missing order details</span><strong>${num(missingDetails)}</strong></div><div class="cx-exception"><span>Pending payments</span><strong>${num(payments.filter(p=>p.is_pending).length)}</strong></div></div></div>`;
    el('cxSellerRefresh').onclick=loadSeller;
  }

  async function loadSyp(){
    const host=el('cxSyp');if(!host)return;host.innerHTML=`<div class="cx-page-head"><div><h2>SYP</h2><p>What changed?</p></div><button id="cxSypRefresh" class="cx-refresh">Refresh</button></div><div class="cx-empty">Loading SYP…</div>`;
    try{
      const [products,events,snaps]=await Promise.all([
        rest('syp_products?select=tcgplayer_id,product_name,set_name,condition,market_price,current_max_quantity,first_seen,last_seen,is_currently_eligible&order=collected_at.desc&limit=50000'),
        rest('syp_events?select=event_id,tcgplayer_id,product_name,set_name,event_type,old_value,new_value,difference,changed_at&order=changed_at.desc&limit=500'),
        rest('syp_snapshots?select=snapshot_id,last_updated,captured_at,row_count&order=captured_at.desc&limit=10')
      ]);renderSyp(host,products||[],events||[],snaps||[]);
    }catch(e){host.innerHTML=`<div class="cx-page-head"><div><h2>SYP</h2><p>What changed?</p></div></div><div class="cx-empty">${esc(e.message)}</div>`}
  }
  function renderSyp(host,products,events,snaps){
    const current=products.filter(p=>p.is_currently_eligible), added=events.filter(e=>e.event_type==='ADDED').length, removed=events.filter(e=>e.event_type==='REMOVED').length, inc=events.filter(e=>/INCREASED/.test(e.event_type)).length, dec=events.filter(e=>/DECREASED/.test(e.event_type)).length, latest=snaps[0];
    host.innerHTML=`<div class="cx-page-head"><div><h2>SYP</h2><p>Eligibility and max-quantity changes.</p></div><button id="cxSypRefresh" class="cx-refresh">Refresh</button></div><div class="cx-kpis"><div class="cx-kpi"><span>Eligible SKUs</span><strong>${num(current.length)}</strong></div><div class="cx-kpi"><span>Added</span><strong class="cx-status-good">+${num(added)}</strong></div><div class="cx-kpi"><span>Removed</span><strong class="cx-status-bad">-${num(removed)}</strong></div><div class="cx-kpi"><span>Max qty ↑</span><strong class="cx-status-good">${num(inc)}</strong></div><div class="cx-kpi"><span>Max qty ↓</span><strong class="cx-status-bad">${num(dec)}</strong></div><div class="cx-kpi"><span>Last update</span><strong style="font-size:14px">${esc(latest?.last_updated||'—')}</strong><small>${dt(latest?.captured_at)}</small></div></div><div class="cx-syp-tabs"><button class="active">Changes</button><button id="cxSypEligibleTab">Eligible</button><button>History</button><button>Trends</button></div><div class="cx-filters"><input id="cxSypSearch" placeholder="Search SYP changes…"><select id="cxSypType"><option value="">All change types</option><option>ADDED</option><option>REMOVED</option><option>MAX_QUANTITY_INCREASED</option><option>MAX_QUANTITY_DECREASED</option></select></div><div id="cxSypBody"></div>`;
    const renderChanges=()=>{const q=el('cxSypSearch').value.toLowerCase(),t=el('cxSypType').value,filtered=events.filter(e=>(!q||`${e.product_name} ${e.set_name}`.toLowerCase().includes(q))&&(!t||e.event_type===t));el('cxSypBody').innerHTML=`<div class="cx-table-wrap"><table class="cx-table"><thead><tr><th>Change</th><th>Card</th><th>Set</th><th>Old max</th><th>New max</th><th>Changed</th></tr></thead><tbody>${filtered.slice(0,100).map(e=>`<tr><td ${label('Change')}><span class="cx-badge ${e.event_type==='REMOVED'?'cx-removed':'cx-added'}">${esc(e.event_type.replaceAll('_',' '))}</span></td><td class="cx-cardname" ${label('Card')}>${esc(e.product_name||'')}</td><td ${label('Set')}>${esc(e.set_name||'')}</td><td ${label('Old max')}>${e.old_value??'—'}</td><td ${label('New max')}>${e.new_value??'—'}</td><td ${label('Changed')}>${dt(e.changed_at)}</td></tr>`).join('')}</tbody></table></div>`};
    el('cxSypSearch').oninput=renderChanges;el('cxSypType').onchange=renderChanges;el('cxSypRefresh').onclick=loadSyp;renderChanges();
  }

  async function loadAdmin(){
    const host=el('cxAdmin');if(!host)return;host.innerHTML=`<div class="cx-page-head"><div><h2>Admin</h2><p>Is the system healthy?</p></div><button id="cxAdminRefresh" class="cx-refresh">Refresh</button></div><div class="cx-empty">Loading system health…</div>`;
    try{
      const [jobs,collectors,scans,snaps]=await Promise.all([
        rest('collector_jobs?select=job_id,source,action,status,preferred_executor,created_at,completed_at,error_message,progress_json&order=created_at.desc&limit=300'),
        rest('collectors?select=name,collector_type,platform,last_seen_at,status,app_version,session_health_json&order=last_seen_at.desc&limit=50'),
        rest('marketplace_scans?select=set_name,captured_at,unique_skus&order=captured_at.desc&limit=50'),
        rest('syp_snapshots?select=last_updated,captured_at,row_count&order=captured_at.desc&limit=1')
      ]);renderAdmin(host,jobs||[],collectors||[],scans||[],snaps||[]);
    }catch(e){host.innerHTML=`<div class="cx-page-head"><div><h2>Admin</h2><p>Is the system healthy?</p></div></div><div class="cx-empty">${esc(e.message)}</div>`}
  }
  function renderAdmin(host,jobs,collectors,scans,snaps){
    const q=jobs.filter(j=>j.status==='queued').length,r=jobs.filter(j=>['claimed','running'].includes(j.status)).length,f=jobs.filter(j=>j.status==='failed').length,c=jobs.filter(j=>j.status==='completed').length;
    const android=collectors.find(x=>x.collector_type==='mobile_agent'&&x.platform==='android'),cloud=collectors.find(x=>x.collector_type==='cloud_worker');
    host.innerHTML=`<div class="cx-page-head"><div><h2>Admin</h2><p>Syncs, collectors, jobs and diagnostics.</p></div><button id="cxAdminRefresh" class="cx-refresh">Refresh</button></div><div class="cx-grid"><div class="cx-card cx-span-3"><div class="cx-section-title">Syncs</div><div class="cx-exception"><span>Latest set scan</span><strong>${shortDate(scans[0]?.captured_at)}</strong></div><div class="cx-exception"><span>Latest SYP</span><strong>${shortDate(snaps[0]?.captured_at)}</strong></div><div class="cx-exception"><span>Cloud worker</span><strong class="${cloud?'cx-status-good':'cx-status-bad'}">${cloud?'Online':'Missing'}</strong></div></div><div class="cx-card cx-span-3"><div class="cx-section-title">Jobs</div><div class="cx-exception"><span>Queued</span><strong>${q}</strong></div><div class="cx-exception"><span>Running</span><strong>${r}</strong></div><div class="cx-exception"><span>Completed</span><strong>${c}</strong></div><div class="cx-exception"><span>Failed</span><strong class="${f?'cx-status-bad':''}">${f}</strong></div></div><div class="cx-card cx-span-3"><div class="cx-section-title">Collectors</div><div class="cx-exception"><span>Android</span><strong>${esc(android?.app_version||'—')}</strong></div><div class="cx-exception"><span>Android auth</span><strong class="${android?.session_health_json?.authenticated?'cx-status-good':'cx-status-bad'}">${android?.session_health_json?.authenticated?'Authenticated':'Needs auth'}</strong></div><div class="cx-exception"><span>Last heartbeat</span><strong>${shortDate(android?.last_seen_at)}</strong></div></div><div class="cx-card cx-span-3"><div class="cx-section-title">Data health</div><div class="cx-exception"><span>Recent scans</span><strong>${num(scans.length)}</strong></div><div class="cx-exception"><span>SYP rows</span><strong>${num(snaps[0]?.row_count)}</strong></div><div class="cx-exception"><span>Failed jobs</span><strong class="${f?'cx-status-bad':'cx-status-good'}">${f}</strong></div></div><div class="cx-card cx-span-12"><div class="cx-detail-title"><div class="cx-section-title" style="margin:0">Recent jobs</div><div class="cx-admin-actions"><button id="cxLegacyControls" class="cx-secondary">Advanced / legacy controls</button></div></div><div class="cx-table-wrap" style="margin-top:12px"><table class="cx-table"><thead><tr><th>Action</th><th>Source</th><th>Executor</th><th>Status</th><th>Created</th><th>Error</th></tr></thead><tbody>${jobs.slice(0,50).map(j=>`<tr><td class="cx-cardname" ${label('Action')}>${esc(j.action)}</td><td ${label('Source')}>${esc(j.source)}</td><td ${label('Executor')}>${esc(j.preferred_executor||'')}</td><td ${label('Status')}>${esc(j.status)}</td><td ${label('Created')}>${dt(j.created_at)}</td><td ${label('Error')}>${esc(j.error_message||'')}</td></tr>`).join('')}</tbody></table></div></div></div>`;
    el('cxAdminRefresh').onclick=loadAdmin;el('cxLegacyControls').onclick=()=>{const app=el('app');app.classList.toggle('collectish-show-legacy');el('cxLegacyControls').textContent=app.classList.contains('collectish-show-legacy')?'Return to new dashboard':'Advanced / legacy controls'};
  }

  let tries=0;const t=setInterval(()=>{tries++;if(install()||tries>200)clearInterval(t)},100);
})();
