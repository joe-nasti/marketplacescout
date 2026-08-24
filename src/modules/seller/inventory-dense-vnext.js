import { rest } from '../../core/rest.js';
import store from '../../state/store.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
const num=n=>Number(n||0).toLocaleString();
const age=t=>{if(!t)return'—';const ms=Date.now()-new Date(t).getTime();if(!Number.isFinite(ms))return'—';const h=Math.max(0,Math.round(ms/3600000));if(h<1)return'now';if(h<24)return`${h}h`;return`${Math.round(h/24)}d`};
const host=()=>document.getElementById('cxInventory');
let mode='scan',filter='all',query='';
let scoutByProduct=new Map(),salesByProduct=new Map();
let contextSignature='',contextLoading=null;

function products(){return Array.isArray(store.get().inventory?.products)?store.get().inventory.products:[]}
function conditions(){return Array.isArray(store.get().inventory?.conditionRows)?store.get().inventory.conditionRows:[]}
function productIds(){return products().map(x=>String(x.product_id||'')).filter(Boolean).slice(0,120)}
function signature(){return productIds().join('|')}

async function loadContext(){
  const sig=signature();
  if(!sig||sig===contextSignature||contextLoading)return contextLoading;
  contextSignature=sig;
  const encoded=productIds().map(encodeURIComponent).join(',');
  contextLoading=Promise.all([
    rest(`scout_opportunities_v5?select=product_id,promoted_score,promoted_grade,sku_market_price,direct_low,ck_buylist,direct_net_est,avg_daily_qty_sold,latest_scan_at&product_id=in.(${encoded})&order=promoted_score.desc&limit=500`).catch(()=>[]),
    rest(`seller_product_summary?select=product_id,units_sold,revenue,last_sold_at&product_id=in.(${encoded})&limit=500`).catch(()=>[])
  ]).then(([scout,sales])=>{
    scoutByProduct=new Map();
    for(const r of scout||[]){const k=String(r.product_id||'');if(k&&!scoutByProduct.has(k))scoutByProduct.set(k,r)}
    salesByProduct=new Map();
    for(const r of sales||[]){const k=String(r.product_id||'');if(!k)continue;const prev=salesByProduct.get(k)||{units_sold:0,revenue:0,last_sold_at:null};prev.units_sold+=Number(r.units_sold||0);prev.revenue+=Number(r.revenue||0);if(r.last_sold_at&&(!prev.last_sold_at||new Date(r.last_sold_at)>new Date(prev.last_sold_at)))prev.last_sold_at=r.last_sold_at;salesByProduct.set(k,prev)}
  }).finally(()=>{contextLoading=null;renderShell()});
  return contextLoading;
}

