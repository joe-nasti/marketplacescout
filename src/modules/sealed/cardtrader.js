import { rest } from '../../core/rest.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
const pct=n=>n==null||!Number.isFinite(Number(n))?'—':`${Number(n).toFixed(1)}%`;
const age=d=>{if(!d)return'—';const ms=Math.max(0,Date.now()-new Date(d).getTime()),m=Math.round(ms/6e4);if(m<60)return m<=1?'just now':`${m}m ago`;const h=Math.round(m/60);return h<24?`${h}h ago`:`${Math.round(h/24)}d ago`};
const stat=(label,value,sub='')=>`<div class="cx-sealed-stat"><span>${esc(label)}</span><strong>${value}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`;
let seq=0;

function signedPct(v){return v==null||!Number.isFinite(Number(v))?'—':`${Number(v)>=0?'+':''}${Number(v).toFixed(1)}%`}
function trendLabel(signal){return({strong_tightening:'Strong tightening',tightening_strong:'Strong tightening',tightening:'Tightening',loosening:'Loosening',stable:'Stable',building_history:'Building history'})[signal]||'Building history'}
function mappingConfidence(raw){const method=String(raw.match_method||'').toLowerCase();if(method==='dual_exact')return'Exact · dual ID';if(method.includes('exact'))return'Exact';return method?method.replaceAll('_',' '):'Unverified'}

async function renderCardTrader(event){
  const id=event?.detail?.id;if(!id)return;const current=++seq;
  const rows=await rest(`sealed_product_price_current?select=product_id,low_price,total_listings,captured_at,raw_json&source=eq.cardtrader&sealed_uuid=eq.${encodeURIComponent(id)}&limit=1`).catch(()=>[]);
  if(current!==seq)return;
  const host=document.getElementById('cxSealedDetail');if(!host)return;
  host.querySelector('[data-cardtrader-acquire]')?.remove();
  const row=(rows||[])[0];if(!row)return;
  const raw=row.raw_json||{},ct=raw.ct||{},zero=raw.ct_zero||{},model=raw.landed_model||{},trend=raw.ct_zero_trend||{},primary=trend.primary||{},sourcing=raw.ct_zero_sourcing||{},currency=raw.currency||'USD';
  const currencyOk=currency==='USD',landed=zero.landed_6_avg??zero.landed_3_avg??zero.landed_1_avg??null,beforeShipping=zero.landed_before_shipping_6_avg??zero.landed_before_shipping_3_avg??zero.landed_before_shipping_1_avg??null;
  const baseline=trend.primary_window?`${trend.primary_window} baseline${primary.age_hours?` · ${Number(primary.age_hours).toFixed(1)}h old`:''}`:'waiting for ≥4h history';
  const trendSub=trend.signal==='building_history'||!trend.signal?baseline:`Zero qty ${signedPct(primary.quantity_pct)} · CT0 cost ${signedPct(primary.landed6_pct)} · ${baseline}`;
  const basketSub=model.complete===true?`basket allocation ${money(model.basket_shipping_allocation_usd)} / unit`:'needs consolidated basket shipping profile';
  const sourcingLabel=sourcing.candidate?'WATCH IMPORT':'PASS';
  const sourcingSub=sourcing.candidate?`${signedPct(sourcing.comparison_spread_pct)} vs ${String(sourcing.comparison_reference_type||'public comparison').replaceAll('_',' ')} · not yet executable`:esc(sourcing.reason||'No actionable import route modeled');
  const block=document.createElement('div');block.dataset.cardtraderAcquire='';
  block.innerHTML=`<div class="cx-section-title">Sourcing · CardTrader</div><div class="cx-sealed-grid">${stat('CT direct low',currencyOk?money(ct.low):'—',`${Number(ct.quantity||0).toLocaleString()} units · ${Number(ct.offers||0)} offers`)}${stat('CT Zero raw',currencyOk?money(zero.low):'—',`${Number(zero.quantity||0).toLocaleString()} Zero units`)}${stat('CT0 ×6 basket',currencyOk?money(zero.cost_6_avg):'—',zero.cost_6_avg==null?'fewer than 6 units available':'weighted raw acquisition')}${stat('Before final ship',currencyOk?money(beforeShipping):'—','raw + Safeguard/funding')}${stat('Landed acquisition',currencyOk&&model.complete===true?money(landed):'—',basketSub)}${stat('Sourcing status',sourcingLabel,sourcingSub)}${stat('CT0 supply trend',trendLabel(trend.signal),trendSub)}${stat('Identity',mappingConfidence(raw),`CT synced ${age(row.captured_at)}`)}</div><div class="cx-sealed-summary"><strong>CardTrader is sourcing evidence, not an exit reference.</strong> ${model.complete===true?`CT0 landed cost uses a ${money(model.basket_shipping_allocation_usd)} marginal shipping allocation from the configured consolidated basket.`:'The old fixed $10/unit shipping assumption is no longer treated as landed cost. Configure a consolidated basket profile before CT0 can become actionable.'} ${sourcing.candidate?'This clears the market-basis screen, but remains <strong>WATCH IMPORT</strong> until Collectish can pair it with an executable exit, lead time, and mapping confidence.':'No import recommendation is currently supported.'}${trend.reason?` <strong>Trend:</strong> ${esc(trend.reason)}.`:''}</div>`;
  const anchor=host.querySelector('.cx-sealed-econ-title');if(anchor)anchor.before(block);else host.appendChild(block);
}

document.addEventListener('collectish:sealed-detail-rendered',event=>{renderCardTrader(event).catch(()=>{})});
