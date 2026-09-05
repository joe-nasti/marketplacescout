import { rest } from '../../core/rest.js';

let installed=false;
let seq=0;
const esc=v=>String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const n=(v,d=1)=>Number.isFinite(Number(v))?Number(v).toFixed(d):'—';
const isCollector=row=>String(row?.category||'').toLowerCase()==='booster_box'&&String(row?.subtype||'').toLowerCase()==='collector'&&!/\bcase\b/i.test(String(row?.product_name||row?.name||''));

function stageLine(s){
  const result=String(s?.result||'BUILDING_HISTORY').replaceAll('_',' ');
  return `<div class="cx-sealed-stat"><span>${esc(String(s?.stage||'').replaceAll('_',' '))}</span><strong>${esc(result)}</strong><small>${Number(s?.samples||0)} tests · similarity ${n(s?.similarity_mae_pct)}pp vs pooled ${n(s?.pooled_mae_pct)}pp</small></div>`;
}
function horizonCard(h){
  const eligible=h?.eligible_for_primary===true,gate=String(h?.promotion_gate||'BUILDING_HISTORY').replaceAll('_',' '),stages=Array.isArray(h?.stages)?h.stages:[];
  return `<section class="cx-sealed-component-summary" data-collector-model-horizon="${Number(h?.horizon_days||0)}"><div class="cx-section-title">${Number(h?.horizon_days||0)}-day model gate · ${eligible?'ELIGIBLE':'SHADOW'}</div><div class="cx-sealed-grid"><div class="cx-sealed-stat"><span>Promotion gate</span><strong>${esc(gate)}</strong><small>${Number(h?.samples||0)} tests · ${Number(h?.products||0)} products · ${Number(h?.mature_stage_count||0)} mature stages</small></div><div class="cx-sealed-stat"><span>Median absolute error</span><strong>${n(h?.similarity_median_absolute_error_pct)}pp</strong><small>Pooled ${n(h?.pooled_median_absolute_error_pct)}pp</small></div><div class="cx-sealed-stat"><span>Direction accuracy</span><strong>${n(h?.similarity_direction_accuracy_pct)}%</strong><small>Pooled ${n(h?.pooled_direction_accuracy_pct)}%</small></div><div class="cx-sealed-stat"><span>Stage record</span><strong>${Number(h?.winning_stage_count||0)}–${Number(h?.losing_stage_count||0)}</strong><small>Similarity wins vs pooled losses among mature stages</small></div>${stages.slice(0,6).map(stageLine).join('')}</div></section>`;
}
function render(data){
  const host=document.getElementById('cxSealedDetail');if(!host)return;
  host.querySelector('[data-collector-model-health]')?.remove();
  const horizons=Array.isArray(data?.horizons)?data.horizons:[],allEligible=horizons.length>0&&horizons.every(h=>h?.eligible_for_primary===true);
  const el=document.createElement('section');el.className='cx-sealed-component-summary';el.dataset.collectorModelHealth='';
  el.innerHTML=`<div class="cx-section-title">Collector Box model health · ${allEligible?'PRIMARY-ELIGIBLE':'SHADOW'}</div><div class="cx-sealed-econ-note">Leakage-safe similarity vs pooled diagnostics. This panel is diagnostic only and does not change Scout grade, forecast authority, or executable economics.</div>${horizons.length?horizons.map(horizonCard).join(''):'<div class="cx-sealed-econ-note">Backtest history is still building; pooled forecasts remain primary.</div>'}`;
  host.appendChild(el);
}
async function onRendered(event){
  const row=event?.detail?.row||{};const current=++seq,host=document.getElementById('cxSealedDetail');host?.querySelector('[data-collector-model-health]')?.remove();if(!isCollector(row))return;
  try{const data=await rest('rpc/ask_collectish_collector_promotion_dashboard_v1',{method:'POST',body:{}});if(current!==seq)return;render(data)}catch{/* diagnostic enrichment is fail-soft */}
}
export function installCollectorModelHealth(){if(installed)return;installed=true;document.addEventListener('collectish:sealed-detail-rendered',onRendered)}
