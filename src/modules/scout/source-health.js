import {rest} from '../../core/rest.js';

const esc=value=>String(value??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
const age=value=>value==null||!Number.isFinite(Number(value))?'—':Number(value)<1?`${Math.round(Number(value)*60)}m`:`${Number(value).toFixed(1)}h`;
let request=0;

function sourceLabel(source){
  return ({tcgplayer_official_price:'TCG price',tcgplayer_market_supply:'Market supply',marketplace_sales_buckets:'Sales',vendor_depth:'Vendor depth',syp:'SYP'})[source]||String(source||'Source');
}

function render(data){
  if(!data?.available)return '';
  const overall=String(data.overall_state||'UNKNOWN');
  const sources=Array.isArray(data.sources)?data.sources:[];
  const unhealthy=sources.filter(s=>!['FRESH'].includes(String(s.state||'')));
  const exactMissing=sources.filter(s=>s.exact_sku&&s.exact_sku.available===false);
  if(overall==='HEALTHY'&&!unhealthy.length&&!exactMissing.length)return '';
  const items=[...unhealthy.map(s=>({label:sourceLabel(s.source),state:s.state,detail:s.source==='syp'?`collector ${String(s.collector_state||'unknown').toLowerCase()} · snapshot ${age(s.snapshot_age_hours)}`:`last observed ${age(s.age_hours)} ago`})),
    ...exactMissing.map(s=>({label:`${sourceLabel(s.source)} exact SKU`,state:'UNOBSERVED',detail:'No exact-SKU observation yet; this is unknown, not zero.'}))];
  const dedup=[...new Map(items.map(x=>[`${x.label}|${x.state}`,x])).values()];
  return `<section class="cx-v5-section cx-source-health" data-state="${esc(overall)}">
    <div class="cx-source-health-head"><div><div class="cx-section-title">Evidence health</div><p class="cx-sub">Collectish source freshness for this analysis. Stale or missing evidence is never treated as zero supply or demand.</p></div><span class="cx-source-health-state">${esc(overall)}</span></div>
    <div class="cx-source-health-items">${dedup.map(x=>`<div><b>${esc(x.label)}</b><span>${esc(x.state)}</span><small>${esc(x.detail)}</small></div>`).join('')}</div>
  </section>`;
}

async function decorate(event){
  const row=event.detail?.row;
  const host=document.getElementById('cxParityDetail');
  if(!host||!row?.sku_id)return;
  const seq=++request;
  host.querySelector('.cx-source-health')?.remove();
  try{
    const data=await rest('rpc/ask_collectish_evidence_source_health_v1',{method:'POST',body:{p_sku_id:String(row.sku_id)}});
    if(seq!==request||!document.getElementById('cxParityDetail'))return;
    const html=render(data);if(!html)return;
    const section=document.createRange().createContextualFragment(html).firstElementChild;
    const anchor=host.querySelector('.cx-price-confidence')||host.querySelector('.cx-scout-market-board')||host.querySelector('.cx-vendor-depth');
    if(anchor)anchor.insertAdjacentElement('afterend',section);else host.appendChild(section);
  }catch(error){console.warn('Evidence source health unavailable',error)}
}

document.addEventListener('collectish:scout-detail-rendered',decorate);

const style=document.createElement('style');
style.textContent=`
.cx-source-health-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.cx-source-health-head .cx-sub{margin:2px 0 0}.cx-source-health-state{font-size:9px;font-weight:900;letter-spacing:.04em;border:1px solid var(--cx-line);border-radius:999px;padding:4px 7px;color:var(--cx-muted)}.cx-source-health-items{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:8px}.cx-source-health-items>div{border:1px solid var(--cx-line);border-radius:9px;padding:7px;display:grid;gap:2px}.cx-source-health-items b{font-size:10px}.cx-source-health-items span{font-size:9px;font-weight:900;text-transform:uppercase}.cx-source-health-items small{font-size:9px;color:var(--cx-muted);line-height:1.35}.cx-source-health[data-state="DEGRADED"] .cx-source-health-state,.cx-source-health[data-state="PARTIAL"] .cx-source-health-state{border-style:dashed}@media(max-width:520px){.cx-source-health-items{grid-template-columns:1fr}}
`;
document.head.appendChild(style);