function conditionMap(){const m=new Map();for(const c of conditions()){const k=String(c.product_id||'');if(!k)continue;if(!m.has(k))m.set(k,[]);m.get(k).push(c)}return m}
function classify(r,exact,scout){
  const flags=[];
  const active=exact.filter(x=>Number(x.quantity||0)>0||Number(x.pending_quantity||0)>0||Number(x.reserve_quantity||0)>0);
  if(!active.length)flags.push('review');
  if(active.some(x=>x.price!=null&&x.seller_has_lowest_price===false))flags.push('reprice');
  const weeklyVelocity=Math.max(0,Number(scout?.avg_daily_qty_sold||0))*7;
  if(['A','B'].includes(String(scout?.promoted_grade||'').toUpperCase())&&weeklyVelocity>Number(r.quantity||0)&&weeklyVelocity>0)flags.push('restock');
  const ck=Number(scout?.ck_buylist||0),directNet=Number(scout?.direct_net_est||0);
  if(ck>0&&directNet>0&&ck>=directNet)flags.push('exit');
  if(!flags.length)flags.push('hold');
  const order=['exit','reprice','restock','review','hold'];
  return {flags,primary:order.find(x=>flags.includes(x))||'hold',weeklyVelocity};
}
function labelFor(kind){return {exit:'Vendor exit',reprice:'Price review',restock:'Restock watch',review:'Needs detail',hold:'Hold'}[kind]||'Hold'}
function chipClass(kind){return `cx-iv-chip cx-iv-${kind}`}
function buildRows(){
  const byCondition=conditionMap();
  return products().map(r=>{
    const id=String(r.product_id||''),exact=byCondition.get(id)||[],scout=scoutByProduct.get(id)||null,sales=salesByProduct.get(id)||null;
    const prices=exact.map(x=>Number(x.price)).filter(Number.isFinite),myPrice=prices.length?Math.min(...prices):null;
    const action=classify(r,exact,scout);
    return {...r,id,exact,scout,sales,myPrice,action};
  }).sort((a,b)=>{
    const rank={exit:5,reprice:4,restock:3,review:2,hold:1};
    return (rank[b.action.primary]-rank[a.action.primary])||(Number(b.scout?.promoted_score||0)-Number(a.scout?.promoted_score||0))||(Number(b.scout?.avg_daily_qty_sold||0)-Number(a.scout?.avg_daily_qty_sold||0));
  });
}
function filteredRows(){
  const q=query.trim().toLowerCase();
  return buildRows().filter(r=>(filter==='all'||r.action.flags.includes(filter))&&(!q||`${r.product_name} ${r.set_name} ${r.product_id}`.toLowerCase().includes(q)));
}
function metric(label,value,sub=''){return `<div class="cx-iv-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`}
function rowHtml(r){
  const s=r.scout,sales=r.sales;
  const market=s?.sku_market_price==null?'—':money(s.sku_market_price);
  const scout=s?`${esc(s.promoted_grade||'—')} ${Math.round(Number(s.promoted_score||0))}`:'—';
  const sold=sales?num(sales.units_sold):'—';
  const velocity=s?.avg_daily_qty_sold==null?'—':`${Number(s.avg_daily_qty_sold).toFixed(1)}/d`;
  return `<button type="button" class="cx-iv-row" data-iv-product="${esc(r.id)}">
    <span class="cx-iv-card">${r.image_75||r.image_200?`<img src="${esc(r.image_75||r.image_200)}" alt="" loading="lazy">`:''}<span><strong>${esc(r.product_name||r.id)}</strong><small>${esc(r.set_name||'')} · ${esc(r.id)}</small></span></span>
    <span class="cx-iv-num"><strong>${num(r.quantity)}</strong><small>qty</small></span>
    <span class="cx-iv-num"><strong>${esc(money(r.myPrice))}</strong><small>my price</small></span>
    <span class="cx-iv-num"><strong>${esc(market)}</strong><small>market</small></span>
    <span class="cx-iv-num"><strong>${scout}</strong><small>Scout</small></span>
    <span class="cx-iv-num"><strong>${esc(sold)}</strong><small>sold</small></span>
    <span class="cx-iv-num"><strong>${esc(velocity)}</strong><small>velocity</small></span>
    <span class="cx-iv-action"><span class="${chipClass(r.action.primary)}">${esc(labelFor(r.action.primary))}</span><small>${r.action.primary==='exit'?`CK ${esc(money(s?.ck_buylist))} ≥ net Direct ${esc(money(s?.direct_net_est))}`:r.action.primary==='reprice'?'At least one exact listing is not lowest':r.action.primary==='restock'?`On hand below ~7d velocity (${r.action.weeklyVelocity.toFixed(1)})`:r.action.primary==='review'?'Exact condition rows not loaded':`Data ${esc(age(r.captured_at))} old`}</small></span>
  </button>`;
}
function renderScan(){
  const all=buildRows(),rows=filteredRows();
  const counts=k=>all.filter(r=>r.action.flags.includes(k)).length;
  const copies=all.reduce((s,r)=>s+Number(r.quantity||0),0);
  return `<div class="cx-iv-scan">
    <div class="cx-iv-metrics">${metric('Products',num(all.length),'in stock')}${metric('Copies',num(copies),'on hand')}${metric('Price review',num(counts('reprice')),'not lowest')}${metric('Restock',num(counts('restock')),'velocity-backed')}${metric('Vendor exit',num(counts('exit')),'buylist ≥ net Direct')}</div>
    <div class="cx-iv-toolbar"><div class="cx-iv-filters">${[['all','All'],['reprice','Price review'],['restock','Restock'],['exit','Vendor exit'],['review','Needs detail']].map(([v,l])=>`<button type="button" data-iv-filter="${v}" class="${filter===v?'active':''}">${l}</button>`).join('')}</div><input id="cxIvSearch" type="search" value="${esc(query)}" placeholder="Search cards, sets, product IDs…"><button type="button" data-iv-workspace>Workspace</button></div>
    <div class="cx-iv-head"><span>Card</span><span>Qty</span><span>My price</span><span>Market</span><span>Scout</span><span>Sold</span><span>Velocity</span><span>Action</span></div>
    <div class="cx-iv-list">${rows.length?rows.slice(0,500).map(rowHtml).join(''):'<div class="cx-empty">No inventory matches this action view.</div>'}</div>
  </div>`;
}
function renderShell(){
  const h=host();if(!h)return;
  let shell=document.getElementById('cxInventoryVnext');
  if(!shell){shell=document.createElement('section');shell.id='cxInventoryVnext';shell.className='cx-inventory-vnext';const head=h.querySelector('.cx-page-head');if(head)head.insertAdjacentElement('afterend',shell);else h.prepend(shell)}
  shell.innerHTML=`<div class="cx-iv-nav"><button type="button" data-iv-mode="scan" class="${mode==='scan'?'active':''}">Action queue</button><button type="button" data-iv-mode="workspace" class="${mode==='workspace'?'active':''}">Workspace</button><span>Dense inventory decisions · no inferred holding age</span></div><div id="cxIvBody">${mode==='scan'?renderScan():''}</div>`;
  applyMode();
}
function legacyPanels(){const h=host();if(!h)return[];return [...h.children].filter(el=>el.id!=='cxInventoryVnext'&&!el.classList.contains('cx-page-head'))}
function applyMode(){for(const el of legacyPanels())el.hidden=mode==='scan';host()?.classList.toggle('cx-iv-scan-mode',mode==='scan')}
function setMode(next){mode=next;renderShell()}
function openProduct(id){setMode('workspace');setTimeout(()=>{const btn=[...document.querySelectorAll('#cxInventoryList [data-product]')].find(x=>String(x.dataset.product)===String(id));btn?.click();btn?.scrollIntoView({block:'nearest'})},30)}

