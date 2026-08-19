import { rest } from '../../core/rest.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
const pct=n=>n==null||!Number.isFinite(Number(n))?'—':`${Number(n).toFixed(1)}%`;
const age=d=>{if(!d)return'—';const ms=Math.max(0,Date.now()-new Date(d).getTime()),m=Math.round(ms/6e4);if(m<60)return m<=1?'just now':`${m}m ago`;const h=Math.round(m/60);return h<24?`${h}h ago`:`${Math.round(h/24)}d ago`};
const stat=(label,value,sub='')=>`<div class="cx-sealed-stat"><span>${esc(label)}</span><strong>${value}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`;
let seq=0;

function spreadPct(reference,buy){const r=Number(reference),b=Number(buy);return Number.isFinite(r)&&Number.isFinite(b)&&r>0&&b>0?(r/b-1)*100:null}
function signedPct(v){return v==null||!Number.isFinite(Number(v))?'—':`${Number(v)>=0?'+':''}${Number(v).toFixed(1)}%`}
function trendLabel(signal){return({strong_tightening:'Strong tightening',tightening_strong:'Strong tightening',tightening:'Tightening',loosening:'Loosening',stable:'Stable',building_history:'Building history'})[signal]||'Building history'}

async function renderCardTrader(event){
  const id=event?.detail?.id;if(!id)return;const current=++seq;
  const rows=await rest(`sealed_product_price_current?select=product_id,low_price,total_listings,captured_at,raw_json&source=eq.cardtrader&sealed_uuid=eq.${encodeURIComponent(id)}&limit=1`).catch(()=>[]);
  if(current!==seq)return;
  const host=document.getElementById('cxSealedDetail');if(!host)return;
  host.querySelector('[data-cardtrader-acquire]')?.remove();
  const row=(rows||[])[0];if(!row)return;
  const raw=row.raw_json||{},ct=raw.ct||{},zero=raw.ct_zero||{},model=raw.landed_model||{},trend=raw.ct_zero_trend||{},primary=trend.primary||{},shadow=raw.ct_zero_shadow_score||{},currency=raw.currency||'USD';
  const tcgMarket=event?.detail?.data?.price?.market_price,tcgLow=event?.detail?.data?.price?.low_with_shipping??event?.detail?.data?.price?.low_price;
  const landed=zero.landed_6_avg??zero.landed_3_avg??zero.landed_1_avg??null;
  const spreadMarket=spreadPct(tcgMarket,landed),spreadLow=spreadPct(tcgLow,landed);
  const identity=raw.match_method?String(raw.match_method).replaceAll('_',' '):'exact map';
  const currencyOk=currency==='USD',shipping=Number(model.shipping_reserve_per_unit_usd||0),funding=Number(model.funding_fee_pct||0);
  const baseline=trend.primary_window?`${trend.primary_window} baseline${primary.age_hours?` · ${Number(primary.age_hours).toFixed(1)}h old`:''}`:'waiting for ≥4h history';
  const trendSub=trend.signal==='building_history'||!trend.signal?baseline:`Zero qty ${signedPct(primary.quantity_pct)} · landed ×6 ${signedPct(primary.landed6_pct)} · ${baseline}`;
  const shadowValue=shadow.shadow_score==null?'—':`${shadow.official_grade||'—'} → ${shadow.shadow_grade||'—'}`;
  const shadowSub=shadow.shadow_score==null?'not available':`${Number(shadow.official_score).toFixed(1)} ${Number(shadow.shadow_delta)>=0?'+':''}${Number(shadow.shadow_delta).toFixed(1)} = ${Number(shadow.shadow_score).toFixed(1)} · ${shadow.confidence==='trend_informed'?'trend-informed':'provisional'} · official unchanged`;
  const block=document.createElement('div');block.dataset.cardtraderAcquire='';
  block.innerHTML=`<div class="cx-section-title">CardTrader acquisition</div><div class="cx-sealed-grid">${stat('CT Low',currencyOk?money(ct.low):'—',`${Number(ct.quantity||0).toLocaleString()} units · ${Number(ct.offers||0)} offers`)}${stat('CT Zero Low',currencyOk?money(zero.low):'—',`${Number(zero.quantity||0).toLocaleString()} Zero units`)}${stat('CT0 ×6 raw',currencyOk?money(zero.cost_6_avg):'—',zero.cost_6_avg==null?'fewer than 6 units available':'weighted acquisition')}${stat('CT0 ×6 landed',currencyOk?money(zero.landed_6_avg):'—',zero.landed_6_avg==null?'not modeled at six units':`includes safeguard + $${shipping.toFixed(0)}/unit ship reserve`)}${stat('Landed vs TCG',currencyOk&&landed!=null&&spreadMarket!=null?`${spreadMarket>=0?'+':''}${pct(spreadMarket)}`:'—',spreadLow!=null?`vs TCG low ${spreadLow>=0?'+':''}${pct(spreadLow)}`:'estimated acquisition spread')}${stat('CT0 supply trend',trendLabel(trend.signal),trendSub)}${stat('Scout CT0 shadow',shadowValue,shadowSub)}</div><div class="cx-sealed-summary"><strong>CT0 landed model:</strong> ${currencyOk?`Includes CardTrader buyer Safeguard fee and a $${shipping.toFixed(2)} per-unit final-shipping reserve; ${funding?`${funding.toFixed(1)}% funding fee included`:'assumes wallet/wire funding with no recharge fee'}. Actual hub shipping depends on the consolidated parcel.`:'Currency mismatch; price comparison suppressed.'}${trend.reason?` <strong>Trend:</strong> ${esc(trend.reason)}.`:''}${shadow.shadow_delta>0?` <strong>Shadow:</strong> CT0 would add ${Number(shadow.shadow_delta).toFixed(1)} points, but the production Scout score is unchanged.`:''} <span class="cx-sub">Mapped ${esc(identity)} · CT synced ${esc(age(row.captured_at))}.</span></div>`;
  const anchor=host.querySelector('.cx-sealed-econ-title');if(anchor)anchor.before(block);else host.appendChild(block);
}

document.addEventListener('collectish:sealed-detail-rendered',event=>{renderCardTrader(event).catch(()=>{})});
