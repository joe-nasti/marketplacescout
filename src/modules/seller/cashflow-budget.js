import { rest } from '../../core/rest.js';

let row=null,loading=null,lastLoadedAt=0,error='';
let observer=null,reattachTimer=null;
const CACHE_MS=60*1000;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=v=>v==null?'—':Number(v).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
const pct=v=>v==null?'—':`${Number(v).toFixed(0)}%`;
const monthKey=()=>new Date().toISOString().slice(0,7)+'-01';
function host(){return document.getElementById('cxSeller')}
function stat(label,value,sub=''){return `<div class="cx-v5-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`}
function ensurePanel(){const h=host();if(!h)return null;let p=document.getElementById('cxSellerCashflowBudget');if(!p){p=document.createElement('section');p.id='cxSellerCashflowBudget';p.className='cx-card';h.prepend(p)}return p}
function render(){
  const p=ensurePanel();if(!p)return;
  if(loading){p.innerHTML='<div class="cx-section-title">Monthly buying budget</div><div class="cx-empty">Loading marketplace cash flow…</div>';return}
  if(error){p.innerHTML=`<div class="cx-section-title">Monthly buying budget</div><div class="cx-empty">Unavailable: ${esc(error)}</div>`;return}
  if(!row){p.innerHTML='<div class="cx-section-title">Monthly buying budget</div><div class="cx-empty">No cash-flow data yet.</div>';return}
  const entered=row.input_status==='entered';
  const safe=Number(row.safe_additional_buy_budget||0);
  p.innerHTML=`<div class="cx-page-head"><div><div class="cx-section-title">Monthly buying budget</div><p class="cx-sub">Balances marketplace payouts received against inventory purchases, operating spend, and a reserve floor. Purchase spend is entered manually until bank/card reconciliation is available.</p></div><button type="button" class="cx-refresh" id="cxCashflowRefresh">Refresh</button></div>
  <div class="cx-v5-grid">${stat('Cash received',money(row.posted_marketplace_cash),`${money(row.pending_marketplace_cash)} pending`)}${stat('3-mo avg payouts',money(row.trailing_3mo_avg_cash),'monthly benchmark')}${stat('Known spend',money(row.known_total_spend),`${money(row.inventory_purchase_spend)} inventory · ${money(row.operating_expense_spend)} operating`)}${stat('Safe additional buys',money(safe),entered?'ready for Scout allocation':'provisional until spend is entered')}</div>
  <div class="cx-scout-toolbar"><label class="cx-sub">Inventory purchases <input id="cxCashflowInventorySpend" inputmode="decimal" type="number" min="0" step="1" value="${esc(row.inventory_purchase_spend||0)}"></label><label class="cx-sub">Other operating spend <input id="cxCashflowOperatingSpend" inputmode="decimal" type="number" min="0" step="1" value="${esc(row.operating_expense_spend||0)}"></label><label class="cx-sub">Reserve % <input id="cxCashflowReserve" inputmode="decimal" type="number" min="0" max="100" step="1" value="${esc(row.reserve_pct||15)}"></label><label class="cx-sub">Buy target % <input id="cxCashflowTarget" inputmode="decimal" type="number" min="0" max="150" step="1" value="${esc(row.purchase_target_pct||70)}"></label><button type="button" class="cx-primary" id="cxCashflowSave">Save month</button></div>
  <small class="cx-sub">Current rule: preserve ${pct(row.reserve_pct)} of marketplace cash received and keep inventory purchases near ${pct(row.purchase_target_pct)} of the stronger of this month’s received cash or the trailing 3-month payout average. The safe-buy figure is capped by both rules.</small>`;
  document.getElementById('cxCashflowRefresh')?.addEventListener('click',()=>load({force:true}));
  document.getElementById('cxCashflowSave')?.addEventListener('click',save);
}
async function save(){
  const inv=Number(document.getElementById('cxCashflowInventorySpend')?.value||0),op=Number(document.getElementById('cxCashflowOperatingSpend')?.value||0),reserve=Number(document.getElementById('cxCashflowReserve')?.value||15),target=Number(document.getElementById('cxCashflowTarget')?.value||70),btn=document.getElementById('cxCashflowSave');
  if(btn)btn.disabled=true;
  try{await rest('rpc/save_seller_cashflow_month',{method:'POST',body:{p_month_start:monthKey(),p_inventory_purchase_spend:Math.max(0,inv),p_operating_expense_spend:Math.max(0,op),p_reserve_pct:Math.max(0,Math.min(100,reserve)),p_purchase_target_pct:Math.max(0,Math.min(150,target)),p_note:null}});lastLoadedAt=0;await load({force:true});document.dispatchEvent(new CustomEvent('collectish:seller-cashflow-changed',{detail:{safeBudget:Number(row?.safe_additional_buy_budget||0),inputStatus:row?.input_status||null}}))}catch(e){error=String(e?.message||e||'Save failed');render()}finally{if(btn)btn.disabled=false}
}
async function load({force=false}={}){
  if(loading)return loading;
  if(!force&&lastLoadedAt&&Date.now()-lastLoadedAt<CACHE_MS){render();return row}
  error='';loading=rest('rpc/seller_monthly_buying_budget',{method:'POST',body:{p_month_start:monthKey()}}).then(data=>{row=Array.isArray(data)?data[0]||null:data||null;lastLoadedAt=Date.now();if(row)document.dispatchEvent(new CustomEvent('collectish:seller-cashflow-changed',{detail:{safeBudget:Number(row.safe_additional_buy_budget||0),inputStatus:row.input_status||null}}));return row}).catch(e=>{row=null;error=String(e?.message||e||'Request failed');return null}).finally(()=>{loading=null;render()});render();return loading;
}
function watchSeller(){const h=host();if(!h)return;if(observer)observer.disconnect();observer=new MutationObserver(()=>{if(document.getElementById('cxSellerCashflowBudget'))return;clearTimeout(reattachTimer);reattachTimer=setTimeout(()=>render(),20)});observer.observe(h,{childList:true})}
function ensure(){if(!host())return;watchSeller();render();void load()}
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='seller')setTimeout(ensure,80)});
document.addEventListener('collectish:ready',()=>setTimeout(ensure,120));
setTimeout(ensure,200);
export {load as loadSellerCashflowBudget};