document.addEventListener('click',e=>{
  const m=e.target.closest?.('[data-iv-mode]');if(m){e.preventDefault();setMode(m.dataset.ivMode);return}
  const f=e.target.closest?.('[data-iv-filter]');if(f){e.preventDefault();filter=f.dataset.ivFilter;renderShell();return}
  const row=e.target.closest?.('[data-iv-product]');if(row){e.preventDefault();openProduct(row.dataset.ivProduct);return}
  if(e.target.closest?.('[data-iv-workspace]')){e.preventDefault();setMode('workspace')}
},true);
document.addEventListener('input',e=>{if(e.target?.id==='cxIvSearch'){query=e.target.value;const pos=e.target.selectionStart;renderShell();const input=document.getElementById('cxIvSearch');if(input){input.focus();try{input.setSelectionRange(pos,pos)}catch{}}}},true);

store.subscribe(s=>s.inventory,(next,prev)=>{
  if(next===prev)return;
  queueMicrotask(()=>{renderShell();void loadContext()});
},{immediate:false});
document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='inventory')setTimeout(()=>{renderShell();void loadContext()},80)});
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='inventory')setTimeout(()=>{renderShell();void loadContext()},80)});
document.addEventListener('collectish:inventory-modules-ready',()=>{renderShell();void loadContext()});
queueMicrotask(()=>{renderShell();void loadContext()});
