import {rest} from '../../core/rest.js';

const esc=value=>String(value??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
const num=value=>value==null||value===''||!Number.isFinite(Number(value))?'—':Number(value).toLocaleString();
const money=value=>value==null||value===''||!Number.isFinite(Number(value))?'—':Number(value).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
const pct=value=>value==null||value===''||!Number.isFinite(Number(value))?'—':`${Number(value)>0?'+':''}${Number(value).toFixed(1)}%`;
const dt=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—'};
let request=0;

function horizon(label,data,kind='supply'){
  if(!data?.observed_at)return `<div class="cx-episode-horizon"><b>${esc(label)}</b><span>Accumulating</span></div>`;
  const value=kind==='price'?`${money(data.market_price)} · ${pct(data.market_change_pct)}`:`${num(data.units)} units · ${pct(data.change_pct)}`;
  return `<div class="cx-episode-horizon"><b>${esc(label)}</b><span>${esc(value)}</span></div>`;
}

function render(data){
  const episodes=Array.isArray(data?.episodes)?[...data.episodes]:[];
  episodes.sort((a,b)=>Date.parse(b?.opened_at||0)-Date.parse(a?.opened_at||0));
  const ep=episodes[0];
  if(!ep)return '';
  const baseline=ep?.supply?.baseline||{};
  const offset=Number(baseline.offset_hours);
  const hasBaseline=!!baseline.observed_at;
  const nearEntry=hasBaseline&&Number.isFinite(offset)&&Math.abs(offset)<=2;
  const beforeEntry=hasBaseline&&offset<=0;
  const timing=beforeEntry?'Known by episode open':nearEntry?`Observed ${offset.toFixed(1)}h after open`:`Observed ${Number.isFinite(offset)?`${offset.toFixed(1)}h`:''} after open`;
  const warning=hasBaseline&&!beforeEntry?nearEntry?'Near-entry forward baseline; it was collected after Scout opened the episode.':'Late forward baseline only; do not treat this supply as evidence Scout knew at entry.':'';
  const supply=ep.supply||{},price=ep.price_response||{},velocity=ep.velocity_response||{};
  const opened=`Opened ${dt(ep.opened_at)} · ${ep?.entry?.grade||'—'} ${ep?.entry?.score??'—'} · ${String(ep?.entry?.flag||'—').replace(/_/g,' ')}`;
  return `<section class="cx-v5-section cx-episode-supply">
    <div class="cx-section-title">Scout episode outcome</div>
    <p class="cx-sub">Forward market response from this exact SKU, aligned to when Scout opened the opportunity.</p>
    <div class="cx-episode-meta">${esc(opened)}</div>
    ${hasBaseline?`<div class="cx-episode-baseline"><div><b>${num(baseline.units)} market units</b><span>${num(baseline.direct_units)} Direct · ${num(baseline.listings)} listings</span></div><em class="${beforeEntry?'known':nearEntry?'near':'late'}">${esc(timing)}</em></div>`:`<div class="cx-episode-empty">No market-wide supply baseline is attached to this episode yet. New episode openings are now queued for near-entry observation.</div>`}
    ${warning?`<small class="cx-episode-warning">${esc(warning)}</small>`:''}
    <div class="cx-episode-grid">
      ${horizon('Supply +24h',supply['24h'])}
      ${horizon('Supply +72h',supply['72h'])}
      ${horizon('Supply +7d',supply['7d'])}
      ${horizon('Market +24h',price['24h'],'price')}
      ${horizon('Market +72h',price['72h'],'price')}
      ${horizon('Market +7d',price['7d'],'price')}
    </div>
    <div class="cx-episode-foot"><span>Pre-7d sales: ${num(velocity.sales_pre7d)}</span><span>72h velocity: ${velocity.velocity_ratio_72h==null?'Accumulating':`${Number(velocity.velocity_ratio_72h).toFixed(2)}× baseline`}</span><span>${esc(data?.readiness==='INSUFFICIENT_SAMPLE'?'Calibration accumulating':String(data?.readiness||'').replace(/_/g,' '))}</span></div>
  </section>`;
}

async function decorate(event){
  const row=event.detail?.row;
  const host=document.getElementById('cxParityDetail');
  if(!host||!row?.sku_id)return;
  const seq=++request;
  host.querySelector('.cx-episode-supply')?.remove();
  try{
    const data=await rest('rpc/ask_collectish_scout_episode_supply_context_v1',{method:'POST',body:{p_sku_id:String(row.sku_id),p_days:365,p_limit:8}});
    if(seq!==request||!document.getElementById('cxParityDetail'))return;
    const html=render(data);if(!html)return;
    const section=document.createRange().createContextualFragment(html).firstElementChild;
    const anchor=host.querySelector('.cx-scout-time-machine')||host.querySelector('.cx-market-timeline')||host.querySelector('.cx-move-explanation');
    if(anchor)anchor.insertAdjacentElement('afterend',section);else host.appendChild(section);
  }catch(error){console.warn('Scout episode supply context unavailable',error)}
}

document.addEventListener('collectish:scout-detail-rendered',decorate);

const style=document.createElement('style');
style.textContent=`
.cx-episode-supply .cx-sub{margin:2px 0 0}.cx-episode-meta{font-size:10px;color:var(--cx-muted);margin:8px 0}.cx-episode-baseline{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--cx-line);border-radius:10px;padding:8px 10px}.cx-episode-baseline div{display:grid;gap:1px}.cx-episode-baseline b{font-size:12px}.cx-episode-baseline span{font-size:10px;color:var(--cx-muted)}.cx-episode-baseline em{font-size:9px;font-style:normal;font-weight:800;border:1px solid var(--cx-line);border-radius:999px;padding:3px 6px;white-space:nowrap}.cx-episode-baseline em.known{border-color:var(--cx-accent)}.cx-episode-baseline em.near{border-style:dashed}.cx-episode-baseline em.late{opacity:.7}.cx-episode-warning,.cx-episode-empty{display:block;color:var(--cx-muted);font-size:10px;line-height:1.35;margin-top:6px}.cx-episode-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:8px}.cx-episode-horizon{border:1px solid var(--cx-line);border-radius:8px;padding:6px 7px;display:grid;gap:2px}.cx-episode-horizon b{font-size:9px;color:var(--cx-muted);text-transform:uppercase;letter-spacing:.03em}.cx-episode-horizon span{font-size:10px;font-weight:700}.cx-episode-foot{display:flex;gap:8px;flex-wrap:wrap;margin-top:7px;color:var(--cx-muted);font-size:9px}@media(max-width:520px){.cx-episode-baseline{align-items:flex-start;flex-direction:column}.cx-episode-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;
document.head.appendChild(style);
