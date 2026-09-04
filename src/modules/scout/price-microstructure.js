import {rest} from '../../core/rest.js';

const esc=value=>String(value??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
const money=value=>value==null||value===''||!Number.isFinite(Number(value))?'—':Number(value).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
const num=value=>value==null||value===''||!Number.isFinite(Number(value))?'—':Number(value).toLocaleString(undefined,{maximumFractionDigits:1});
const pct=value=>value==null||value===''||!Number.isFinite(Number(value))?'—':`${Number(value).toFixed(1)}%`;
const stamp=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—'};
let request=0;

function flagLabel(value){return String(value||'').replace(/_/g,' ').toLowerCase().replace(/^./,c=>c.toUpperCase())}
function historyLine(history,current){
  if(history===undefined)return '<small class="cx-price-confidence-history" data-confidence-history>Loading confidence history…</small>';
  const events=Array.isArray(history?.events)?history.events:[];
  if(!events.length)return '<small class="cx-price-confidence-history" data-confidence-history>Confidence history starts with the next material actionable-state observation.</small>';
  const latest=events[0],prior=events.find(e=>e.microstructure!==latest.microstructure||e.confidence_label!==latest.confidence_label||Number(e.confidence_score)!==Number(latest.confidence_score));
  const since=events[events.length-1]?.evaluated_at;
  const bits=[`${events.length} recorded state${events.length===1?'':'s'}`,since?`since ${stamp(since)}`:null];
  if(prior)bits.push(`previously ${prior.confidence_score} ${prior.confidence_label} · ${prior.microstructure}`);
  else if(latest&&current&&Number(latest.confidence_score)!==Number(current.confidence_score))bits.push(`last captured ${latest.confidence_score} ${latest.confidence_label} · ${latest.microstructure}`);
  return `<small class="cx-price-confidence-history" data-confidence-history>${esc(bits.filter(Boolean).join(' · '))}</small>`;
}

function render(data,history){
  if(!data?.available)return '';
  const p=data.price||{},d=data.depth||{},s=data.sales||{},st=data.stability||{},c=data.components||{};
  const flags=Array.isArray(data.fragility_flags)?data.fragility_flags:[];
  const salesText=s.bucket_fresh?`${num(s.copies_7d)} sold / ${num(s.transactions_7d)} txns (7d)`:`${num(s.avg_daily_qty_sold)}/day Scout velocity · sales bucket stale`;
  return `<section class="cx-v5-section cx-price-confidence">
    <div class="cx-price-confidence-head">
      <div><div class="cx-section-title">Price confidence</div><p class="cx-sub">How well this exact SKU's observed price is supported by fresh, executable market evidence.</p></div>
      <div class="cx-price-confidence-score"><strong>${esc(data.confidence_score??'—')}</strong><span>${esc(data.confidence_label||'—')} · ${esc(data.microstructure||'—')}</span></div>
    </div>
    <div class="cx-price-confidence-grid">
      <div><b>Agreement</b><span>Market ${money(p.market)} · Direct ${money(p.direct_low)}</span><small>Direct gap ${pct(p.direct_market_gap_pct)} · floor gap ${pct(p.floor_gap_pct)}</small></div>
      <div><b>Depth</b><span>${num(d.market_units)} units · ${num(d.market_sellers)} sellers</span><small>${num(d.direct_units)} Direct · ${d.estimated_days_of_supply==null?'days supply unknown':`${num(d.estimated_days_of_supply)} est. days supply`}</small></div>
      <div><b>Sales support</b><span>${esc(salesText)}</span><small>${s.bucket_fresh?'Fresh exact-SKU sales bucket':`Last bucket ${esc(s.latest_bucket_date||'unavailable')}`}</small></div>
      <div><b>Stability</b><span>${num(st.observations_24h)} observations / 24h</span><small>24h Market range ${pct(st.market_range_24h_pct)}</small></div>
    </div>
    <div class="cx-price-confidence-components">${[['Freshness',c.freshness],['Agreement',c.agreement],['Depth',c.depth],['Sales',c.sales_support],['Stability',c.stability]].map(([k,v])=>`<span>${esc(k)} ${esc(v??0)}</span>`).join('')}</div>
    ${flags.length?`<div class="cx-price-confidence-flags">${flags.map(f=>`<span>${esc(flagLabel(f))}</span>`).join('')}</div>`:'<div class="cx-price-confidence-clean">No material microstructure fragility flags.</div>'}
    ${historyLine(history,data)}
    <small class="cx-price-confidence-note">Evidence-quality/executability confidence only. It is not a forecast of price direction. Historical states never use evidence observed later.</small>
  </section>`;
}

async function enrichHistory(section,row,data,seq){
  try{
    const history=await rest('rpc/ask_collectish_price_confidence_history_v1',{method:'POST',body:{p_sku_id:String(row.sku_id),p_days:30}});
    if(seq!==request||!section?.isConnected)return;
    const fresh=document.createRange().createContextualFragment(historyLine(history,data)).firstElementChild;
    section.querySelector('[data-confidence-history]')?.replaceWith(fresh);
  }catch(error){
    if(seq!==request||!section?.isConnected)return;
    const line=section.querySelector('[data-confidence-history]');
    if(line)line.textContent='Confidence history unavailable; current evidence is unaffected.';
    console.warn('Price confidence history unavailable',error);
  }
}

async function decorate(event){
  const row=event.detail?.row;
  const host=document.getElementById('cxParityDetail');
  if(!host||!row?.sku_id)return;
  const seq=++request;
  host.querySelector('.cx-price-confidence')?.remove();
  try{
    const data=await rest('rpc/ask_collectish_price_microstructure_v1',{method:'POST',body:{p_sku_id:String(row.sku_id)}});
    if(seq!==request||!document.getElementById('cxParityDetail'))return;
    const html=render(data,undefined);if(!html)return;
    const section=document.createRange().createContextualFragment(html).firstElementChild;
    const anchor=host.querySelector('.cx-scout-market-board')||host.querySelector('.cx-vendor-depth')||host.querySelector('.cx-scout-why-buy');
    if(anchor)anchor.insertAdjacentElement('afterend',section);else host.appendChild(section);
    void enrichHistory(section,row,data,seq);
  }catch(error){console.warn('Price confidence unavailable',error)}
}

document.addEventListener('collectish:scout-detail-rendered',decorate);

const style=document.createElement('style');
style.textContent=`
.cx-price-confidence-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.cx-price-confidence-head .cx-sub{margin:2px 0 0}.cx-price-confidence-score{display:grid;text-align:right;flex:0 0 auto}.cx-price-confidence-score strong{font-size:24px;line-height:1}.cx-price-confidence-score span{font-size:9px;font-weight:800;color:var(--cx-muted);text-transform:uppercase;margin-top:2px}.cx-price-confidence-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:9px}.cx-price-confidence-grid>div{border:1px solid var(--cx-line);border-radius:9px;padding:7px;display:grid;gap:2px}.cx-price-confidence-grid b{font-size:9px;text-transform:uppercase;color:var(--cx-muted);letter-spacing:.03em}.cx-price-confidence-grid span{font-size:11px;font-weight:700}.cx-price-confidence-grid small{font-size:9px;color:var(--cx-muted)}.cx-price-confidence-components,.cx-price-confidence-flags{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}.cx-price-confidence-components span,.cx-price-confidence-flags span{font-size:9px;border:1px solid var(--cx-line);border-radius:999px;padding:3px 6px;color:var(--cx-muted)}.cx-price-confidence-flags span{border-style:dashed}.cx-price-confidence-clean,.cx-price-confidence-history,.cx-price-confidence-note{display:block;font-size:9px;color:var(--cx-muted);margin-top:7px}.cx-price-confidence-history{font-weight:700}.cx-price-confidence-note{padding-top:6px;border-top:1px solid var(--cx-line)}@media(max-width:520px){.cx-price-confidence-grid{grid-template-columns:1fr}.cx-price-confidence-head{align-items:flex-start}.cx-price-confidence-score strong{font-size:21px}}
`;
document.head.appendChild(style);
