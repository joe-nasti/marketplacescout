import { rest } from '../../core/rest.js';
import store from '../../state/store.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
const num=n=>n==null?'—':Number(n||0).toLocaleString();
const age=t=>{if(!t)return'—';const ms=Date.now()-new Date(t).getTime();if(!Number.isFinite(ms))return'—';const h=Math.max(0,Math.round(ms/3600000));if(h<1)return'now';if(h<24)return`${h}h`;return`${Math.round(h/24)}d`};
const host=()=>document.getElementById('cxSyp');
let mode='scan',filter='all',query='';
let enrichment=new Map(),enrichmentSig='',loading=null;

function syp(){return store.get().syp||{}}
function baseRows(){return syp().tab==='products'&&Array.isArray(syp().rows)?syp().rows:[]}
function signature(){return baseRows().map(r=>String(r.tcgplayer_id||'')).filter(Boolean).join('|')}

async function loadEnrichment(){
  const sig=signature();
  if(!sig||sig===enrichmentSig||loading)return loading;
  enrichmentSig=sig;
  const skus=baseRows().map(r=>String(r.tcgplayer_id||'')).filter(Boolean);
  loading=rest('rpc/syp_marketplace_enrichment',{method:'POST',body:{p_skus:skus}})
    .then(rows=>{enrichment=new Map((rows||[]).map(x=>[String(x.sku_id||''),x]));})
    .catch(()=>{enrichment=new Map()})
    .finally(()=>{loading=null;renderShell()});
  return loading;
}

function classify(r,m){
  const cap=Math.max(0,Number(r.current_max_quantity||0));
  const velocity=Math.max(0,Number(m?.avg_daily_qty_sold||0));
  const directAvail=m?.direct_available==null?null:Math.max(0,Number(m.direct_available));
  const market=Number((r.market_price??m?.sku_market_price)??0);
  const direct=Number(m?.direct_low||0);
  const premium=market>0&&direct>0?(direct-market)/market:null;
  if(directAvail!=null&&directAvail<=5&&premium!=null&&premium>=0.10)return {kind:'scarce',label:'Direct scarce',reason:`Direct ${directAvail} · ${(premium*100).toFixed(0)}% premium`};
  if(velocity>=1&&cap>0)return {kind:'velocity',label:'High velocity',reason:`${velocity.toFixed(1)}/day · SYP max ${num(cap)}`};
  if(cap>=25)return {kind:'capacity',label:'High capacity',reason:`SYP currently accepts up to ${num(cap)}`};
  return {kind:'eligible',label:'Eligible',reason:cap>0?`SYP max ${num(cap)}`:'Currently eligible'};
}

