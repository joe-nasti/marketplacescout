import store from '../../state/store.js';
import { rest } from '../../core/rest.js';
import { uiEvidenceMarker, directPremiumEvidence } from '../../core/ui-primitives.js';

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
function premiumPct(r){const market=Number(r?.sku_market_price||0),direct=Number(r?.direct_low||0);return market>0&&direct>0?(direct/market-1)*100:null}
function quickTurnEvidence(r){const p=directPremiumEvidence(premiumPct(r));if(p)return uiEvidenceMarker(p.kind,p.help);return uiEvidenceMarker('inferred','Quick-turn status is modeled from marketplace liquidity and a Direct asking-price exit. It does not establish Direct buyer willingness or sourceable quantity at the buy reference.')}
function label(r){return r.quick_turn_class==='priority_quick_turn'?'PRIORITY QUICK TURN':r.quick_turn_class==='quick_turn'?'QUICK TURN':'LIQUID VALUE'}
function rowHtml(r){
  const market=`Buy ref ${money(r.cheapest_buy)} · Direct ask net ${money(r.direct_net_est)} · modeled profit ${money(r.direct_net_profit)}`;
  const margin=`Modeled ROI ${pct(r.direct_roi_pct)} · target ${pct(r.target_roi_pct)} · cushion +${pct(r.margin_cushion_pct)}`;
  const liq=`Mkt ${r.liquidity_label} ${r.liquidity_score}/100 · rank ${r.sales_rank?`#${r.sales_rank}`:'—'}${r.avg_daily_qty_sold?` · ${Number(r.avg_daily_qty_sold).toFixed(1)}/day`:''}`;
  return `<button type="button" class="cx-detail-stat cx-scout-deep-link" data-quick-turn-sku="${esc(r.sku_id)}"><span><strong>${esc(r.card_name)}</strong><small>${esc(`${r.set_name||'Unknown set'} · ${r.printing||'printing unknown'}`)}</small><small>${esc(liq)} ${r.avg_daily_qty_sold?uiEvidenceMarker('verified','TCGplayer marketplace sales velocity is measured; this is not Direct-only demand.'):uiEvidenceMarker('inferred','Marketplace liquidity is inferred from sales rank because measured SKU velocity is unavailable.')}</small></span><span><strong><span class="cx-signal-stage leading">${esc(label(r))}</span>${quickTurnEvidence(r)} <span class="cx-signal-stage confirming">ADJ ${esc(r.adjusted_scout_score)}</span></strong><small>${esc(market)}</small><small>${esc(margin)}</small></span></button>`;
}
function bind(panel){
  document.getElementById('cxQuickTurnRefresh')?.addEventListener('click',()=>load({force:true}));
  panel.querySelectorAll('[data-quick-turn-sku]').forEach(el=>el.addEventListener('click',()=>{const r=rows.find(x=>String(x.sku_id)===String(el.dataset.quickTurnSku));if(r)open(r)}));
}
function render(){
  if(!ready())return;
  let panel=document.getElementById('cxQuickTurnScout');
  if(!panel){panel=document.createElement('section');panel.id='cxQuickTurnScout';panel.className='cx-card';const layout=document.querySelector('#cxScout .cx-scout-layout');if(layout)layout.insertAdjacentElement('beforebegin',panel);else host()?.appendChild(panel)}
  if(loading){panel.innerHTML='<div class="cx-section-title">Quick-turn candidates</div><div class="cx-empty">Loading…</div>';return}
  const top=rows.slice(0,6),more=rows.slice(6,12);
  const body=top.length?`<div class="cx-detail-list">${top.map(rowHtml).join('')}</div>${more.length?`<details class="cx-v5-details"><summary>Show more</summary><div class="cx-detail-list">${more.map(rowHtml).join('')}</div></details>`:''}`:'<div class="cx-empty">No current candidates clear the modeled margin hurdle.</div>';
  panel.innerHTML=`<div class="cx-page-head"><div><div class="cx-section-title">Quick-turn candidates</div></div><button type="button" class="cx-refresh" id="cxQuickTurnRefresh">Refresh</button></div>${body}`;
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
