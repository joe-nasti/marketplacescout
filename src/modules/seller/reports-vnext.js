import store from '../../state/store.js';

let installed=false;
const host=()=>document.getElementById('cxSeller');
const seller=()=>store.get().seller||{};
const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
const num=n=>Number(n||0).toLocaleString();
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function tab(){return seller().tab||'overview'}
function summary(){return seller().summary||{}}
function metric(label,value,sub=''){return `<span class="cx-sellr-metric"><small>${esc(label)}</small><strong>${esc(value)}</strong>${sub?`<em>${esc(sub)}</em>`:''}</span>`}
function contextHtml(current){
  const s=summary(),gross=Number(s.gross_sales||0),fees=Number(s.total_fees||0),refunds=Number(s.order_refund_total||0),net=Number(s.net_after_refunds||0);
  if(current==='orders')return metric('Orders',num(s.order_count),`${num(s.missing_detail_count)} details pending`)+metric('Gross',money(gross))+metric('Net',money(net));
  if(current==='products')return metric('Orders',num(s.order_count))+metric('Gross',money(gross))+metric('Fees',money(fees));
  if(current==='refunds')return metric('Refunds',money(refunds),`${num(s.refund_record_count)} records`)+metric('Low reviews',num(s.low_review_count))+metric('Gross',money(gross));
  if(current==='reviews')return metric('Reviews',num(s.review_count),s.average_rating?`${Number(s.average_rating).toFixed(2)}★ average`:'')+metric('Low reviews',num(s.low_review_count))+metric('Orders',num(s.order_count));
  if(current==='payments')return metric('Pending',num(s.pending_payment_count),'payment records')+metric('Gross',money(gross))+metric('Fees',money(fees));
  if(current==='ris')return metric('Discrepancies',num(s.ri_discrepancy_count))+metric('Replacement fees',money(s.ri_replacement_fees))+metric('Orders',num(s.order_count));
  return '';
}
function ensureContext(){
  const body=document.getElementById('cxSellerParityBody'),current=tab();if(!body)return;
  let ctx=document.getElementById('cxSellerReportContext');
  if(current==='overview'){ctx?.remove();return}
  if(!ctx){ctx=document.createElement('div');ctx.id='cxSellerReportContext';ctx.className='cx-sellr-context';body.prepend(ctx)}
  ctx.innerHTML=contextHtml(current);
}
function classifyTables(){
  const current=tab();
  document.querySelectorAll('#cxSellerParityBody .cx-table').forEach((table,i)=>{
    table.classList.remove('cx-sellr-orders','cx-sellr-products','cx-sellr-refunds','cx-sellr-reviews','cx-sellr-payments','cx-sellr-ris','cx-sellr-secondary');
    if(current==='orders')table.classList.add('cx-sellr-orders');
    else if(current==='products')table.classList.add('cx-sellr-products');
    else if(current==='refunds')table.classList.add('cx-sellr-refunds',i>0?'cx-sellr-secondary':'');
    else if(current==='reviews')table.classList.add('cx-sellr-reviews');
    else if(current==='payments')table.classList.add('cx-sellr-payments',i>0?'cx-sellr-secondary':'');
    else if(current==='ris')table.classList.add('cx-sellr-ris',i>0?'cx-sellr-secondary':'');
  });
  document.querySelectorAll('#cxSellerParityBody td[data-label="Reason"]').forEach(td=>{td.title=td.textContent.trim()});
  document.querySelectorAll('#cxSellerParityBody td[data-label="Review"]').forEach(td=>{if(!td.textContent.trim())td.classList.add('cx-sellr-empty')});
}
function sync(){
  const h=host();if(!h)return;
  h.classList.add('cx-seller-reports-vnext');h.dataset.sellerReportTab=tab();
  ensureContext();classifyTables();
  h.querySelectorAll('.cx-seller-tabs button').forEach(b=>b.setAttribute('aria-current',b.classList.contains('active')?'page':'false'));
}
function schedule(){for(const ms of [0,80,220])setTimeout(sync,ms)}

