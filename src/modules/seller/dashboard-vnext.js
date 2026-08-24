import { rest } from '../../core/rest.js';
import store from '../../state/store.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
const num=n=>Number(n||0).toLocaleString();
const age=t=>{if(!t)return'—';const ms=Date.now()-new Date(t).getTime();if(!Number.isFinite(ms))return'—';const h=Math.max(0,Math.round(ms/3600000));if(h<1)return'now';if(h<24)return`${h}h`;return`${Math.round(h/24)}d`};
const host=()=>document.getElementById('cxSeller');
let mode='dashboard',products=[],productsLoading=null;

function seller(){return store.get().seller||{}}
function summary(){return seller().summary||{}}
function orders(){return Array.isArray(seller().recentOrders)?seller().recentOrders:[]}

async function loadProducts(){
  if(productsLoading||products.length)return productsLoading;
  productsLoading=rest('seller_product_summary?select=product_name,sku_id,product_id,order_count,units_sold,revenue,last_sold_at&order=revenue.desc&limit=12')
    .then(rows=>{products=Array.isArray(rows)?rows:[]})
    .catch(()=>{products=[]})
    .finally(()=>{productsLoading=null;render()});
  return productsLoading;
}
function metric(label,value,sub=''){return `<div class="cx-sellv-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`}
function attention(){
  const s=summary();
  return [
    {kind:'missing',label:'Missing order details',count:Number(s.missing_detail_count||0),sub:'orders need enrichment',tab:'orders'},
    {kind:'reviews',label:'Low reviews',count:Number(s.low_review_count||0),sub:'ratings ≤3★',tab:'reviews'},
    {kind:'payments',label:'Pending payments',count:Number(s.pending_payment_count||0),sub:'payment records pending',tab:'payments'},
    {kind:'ris',label:'RI discrepancies',count:Number(s.ri_discrepancy_count||0),sub:`${money(s.ri_replacement_fees)} replacement fees`,tab:'ris'}
  ].filter(x=>x.count>0);
}
function orderRow(o){
  const fees=Number(o.fee_amount||0)+Number(o.direct_fee_amount||0),net=Number(o.net_amount||0)-Number(o.refund_total||0),needs=!o.has_details||Number(o.refund_total||0)>0||Number(o.review_rating||0)>0&&Number(o.review_rating)<=3;
  return `<button type="button" class="cx-sellv-row ${needs?'attention':''}" data-sellv-order="${esc(o.order_number)}"><span class="cx-sellv-order"><strong>#${esc(o.order_number||'—')}</strong><small>${esc(o.buyer_name||o.order_channel||'')}</small></span><span class="cx-sellv-num"><strong>${esc(money(o.gross_amount))}</strong><small>gross</small></span><span class="cx-sellv-num"><strong>${esc(money(fees))}</strong><small>fees</small></span><span class="cx-sellv-num"><strong>${esc(money(o.refund_total))}</strong><small>refund</small></span><span class="cx-sellv-num"><strong>${esc(money(net))}</strong><small>net</small></span><span class="cx-sellv-state"><strong>${!o.has_details?'Needs detail':Number(o.refund_total||0)>0?'Refunded':o.review_rating?`${o.review_rating}★`:'OK'}</strong><small>${esc(age(o.order_date))}</small></span></button>`;
}
function productRow(p){return `<button type="button" class="cx-sellv-product" data-sellv-product="${esc(p.product_name||'')}"><span><strong>${esc(p.product_name||p.sku_id||p.product_id||'—')}</strong><small>${esc(p.sku_id||p.product_id||'')}</small></span><span><strong>${num(p.units_sold)}</strong><small>units</small></span><span><strong>${money(p.revenue)}</strong><small>sales</small></span><span><strong>${num(p.order_count)}</strong><small>orders</small></span><span><strong>${age(p.last_sold_at)}</strong><small>last sold</small></span></button>`}
function dashboard(){
  const s=summary(),gross=Number(s.gross_sales||0),fees=Number(s.total_fees||0),refunds=Number(s.order_refund_total||0),net=Number(s.net_after_refunds||0),feePct=gross>0?`${(fees/gross*100).toFixed(1)}%`:'—',exceptions=attention(),recent=orders().slice(0,14);
  return `<div class="cx-sellv-dashboard"><div class="cx-sellv-metrics">${metric('Orders',num(s.order_count),`${num(s.missing_detail_count)} details pending`)}${metric('Gross',money(gross),'all loaded history')}${metric('Net',money(net),'after refunds')}${metric('Fees',money(fees),feePct)}${metric('Refunds',money(refunds),`${num(s.refund_record_count)} records`)}${metric('Reviews',s.average_rating?`${Number(s.average_rating).toFixed(2)}★`:'—',`${num(s.review_count)} reviews`)}</div><div class="cx-sellv-grid"><section class="cx-sellv-panel"><div class="cx-sellv-panel-head"><div><strong>Needs attention</strong><small>${exceptions.length?`${exceptions.reduce((n,x)=>n+x.count,0)} flagged records`:'No current exceptions'}</small></div><button type="button" data-sellv-reports>Open reports</button></div><div class="cx-sellv-attention">${exceptions.length?exceptions.map(x=>`<button type="button" data-sellv-tab="${esc(x.tab)}"><span><strong>${esc(x.label)}</strong><small>${esc(x.sub)}</small></span><b>${num(x.count)}</b></button>`).join(''):'<div class="cx-empty">No summary exceptions are currently flagged.</div>'}</div><div class="cx-sellv-section-title">Recent orders</div><div class="cx-sellv-orders-head"><span>Order</span><span>Gross</span><span>Fees</span><span>Refund</span><span>Net</span><span>Status</span></div><div class="cx-sellv-orders">${recent.length?recent.map(orderRow).join(''):'<div class="cx-empty">No recent orders loaded.</div>'}</div></section><aside class="cx-sellv-panel"><div class="cx-sellv-panel-head"><div><strong>Top products</strong><small>ranked by loaded sales revenue</small></div><button type="button" data-sellv-tab="products">All products</button></div><div class="cx-sellv-products">${productsLoading&&!products.length?'<div class="cx-empty">Loading product activity…</div>':products.length?products.map(productRow).join(''):'<div class="cx-empty">No product summary available.</div>'}</div></aside></div></div>`;
}
function legacy(){const h=host();if(!h)return[];return [...h.children].filter(el=>el.id!=='cxSellerVnext'&&!el.classList.contains('cx-page-head'))}
function applyMode(){for(const el of legacy())el.hidden=mode==='dashboard';host()?.classList.toggle('cx-sellv-dashboard-mode',mode==='dashboard')}
function render(){
  const h=host();if(!h)return;
  let shell=document.getElementById('cxSellerVnext');
  if(!shell){shell=document.createElement('section');shell.id='cxSellerVnext';shell.className='cx-seller-vnext';const head=h.querySelector('.cx-page-head');if(head)head.insertAdjacentElement('afterend',shell);else h.prepend(shell)}
  shell.innerHTML=`<div class="cx-sellv-nav"><button type="button" data-sellv-mode="dashboard" class="${mode==='dashboard'?'active':''}">Dashboard</button><button type="button" data-sellv-mode="reports" class="${mode==='reports'?'active':''}">Reports</button><span>Operating view · exceptions first</span></div><div id="cxSellvBody">${mode==='dashboard'?dashboard():''}</div>`;
  applyMode();
  if(mode==='dashboard')void loadProducts();
}
function setMode(next){mode=next;render()}
function openTab(tab){setMode('reports');setTimeout(()=>document.querySelector(`[data-seller-tab="${CSS.escape(tab)}"]`)?.click(),30)}
function openOrder(order){openTab('orders');setTimeout(()=>{const q=document.getElementById('cxSellerOrderSearch');if(q){q.value=order;q.dispatchEvent(new Event('input',{bubbles:true}));q.focus()}},90)}
function openProduct(name){openTab('products');setTimeout(()=>{const q=document.getElementById('cxSellerProductSearch');if(q){q.value=name;q.dispatchEvent(new Event('input',{bubbles:true}));q.focus()}},90)}

document.addEventListener('click',e=>{
  const m=e.target.closest?.('[data-sellv-mode]');if(m){e.preventDefault();setMode(m.dataset.sellvMode);return}
  if(e.target.closest?.('[data-sellv-reports]')){e.preventDefault();setMode('reports');return}
  const tab=e.target.closest?.('[data-sellv-tab]');if(tab){e.preventDefault();openTab(tab.dataset.sellvTab);return}
  const order=e.target.closest?.('[data-sellv-order]');if(order){e.preventDefault();openOrder(order.dataset.sellvOrder);return}
  const product=e.target.closest?.('[data-sellv-product]');if(product){e.preventDefault();openProduct(product.dataset.sellvProduct)}
},true);
store.subscribe(s=>s.seller,(next,prev)=>{if(next===prev)return;queueMicrotask(render)},{immediate:false});
document.addEventListener('collectish:seller-rendered',()=>setTimeout(render,0));
document.addEventListener('collectish:seller-tab-rendered',()=>{if(mode==='dashboard')setTimeout(render,0)});
document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='seller')setTimeout(render,80)});
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='seller')setTimeout(render,80)});
queueMicrotask(render);
