import { rest } from '../../core/rest.js';

let rows=[];
let loading=null;
let lastLoadedAt=0;
const CACHE_MS=2*60*1000;
const KEY='collectishPortfolioBudget';
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=v=>v==null?'—':Number(v).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
const pct=v=>v==null?'—':`${Number(v).toFixed(1)}%`;
function budget(){const n=Number(localStorage.getItem(KEY)||1000);return Number.isFinite(n)?Math.max(100,Math.min(100000,n)):1000}
function host(){return document.getElementById('cxScout')}
function ready(){return !!document.getElementById('cxParityCards')}
function openRow(r){document.dispatchEvent(new CustomEvent('collectish:open-scout-card',{detail:{sku_id:r.sku_id,product_id:r.product_id,card_name:r.card_name}}))}
function rowHtml(r){
  const signal=r.action_class==='action_now'?'ACTION NOW':r.action_class==='emerging_quick_turn'?'EMERGING':r.liquidity_label||'LIQUID';
  return `<button type="button" class="cx-detail-stat cx-scout-deep-link" data-portfolio-sku="${esc(r.sku_id)}"><span><strong>#${esc(r.allocation_rank)} · ${esc(r.card_name)}</strong><small>${esc(`${r.set_name||'Unknown set'} · ${r.printing||'printing unknown'}`)}</small><small>${esc(`${signal}${r.primary_signal?` · ${r.primary_signal}`:''} · ~${Number(r.expected_days_to_exit||0).toFixed(0)}d modeled exit`)}</small></span><span><strong><span class="cx-signal-stage leading">BUY ${esc(r.allocated_qty)}</span> <span class="cx-signal-stage confirming">${money(r.allocated_capital)}</span></strong><small>${esc(`ROI ${pct(r.direct_roi_pct)} · cushion +${pct(r.margin_cushion_pct)} · allocation ${r.allocation_score}/100`)}</small><small>${esc(`Est. Direct profit ${money(r.expected_net_profit)} · SKU cap ${money(r.per_sku_cap)}`)}</small></span></button>`;
}
function bind(panel){
  panel.querySelectorAll('[data-portfolio-sku]').forEach(el=>el.addEventListener('click',()=>{const r=rows.find(x=>String(x.sku_id)===String(el.dataset.portfolioSku));if(r)openRow(r)}));
  panel.querySelectorAll('[data-portfolio-budget]').forEach(b=>b.addEventListener('click',()=>{const n=Number(b.dataset.portfolioBudget);localStorage.setItem(KEY,String(n));void load({force:true})}));
  const input=panel.querySelector('#cxPortfolioBudget');
  panel.querySelector('#cxPortfolioApply')?.addEventListener('click',()=>{const n=Number(input?.value);if(Number.isFinite(n)){localStorage.setItem(KEY,String(Math.max(100,Math.min(100000,n))));void load({force:true})}});
  input?.addEventListener('keydown',e=>{if(e.key==='Enter')panel.querySelector('#cxPortfolioApply')?.click()});
  panel.querySelector('#cxPortfolioRefresh')?.addEventListener('click',()=>load({force:true}));
}
function render(){
  if(!ready())return;
  let panel=document.getElementById('cxPortfolioAllocation');
  if(!panel){panel=document.createElement('section');panel.id='cxPortfolioAllocation';panel.className='cx-card';const quick=document.getElementById('cxQuickTurnScout'),layout=document.querySelector('#cxScout .cx-scout-layout');if(quick)quick.insertAdjacentElement('beforebegin',panel);else if(layout)layout.insertAdjacentElement('beforebegin',panel);else host()?.appendChild(panel)}
  const b=budget();
  if(loading){panel.innerHTML=`<div class="cx-section-title">Capital allocation</div><p class="cx-sub">Allocating ${money(b)} across the strongest position-sized opportunities…</p><div class="cx-empty">Loading portfolio allocation…</div>`;return}
  const spent=rows.reduce((a,r)=>a+Number(r.allocated_capital||0),0),profit=rows.reduce((a,r)=>a+Number(r.expected_net_profit||0),0),remaining=Math.max(0,b-spent);
  const immediate=rows.slice(0,6),more=rows.slice(6,14);
  const body=immediate.length?`<div class="cx-detail-list">${immediate.map(rowHtml).join('')}</div>${more.length?`<details class="cx-v5-details"><summary>Show more allocated positions</summary><div class="cx-detail-list">${more.map(rowHtml).join('')}</div></details>`:''}`:'<div class="cx-empty">No current positions qualify for allocation at this budget.</div>';
  panel.innerHTML=`<div class="cx-page-head"><div><div class="cx-section-title">Capital allocation</div><p class="cx-sub">Deployable-budget view across position-sized Scout opportunities. Concentration caps may intentionally leave cash undeployed.</p></div><button type="button" class="cx-refresh" id="cxPortfolioRefresh">Refresh</button></div><div class="cx-scout-toolbar"><input id="cxPortfolioBudget" inputmode="decimal" type="number" min="100" max="100000" step="100" value="${esc(b)}" aria-label="Deployable budget"><button type="button" class="cx-refresh" id="cxPortfolioApply">Allocate</button>${[1000,2500,5000,10000].map(x=>`<button type="button" class="cx-refresh" data-portfolio-budget="${x}">${money(x)}</button>`).join('')}</div><div class="cx-v5-grid"><div class="cx-v5-stat"><span>Budget</span><strong>${money(b)}</strong></div><div class="cx-v5-stat"><span>Deployed</span><strong>${money(spent)}</strong><small>${rows.length} position${rows.length===1?'':'s'}</small></div><div class="cx-v5-stat"><span>Cash left</span><strong>${money(remaining)}</strong><small>left undeployed if caps are reached</small></div><div class="cx-v5-stat"><span>Est. Direct profit</span><strong>${money(profit)}</strong><small>sum of current per-copy Direct estimates</small></div></div>${body}`;
  bind(panel);
}
async function load({force=false}={}){
  if(loading)return loading;
  if(!force&&lastLoadedAt&&Date.now()-lastLoadedAt<CACHE_MS){render();return rows}
  const b=budget();
  loading=rest('rpc/scout_portfolio_allocation',{method:'POST',body:{p_budget:b,p_limit:40}}).then(data=>{rows=Array.isArray(data)?data:[];lastLoadedAt=Date.now();return rows}).catch(()=>{rows=[];return rows}).finally(()=>{loading=null;render()});
  render();return loading;
}
function ensure(){if(!ready())return;render();void load()}
document.addEventListener('collectish:scout-list-rendered',()=>setTimeout(ensure,0));
document.addEventListener('collectish:position-sizing-changed',()=>{lastLoadedAt=0;setTimeout(()=>load({force:true}),40)});
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='scout')setTimeout(ensure,100)});
document.addEventListener('collectish:ready',()=>setTimeout(ensure,120));
export {load as loadPortfolioAllocation};
