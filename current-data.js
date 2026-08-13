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