function buildRows(){
  return baseRows().map(r=>{const sku=String(r.tcgplayer_id||''),m=enrichment.get(sku)||null;return {...r,sku,m,signal:classify(r,m)}})
    .sort((a,b)=>{
      const rank={scarce:4,velocity:3,capacity:2,eligible:1};
      return (rank[b.signal.kind]-rank[a.signal.kind])||(Number(b.m?.avg_daily_qty_sold||0)-Number(a.m?.avg_daily_qty_sold||0))||(Number(b.current_max_quantity||0)-Number(a.current_max_quantity||0));
    });
}
function filtered(){const q=query.trim().toLowerCase();return buildRows().filter(r=>(filter==='all'||r.signal.kind===filter)&&(!q||`${r.product_name} ${r.set_name} ${r.condition} ${r.sku}`.toLowerCase().includes(q)))}
function metric(label,value,sub=''){return `<div class="cx-sv-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`}
function chip(r){return `<span class="cx-sypv-chip cx-sypv-${esc(r.signal.kind)}">${esc(r.signal.label)}</span>`}
function rowHtml(r){
  const m=r.m,market=r.market_price??m?.sku_market_price,direct=m?.direct_low,velocity=m?.avg_daily_qty_sold;
  return `<button type="button" class="cx-sypv-row" data-sypv-sku="${esc(r.sku)}">
    <span class="cx-sypv-card"><strong>${esc(r.product_name||r.sku)}</strong><small>${esc([r.set_name,r.condition].filter(Boolean).join(' · '))}</small></span>
    <span class="cx-sypv-num"><strong>${esc(num(r.current_max_quantity))}</strong><small>SYP max</small></span>
    <span class="cx-sypv-num"><strong>${esc(money(market))}</strong><small>market</small></span>
    <span class="cx-sypv-num"><strong>${esc(money(direct))}</strong><small>Direct</small></span>
    <span class="cx-sypv-num"><strong>${esc(m?.direct_available==null?'—':num(m.direct_available))}</strong><small>D avail</small></span>
    <span class="cx-sypv-num"><strong>${esc(velocity==null?'—':`${Number(velocity).toFixed(1)}/d`)}</strong><small>velocity</small></span>
    <span class="cx-sypv-signal">${chip(r)}<small>${esc(r.signal.reason)}</small></span>
    <span class="cx-sypv-fresh"><strong>${esc(age(m?.latest_scan_at))}</strong><small>market data</small></span>
  </button>`;
}
function renderScan(){
  const all=buildRows(),rows=filtered(),count=k=>all.filter(r=>r.signal.kind===k).length;
  return `<div class="cx-sypv-scan">
    <div class="cx-sv-metrics">${metric('Eligible',num(all.length),'current page')}${metric('Direct scarce',num(count('scarce')),'≤5 Direct + premium')}${metric('High velocity',num(count('velocity')),'≥1 sale/day')}${metric('High capacity',num(count('capacity')),'SYP max ≥25')}</div>
    <div class="cx-sypv-toolbar"><div class="cx-sypv-filters">${[['all','All'],['scarce','Direct scarce'],['velocity','High velocity'],['capacity','High capacity']].map(([v,l])=>`<button type="button" data-sypv-filter="${v}" class="${filter===v?'active':''}">${l}</button>`).join('')}</div><input id="cxSypvSearch" type="search" value="${esc(query)}" placeholder="Search card, set, condition, SKU…"><button type="button" data-sypv-workspace>Workspace</button></div>
    <div class="cx-sypv-head"><span>Card</span><span>SYP max</span><span>Market</span><span>Direct</span><span>D avail</span><span>Velocity</span><span>Signal</span><span>Fresh</span></div>
    <div class="cx-sypv-list">${rows.length?rows.map(rowHtml).join(''):'<div class="cx-empty">No eligible products match this view.</div>'}</div>
    <div class="cx-sypv-note">This scan ranks the currently loaded eligible page using observed marketplace context. It does not imply that SYP max is your owned quantity or a guaranteed exit price.</div>
  </div>`;
}
function legacy(){const h=host();if(!h)return[];return [...h.children].filter(el=>el.id!=='cxSypVnext'&&!el.classList.contains('cx-page-head'))}
function applyMode(){for(const el of legacy())el.hidden=mode==='scan';host()?.classList.toggle('cx-sypv-scan-mode',mode==='scan')}
function renderShell(){
  const h=host();if(!h)return;
  let shell=document.getElementById('cxSypVnext');
  if(!shell){shell=document.createElement('section');shell.id='cxSypVnext';shell.className='cx-syp-vnext';const head=h.querySelector('.cx-page-head');if(head)head.insertAdjacentElement('afterend',shell);else h.prepend(shell)}
  const currentTab=syp().tab||'products';
  shell.innerHTML=`<div class="cx-sv-nav"><button type="button" data-sypv-mode="scan" class="${mode==='scan'?'active':''}">Scan</button><button type="button" data-sypv-mode="workspace" class="${mode==='workspace'?'active':''}">Workspace</button><button type="button" data-sypv-changes>Changes</button><span>${currentTab==='products'?'Eligible products':'Change events'} · dense SYP comparison</span></div><div id="cxSypvBody">${mode==='scan'&&currentTab==='products'?renderScan():mode==='scan'?'<div class="cx-empty">Switch to Eligible products in Workspace to populate the dense scan.</div>':''}</div>`;
  applyMode();
}
function setMode(v){mode=v;renderShell()}
function openWorkspaceRow(sku){setMode('workspace');setTimeout(()=>{const row=document.querySelector(`#cxSypTable tr[data-sku="${CSS.escape(String(sku))}"]`);row?.scrollIntoView({block:'center',behavior:'smooth'});row?.querySelector('.cx-cardname')?.classList.add('cx-sypv-focus')},40)}

document.addEventListener('click',e=>{
  const m=e.target.closest?.('[data-sypv-mode]');if(m){e.preventDefault();setMode(m.dataset.sypvMode);return}
  const f=e.target.closest?.('[data-sypv-filter]');if(f){e.preventDefault();filter=f.dataset.sypvFilter;renderShell();return}
  const row=e.target.closest?.('[data-sypv-sku]');if(row){e.preventDefault();openWorkspaceRow(row.dataset.sypvSku);return}
  if(e.target.closest?.('[data-sypv-workspace]')){e.preventDefault();setMode('workspace');return}
  if(e.target.closest?.('[data-sypv-changes]')){e.preventDefault();setMode('workspace');setTimeout(()=>document.querySelector('[data-syp-tab="events"]')?.click(),30)}
},true);
document.addEventListener('input',e=>{if(e.target?.id==='cxSypvSearch'){query=e.target.value;const pos=e.target.selectionStart;renderShell();const input=document.getElementById('cxSypvSearch');if(input){input.focus();try{input.setSelectionRange(pos,pos)}catch{}}}},true);

store.subscribe(s=>s.syp,(next,prev)=>{if(next===prev)return;queueMicrotask(()=>{renderShell();void loadEnrichment()})},{immediate:false});
document.addEventListener('collectish:syp-page-rendered',()=>{renderShell();void loadEnrichment()});
document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='syp')setTimeout(()=>{renderShell();void loadEnrichment()},80)});
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='syp')setTimeout(()=>{renderShell();void loadEnrichment()},80)});
queueMicrotask(()=>{renderShell();void loadEnrichment()});