export function installSellerReportsVnext(){
  if(installed)return;installed=true;
  document.addEventListener('collectish:seller-rendered',schedule);
  document.addEventListener('collectish:seller-tab-rendered',schedule);
  document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='seller')schedule()});
  document.addEventListener('collectish:ready',schedule);
  queueMicrotask(schedule);
}

installSellerReportsVnext();
window.CollectishSellerReportsVnext={sync};

const style=document.createElement('style');style.dataset.cxSellerReportsVnext='1';style.textContent=`
#cxSeller.cx-seller-reports-vnext .cx-seller-tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding:0 0 10px;margin:0;scroll-snap-type:x proximity}#cxSeller.cx-seller-reports-vnext .cx-seller-tabs::-webkit-scrollbar{display:none}#cxSeller.cx-seller-reports-vnext .cx-seller-tabs button{flex:0 0 auto;width:auto;min-width:84px;padding:7px 11px;font-size:10.5px;scroll-snap-align:start}#cxSeller.cx-seller-reports-vnext .cx-filters{display:grid;grid-template-columns:minmax(220px,1fr) minmax(150px,220px);gap:8px}#cxSeller.cx-seller-reports-vnext .cx-filters input,#cxSeller.cx-seller-reports-vnext .cx-filters select{min-width:0}.cx-sellr-context{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:0 0 10px}.cx-sellr-metric{border:1px solid var(--color-border);border-radius:10px;background:var(--color-bg-surface);padding:8px 10px;min-width:0}.cx-sellr-metric small,.cx-sellr-metric strong,.cx-sellr-metric em{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cx-sellr-metric small{font-size:8px;font-weight:850;text-transform:uppercase;letter-spacing:.04em;color:var(--color-text-secondary)}.cx-sellr-metric strong{margin-top:2px;font-size:14px;color:var(--color-text-primary)}.cx-sellr-metric em{margin-top:1px;font-size:8px;font-style:normal;color:var(--color-text-secondary)}#cxSellerParityBody .cx-card{border-radius:11px}#cxSellerParityBody .cx-section-title{font-size:12px}#cxSellerParityBody .cx-table th{font-size:8.5px;text-transform:uppercase;letter-spacing:.035em;color:var(--color-text-secondary)}#cxSellerParityBody .cx-table td{font-size:10.5px;font-variant-numeric:tabular-nums}#cxSellerParityBody td.cx-sellr-empty{color:var(--color-text-secondary)}
@media(max-width:700px){#cxSeller.cx-seller-reports-vnext .cx-seller-tabs{display:flex!important;grid-template-columns:none!important;overflow-x:auto!important;margin:0 0 9px!important;padding:0 0 3px!important}#cxSeller.cx-seller-reports-vnext .cx-seller-tabs button{width:auto!important;min-width:auto!important;padding:7px 10px!important;font-size:10px!important}#cxSeller.cx-seller-reports-vnext .cx-filters{grid-template-columns:1fr!important;gap:7px;margin-bottom:9px}.cx-sellr-context{gap:5px}.cx-sellr-metric{padding:7px 8px}.cx-sellr-metric strong{font-size:12px}#cxSellerParityBody .cx-card{padding:9px!important;margin-bottom:9px!important}#cxSellerParityBody .cx-table-wrap{border:1px solid var(--color-border);border-radius:10px;overflow:hidden;background:var(--color-bg-surface)}#cxSellerParityBody .cx-table,#cxSellerParityBody .cx-table tbody{display:block!important;width:100%!important}#cxSellerParityBody .cx-table thead{display:none!important}#cxSellerParityBody .cx-table tr{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;gap:2px 10px!important;margin:0!important;padding:8px 9px!important;border:0!important;border-bottom:1px solid var(--color-border)!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;min-height:0!important}#cxSellerParityBody .cx-table tr:last-child{border-bottom:0!important}#cxSellerParityBody .cx-table td{display:block!important;min-width:0!important;max-width:none!important;padding:0!important;border:0!important;background:transparent!important;font-size:10.5px!important;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#cxSellerParityBody .cx-table td::before{display:block!important;content:attr(data-label)!important;font-size:7px!important;line-height:1.1!important;margin:0 0 1px!important;color:var(--color-text-secondary)!important;font-weight:850!important;text-transform:uppercase!important;letter-spacing:.035em!important}#cxSellerParityBody .cx-table td:nth-child(odd){grid-column:1}#cxSellerParityBody .cx-table td:nth-child(even){grid-column:2;text-align:right}#cxSellerParityBody .cx-table td[data-label="Product"],#cxSellerParityBody .cx-table td[data-label="Reason"],#cxSellerParityBody .cx-table td[data-label="Review"],#cxSellerParityBody .cx-table td[data-label="Buyer"]{white-space:normal!important;overflow:visible!important;text-overflow:clip!important}#cxSellerParityBody .cx-sellr-products td[data-label="Product"]{grid-column:1/-1!important;text-align:left!important;font-weight:750;font-size:11px!important;margin-bottom:3px}#cxSellerParityBody .cx-sellr-orders td[data-label="Order"]{grid-column:1;font-weight:750}#cxSellerParityBody .cx-sellr-orders td[data-label="Date"]{grid-column:2;text-align:right}#cxSellerParityBody .cx-sellr-orders td[data-label="Buyer"]{grid-column:1}#cxSellerParityBody .cx-sellr-orders td[data-label="Status"]{grid-column:2;text-align:right}#cxSellerParityBody .cx-sellr-orders td[data-label="Fulfillment"]{display:none!important}#cxSellerParityBody .cx-sellr-orders td[data-label="Review"]{display:none!important}#cxSellerParityBody .cx-sellr-orders td[data-label="Gross"],#cxSellerParityBody .cx-sellr-orders td[data-label="Fees"],#cxSellerParityBody .cx-sellr-orders td[data-label="Refund"],#cxSellerParityBody .cx-sellr-orders td[data-label="Net"]{grid-column:auto!important;text-align:left!important;margin-top:4px}#cxSellerParityBody .cx-sellr-orders tr{grid-template-columns:minmax(0,1fr) minmax(72px,.55fr) minmax(68px,.5fr) minmax(68px,.5fr)!important}#cxSellerParityBody .cx-sellr-orders td[data-label="Order"]{grid-column:1/4}#cxSellerParityBody .cx-sellr-orders td[data-label="Date"]{grid-column:4}#cxSellerParityBody .cx-sellr-orders td[data-label="Buyer"]{grid-column:1/3}#cxSellerParityBody .cx-sellr-orders td[data-label="Status"]{grid-column:3/5}#cxSellerParityBody .cx-sellr-orders td[data-label="Gross"]{grid-column:1}#cxSellerParityBody .cx-sellr-orders td[data-label="Fees"]{grid-column:2}#cxSellerParityBody .cx-sellr-orders td[data-label="Refund"]{grid-column:3}#cxSellerParityBody .cx-sellr-orders td[data-label="Net"]{grid-column:4;color:var(--color-accent);font-weight:850}#cxSellerParityBody .cx-sellr-refunds td[data-label="Reason"]{grid-column:1/-1!important;text-align:left!important;display:-webkit-box!important;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden!important;margin-bottom:3px}#cxSellerParityBody .cx-sellr-reviews td[data-label="Review"].cx-sellr-empty{display:none!important}#cxSellerParityBody .cx-sellr-reviews td[data-label="Rating"]{color:var(--color-accent);font-weight:850}#cxSellerParityBody .cx-sellr-payments td[data-label="Payment ID"]{font-size:9.5px!important;max-width:180px!important}#cxSellerParityBody .cx-sellr-payments td[data-label="Payment"]{color:var(--color-accent);font-weight:850}#cxSellerParityBody .cx-sellr-ris td[data-label="RI"],#cxSellerParityBody .cx-sellr-ris td[data-label="Product"]{font-weight:750}#cxSellerParityBody .cx-sellr-secondary{margin-top:4px}}
@media(max-width:420px){.cx-sellr-context{grid-template-columns:repeat(3,minmax(0,1fr))}#cxSellerParityBody .cx-table tr{padding:7px 8px!important}#cxSellerParityBody .cx-table td{font-size:10px!important}}
`;document.head.appendChild(style);
