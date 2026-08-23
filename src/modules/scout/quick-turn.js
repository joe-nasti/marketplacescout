import store from '../../state/store.js';
import { rest } from '../../core/rest.js';

let rows=[];
let loading=null;
let loadedAt=0;
const CACHE_MS=5*60*1000;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=v=>v==null?'—':`$${Number(v).toFixed(2)}`;
const pct=v=>v==null?'—':`${Number(v).toFixed(1)}%`;

function host(){return document.getElementById('cxScout')}
function ready(){return !!document.getElementById('cxParityCards')}
function open(r){document.dispatchEvent(new CustomEvent('collectish:open-scout-card',{detail:{sku_id:r.sku_id,product_id:r.product_id,card_name:r.card_name}}))}
function label(r){return r.quick_turn_class==='priority_quick_turn'?'PRIORITY QUICK TURN':r.quick_turn_class==='quick_turn'?'QUICK TURN':'LIQUID VALUE'}
function rowHtml(r){
  const market=`Buy ${money(r.cheapest_buy)} · Direct net ${money(r.direct_net_est)} · profit ${money(r.direct_net_profit)}`;
  const margin=`ROI ${pct(r.direct_roi_pct)} · target ${pct(r.target_roi_pct)} · cushion +${pct(r.margin_cushion_pct)}`;
  const liq=`${r.liquidity_label} ${r.liquidity_score}/100 · sales rank ${r.sales_rank?`#${r.sales_rank}`:'—'}${r.avg_daily_qty_sold?` · ${Number(r.avg_daily_qty_sold).toFixed(1)}/day`:''}`;
  return `<button type="button" class="cx-detail-stat cx-scout-deep-link" data-quick-turn-sku="${esc(r.sku_id)}"><span><strong>${esc(r.card_name)}</strong><small>${esc(`${r.set_name||'Unknown set'} · ${r.printing||'printing unknown'}`)}</small><small>${esc(liq)}</small></span><span><strong><span class="cx-signal-stage leading">${esc(label(r))}</span> <span class="cx-signal-stage confirming">ADJ ${esc(r.adjusted_scout_score)}</span></strong><small>${esc(market)}</small><small>${esc(margin)}</small></span></button>`;
}
function bind(panel){
  document.getElementById('cxQuickTurnRefresh')?.addEventListener('click',()=>load({force:true}));
  panel.querySelectorAll('[data-quick-turn-sku]').forEach(el=>el.addEventListener('click',()=>{const r=rows.find(x=>String(x.sku_id)===String(el.dataset.quickTurnSku));if(r)open(r)}));
}
function render(){
  if(!ready())return;
  let panel=document.getElementById('cxQuickTurnScout');
  if(!panel){panel=document.createElement('section');panel.id='cxQuickTurnScout';panel.className='cx-card';const layout=document.querySelector('#cxScout .cx-scout-layout');if(layout)layout.insertAdjacentElement('beforebegin',panel);else host()?.appendChild(panel)}
  if(loading){panel.innerHTML='<div class="cx-section-title">Quick-turn opportunities</div><p class="cx-sub">Liquid cards whose estimated Direct ROI clears their lower velocity-adjusted margin target.</p><div class="cx-empty">Loading quick-turn opportunities…</div>';return}
  const top=rows.slice(0,6),more=rows.slice(6,12);
  const body=top.length?`<div class="cx-detail-list">${top.map(rowHtml).join('')}</div>${more.length?`<details class="cx-v5-details"><summary>Show more quick-turns</summary><div class="cx-detail-list">${more.map(rowHtml).join('')}</div></details>`:''}`:'<div class="cx-empty">No liquid opportunities currently clear their target margin.</div>';
  panel.innerHTML=`<div class="cx-page-head"><div><div class="cx-section-title">Quick-turn opportunities</div><p class="cx-sub">Fast-selling cards where the estimated Direct ROI already clears the lower margin hurdle justified by liquidity. This is an execution lens, not a replacement for the base Scout thesis.</p></div><button type="button" class="cx-refresh" id="cxQuickTurnRefresh">Refresh</button></div>${body}`;
  bind(panel);
}
async function load({force=false}={}){
  if(loading)return loading;
  if(!force&&loadedAt&&Date.now()-loadedAt<CACHE_MS){render();return rows}
  loading=rest('rpc/liquid_scout_opportunities',{method:'POST',body:{p_limit:100}}).then(data=>{rows=Array.isArray(data)?data:[];loadedAt=Date.now();store.update('liquidity',{quickTurnRows:rows,loadedAt});return rows}).catch(()=>{rows=[];return rows}).finally(()=>{loading=null;render()});
  render();return loading;
}
document.addEventListener('collectish:scout-list-rendered',()=>{if(ready())void load()});
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='scout')setTimeout(()=>{render();void load()},80)});
document.addEventListener('collectish:ready',()=>{if(ready())void load()});
export {load as loadQuickTurnScout};
