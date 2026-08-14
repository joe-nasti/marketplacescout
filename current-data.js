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
  const jwtExpired=e=>/jwt\s+expired|token\s+expired|pgrst303/i.test(String(e?.message||e||''));
  async function callWithFreshJwt(path,o){
    try{return await baseRest(path,o)}catch(e){
      if(!jwtExpired(e))throw e;
      const s=typeof session==='function'?session():null;
      if(!s?.refresh||typeof save!=='function'||typeof valid!=='function')throw e;
      save({...s,exp:0});
      const refreshed=await valid();
      if(!refreshed)throw e;
      return baseRest(path,o);
    }
  }
  async function readAll(path){
    const clean=stripPaging(path),rows=[];
    for(let offset=0;offset<MAX_ROWS;offset+=PAGE_SIZE){
      const chunk=await callWithFreshJwt(withPaging(clean,PAGE_SIZE,offset),{});
      rows.push(...(chunk||[]));
      if(!chunk||chunk.length<PAGE_SIZE)break;
    }
    return rows;
  }

  rest=async function(path,o={}){
    const method=String(o?.method||"GET").toUpperCase();
    if(method==="GET"&&fullTables.has(tableFrom(path)))return readAll(path);
    return callWithFreshJwt(path,o);
  };

  window.__collectishPagedRest={pageSize:PAGE_SIZE,maxRows:MAX_ROWS,tables:[...fullTables],jwtRetry:true};
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
    if(opsButton){opsButton.textContent='More';opsButton.title='Operations, cloud health, jobs, and connector status';opsButton.classList.add('collectish-more-nav')}
    if(!el('collectishOperationsIntro')){
      const intro=document.createElement('section');intro.id='collectishOperationsIntro';intro.className='card collectish-ops-intro';intro.dataset.collectishPage='operations';
      intro.innerHTML='<div><h2>Operations</h2><div class="meta">Cloud execution, job queue, data health, and connector controls. Routine Marketplace work runs in the cloud; connector controls are secondary.</div></div>';
      const firstOps=[...app.querySelectorAll(':scope > section[data-collectish-page="operations"]')][0];if(firstOps)app.insertBefore(intro,firstOps);else app.appendChild(intro);
    }
    const pc=sectionByTitle('PC status');if(pc){pc.querySelector('h2').textContent='PC connector';pc.classList.add('collectish-ops-secondary')}
    const profiles=sectionByTitle('Scan profiles');if(profiles)profiles.classList.add('collectish-ops-secondary');
    const requests=sectionByTitle('Requests');if(requests){requests.querySelector('h2').textContent='Legacy requests';requests.classList.add('collectish-ops-secondary')}
    const order=['collectishOperationsIntro','marketplaceExecutionStatus',sectionByTitle('New scan')?.id,'collectishJobs','collectishCloudHealth','collectishParity',pc?.id,profiles?.id,requests?.id].filter(Boolean);
    let anchor=el('collectishOperationsIntro');for(const id of order.slice(1)){const node=el(id);if(!node||!anchor)continue;anchor.insertAdjacentElement('afterend',node);anchor=node}return true;
  }
  let tries=0;const timer=setInterval(()=>{tries++;if(install()||tries>160)clearInterval(timer)},100);
})();

// Collectish connector-role layer — the desktop extension is now an agent,
// not a second application. Public Marketplace collection belongs to cloud.
(() => {
  const el=id=>document.getElementById(id);
  function hideLegacyRunOnPc(){
    const profiles=[...document.querySelectorAll('button')].filter(b=>(b.textContent||'').trim()==='Run on PC');
    for(const b of profiles){b.hidden=true;b.style.display='none';const row=b.closest('.profile,.scan-profile,.request-row,article,li,div');if(row&&!row.querySelector('.collectish-cloud-owned-note')){const n=document.createElement('div');n.className='meta collectish-cloud-owned-note';n.textContent='Routine scans now run in Collectish Cloud.';b.insertAdjacentElement('afterend',n)}}
  }
  function install(){
    const app=el('app'),intro=el('collectishOperationsIntro');if(!app||!intro||el('collectishConnectorRole'))return false;
    const panel=document.createElement('section');panel.id='collectishConnectorRole';panel.className='card collectish-ops-panel';panel.dataset.collectishPage='operations';
    panel.innerHTML=`<div class="toolbar"><div><h2>Connector responsibilities</h2><div class="meta">The browser connector only handles work that genuinely needs a signed-in browser session or acts as Marketplace fallback.</div></div></div><div class="collectish-health-grid"><div class="collectish-health-card"><span>Cloud-owned</span><strong>Marketplace scans</strong><small>Search, pricepoints, Direct quantities, sales history, scoring, persistence, and analytics.</small></div><div class="collectish-health-card"><span>Browser-owned</span><strong>Authenticated seller data</strong><small>Seller Portal, private account pages, session-only exports, and collectors that cannot run anonymously.</small></div><div class="collectish-health-card"><span>Browser fallback</span><strong>Marketplace recovery</strong><small>Only after a cloud scan explicitly fails or when a job requests browser_connector.</small></div><div class="collectish-health-card"><span>Not browser-owned</span><strong>UI + history</strong><small>Scout, Cards, Sales, Direct, Money, Trends, job history, and analytics live in the cloud app.</small></div></div>`;
    intro.insertAdjacentElement('afterend',panel);const pc=[...app.querySelectorAll('section.card')].find(s=>(s.querySelector('h2')?.textContent||'').trim()==='PC connector');if(pc){const meta=pc.querySelector('.meta');if(meta)meta.textContent='Authenticated-session agent and Marketplace fallback. It is no longer the primary scanner or dashboard.'}hideLegacyRunOnPc();return true;
  }
  const observer=new MutationObserver(()=>hideLegacyRunOnPc());observer.observe(document.documentElement,{childList:true,subtree:true});let tries=0;const timer=setInterval(()=>{tries++;hideLegacyRunOnPc();if(install()||tries>160)clearInterval(timer)},100);
  window.__collectishConnectorPolicy={cloudOwned:['marketplace_scan','scout_ui','cards_ui','sales_ui','direct_ui','money_ui','analytics','history'],browserOwned:['authenticated_seller_portal','session_only_export','private_account_collection'],browserFallback:['marketplace_scan_after_cloud_failure']};
})();
