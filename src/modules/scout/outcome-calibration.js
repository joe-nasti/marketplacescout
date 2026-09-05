import {rest} from '../../core/rest.js';

const esc=value=>String(value??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
const pct=value=>value==null||value===''||!Number.isFinite(Number(value))?'—':`${Number(value)>0?'+':''}${Number(value).toFixed(1)}%`;
const dt=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—'};
let request=0;
const MIN_RATE_SAMPLE=5;

function metric(label,value,detail=''){
  return `<div class="cx-outcome-metric"><span>${esc(label)}</span><b>${esc(value)}</b>${detail?`<small>${esc(detail)}</small>`:''}</div>`;
}

function episodeRow(ep){
  const h=ep?.outcomes?.['24h']||{};
  const matured=!!h.matured;
  const observed=!!h.observed;
  const market=observed?pct(h.market_change_pct):matured?'No exact observation':'Accumulating';
  const spread=observed&&h.positive_direct_net_spread_survives!=null?(h.positive_direct_net_spread_survives?'Spread survived':'Spread closed'):matured?'Unknown':'Accumulating';
  const spreadRoi=observed&&h.spread_roi_pct!=null?` · ${pct(h.spread_roi_pct)} modeled spread`:'';
  const supply=h.supply_state?String(h.supply_state).replace(/_/g,' ').toLowerCase():'';
  const status=ep?.status==='CLOSED'?(ep.close_reason?String(ep.close_reason).replace(/_/g,' ').toLowerCase():'closed'):'open';
  return `<div class="cx-outcome-row">
    <div><b>${esc(dt(ep.opened_at))}</b><span>${esc(`${ep?.entry?.grade||'—'} ${ep?.entry?.score??'—'} · ${status}`)}</span></div>
    <div><b>24h Market ${esc(market)}</b><span>${esc(`${spread}${spreadRoi}${supply?` · supply ${supply}`:''}`)}</span></div>
  </div>`;
}

function render(data){
  const summary=data?.summary||{};
  const episodes=Array.isArray(data?.episodes)?data.episodes:[];
  const total=Number(summary.episodes)||0;
  if(!total)return '';
  const observed=Number(summary.observed_24h)||0;
  const matured=Number(summary.matured_24h)||0;
  const spreadWins=Number(summary.spread_survives_24h)||0;
  const marketWins=Number(summary.market_up_5pct_24h)||0;
  const enoughForRates=observed>=MIN_RATE_SAMPLE;
  const readiness=String(data?.readiness||'INSUFFICIENT_SAMPLE').replace(/_/g,' ');
  const recent=episodes.slice(0,4).map(episodeRow).join('');
  return `<section class="cx-v5-section cx-outcome-calibration">
    <div class="cx-section-title">Outcome calibration</div>
    <p class="cx-sub">What happened after prior true Scout opportunity openings for this exact SKU.</p>
    <div class="cx-outcome-badge">${esc(readiness)}</div>
    <div class="cx-outcome-metrics">
      ${metric('Episodes',String(total),`${Number(summary.open)||0} open · ${Number(summary.closed)||0} closed`)}
      ${metric('Observed +24h',`${observed}/${matured}`,matured>observed?`${matured-observed} matured without an exact price observation`:'Exact-SKU official price window')}
      ${metric('Spread survived +24h',enoughForRates?`${Number(summary.spread_survival_rate_24h_pct).toFixed(1)}%`:`${spreadWins}/${observed}`,enoughForRates?`${spreadWins}/${observed} observed episodes`:`Rate hidden until ${MIN_RATE_SAMPLE} observed episodes`)}
      ${metric('Market +5% by +24h',enoughForRates?`${Number(summary.market_up_5pct_rate_24h_pct).toFixed(1)}%`:`${marketWins}/${observed}`,enoughForRates?`${marketWins}/${observed} observed episodes`:`Rate hidden until ${MIN_RATE_SAMPLE} observed episodes`)}
    </div>
    ${recent?`<div class="cx-outcome-recent"><div class="cx-outcome-label">Recent comparable episodes</div>${recent}</div>`:''}
    <small class="cx-outcome-note">Exact-SKU percentage rates stay hidden until at least ${MIN_RATE_SAMPLE} observed 24h episodes. Spread survival is descriptive, not realized ROI: it applies the entry-time Direct-net/Direct-price ratio to the later Direct observation and asks whether that modeled net still exceeded the original entry buy price. Missing future observations are unknown, never zero.</small>
  </section>`;
}

async function decorate(event){
  const row=event.detail?.row;
  const host=document.getElementById('cxParityDetail');
  if(!host||!row?.sku_id)return;
  const seq=++request;
  host.querySelector('.cx-outcome-calibration')?.remove();
  try{
    const data=await rest('rpc/ask_collectish_scout_outcome_ledger_v1',{method:'POST',body:{p_sku_id:String(row.sku_id),p_days:365,p_limit:8}});
    if(seq!==request||!document.getElementById('cxParityDetail'))return;
    const html=render(data);if(!html)return;
    const section=document.createRange().createContextualFragment(html).firstElementChild;
    const anchor=host.querySelector('.cx-episode-supply')||host.querySelector('.cx-scout-time-machine')||host.querySelector('.cx-market-timeline');
    if(anchor)anchor.insertAdjacentElement('afterend',section);else host.appendChild(section);
  }catch(error){console.warn('Scout outcome calibration unavailable',error)}
}

document.addEventListener('collectish:scout-detail-rendered',decorate);

const style=document.createElement('style');
style.textContent=`
.cx-outcome-calibration{position:relative}.cx-outcome-calibration .cx-sub{margin:2px 0 0}.cx-outcome-badge{display:inline-flex;margin-top:7px;border:1px solid var(--cx-line);border-radius:999px;padding:3px 7px;font-size:9px;font-weight:800;color:var(--cx-muted);text-transform:uppercase;letter-spacing:.03em}.cx-outcome-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:8px}.cx-outcome-metric{border:1px solid var(--cx-line);border-radius:9px;padding:7px 8px;display:grid;gap:2px;min-width:0}.cx-outcome-metric>span{font-size:9px;color:var(--cx-muted);text-transform:uppercase;letter-spacing:.03em}.cx-outcome-metric>b{font-size:13px}.cx-outcome-metric>small{font-size:9px;line-height:1.25;color:var(--cx-muted)}.cx-outcome-recent{margin-top:9px;border-top:1px solid var(--cx-line);padding-top:7px}.cx-outcome-label{font-size:9px;font-weight:800;color:var(--cx-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px}.cx-outcome-row{display:grid;grid-template-columns:minmax(125px,.8fr) minmax(0,1.4fr);gap:8px;padding:6px 0;border-bottom:1px solid var(--cx-line)}.cx-outcome-row:last-child{border-bottom:0}.cx-outcome-row>div{display:grid;gap:1px;min-width:0}.cx-outcome-row b{font-size:10px}.cx-outcome-row span{font-size:9px;color:var(--cx-muted);line-height:1.3}.cx-outcome-note{display:block;margin-top:7px;color:var(--cx-muted);font-size:9px;line-height:1.35}@media(max-width:700px){.cx-outcome-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:440px){.cx-outcome-row{grid-template-columns:1fr}}
`;
document.head.appendChild(style);
