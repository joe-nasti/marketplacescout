import {rest} from '../../core/rest.js';

const esc=value=>String(value??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
const money=value=>value==null||value===''||!Number.isFinite(Number(value))?'—':Number(value).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
const when=value=>{const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';return d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})};
let request=0;

function reasonCopy(reasons=[]){
  const map={baseline:'History starts',model_version:'Model changed',score:'Score moved',grade:'Grade changed',flag:'Thesis changed',confidence:'Confidence changed',buylist_backing:'Buylist backing changed',direct_backing:'Direct backing changed',near_direct_backing:'Direct floor changed',source_verification:'Source verification changed',direct_price:'Direct price moved',market_price:'Market price moved',ck_buylist:'CK buylist moved',direct_supply:'Direct supply moved',velocity:'Sales velocity moved',daily_checkpoint:'Daily checkpoint'};
  return reasons.map(x=>map[x]||String(x).replace(/_/g,' ')).join(' · ');
}

function card(e){
  const ev=e.evidence||{},components=e.components||{};
  const evidence=[`Direct ${money(ev.direct_low)}`,`Market ${money(ev.market_price)}`,ev.direct_available!=null?`${Number(ev.direct_available).toLocaleString()} Direct copies`:null,ev.sales_per_day!=null?`${Number(ev.sales_per_day).toFixed(2)}/day sold`:null,ev.ck_buylist!=null?`CK buy ${money(ev.ck_buylist)}`:null].filter(Boolean).join(' · ');
  const componentBits=[components.thesis!=null?`Thesis ${Number(components.thesis).toFixed(1)}`:null,components.direct_execution!=null?`Execution ${Number(components.direct_execution).toFixed(1)}`:null,components.buylist_backing!=null?`Buylist ${Number(components.buylist_backing).toFixed(1)}`:null,components.confirmation!=null?`Confirm ${Number(components.confirmation).toFixed(1)}`:null].filter(Boolean).join(' · ');
  return `<div class="cx-scout-replay-card">
    <div class="cx-scout-replay-score"><strong>${esc(e.grade||'—')}</strong><span>${e.score==null?'—':esc(e.score)}</span></div>
    <div class="cx-scout-replay-copy">
      <div class="cx-scout-replay-top"><strong>${esc(reasonCopy(e.change_reasons)||'Scout evaluation')}</strong><span>${esc(when(e.event_at))}</span></div>
      <b>${esc(e.flag||e.confidence||'Scout evaluation')}</b>
      ${componentBits?`<small>${esc(componentBits)}</small>`:''}
      ${evidence?`<small>${esc(evidence)}</small>`:''}
      <em>${esc(e.model_version||'Scout model')}</em>
    </div>
  </div>`;
}

function render(data){
  const evaluations=Array.isArray(data?.evaluations)?data.evaluations:[];
  const recent=evaluations.slice(-8).reverse();
  const body=recent.length?recent.map(card).join(''):'<div class="cx-scout-replay-empty">No preserved Scout evaluations in this window yet.</div>';
  return `<section class="cx-v5-section cx-scout-replay">
    <div class="cx-section-title">Scout decision history</div>
    <p class="cx-sub">What Scout actually scored and saw at each preserved evaluation. History begins when append-only capture was enabled.</p>
    <div class="cx-scout-replay-meta"><span>${Number(data?.evaluation_count||0).toLocaleString()} preserved evaluations</span><span>Material changes + daily checkpoints</span></div>
    <div class="cx-scout-replay-list">${body}</div>
    ${evaluations.length>8?'<small class="cx-scout-replay-more">Showing the 8 most recent evaluations.</small>':''}
  </section>`;
}

async function decorate(event){
  const host=document.getElementById('cxParityDetail'),row=event.detail?.row;
  host?.querySelector('.cx-scout-replay')?.remove();
  if(!host||!row?.sku_id)return;
  const seq=++request;
  try{
    const data=await rest('rpc/ask_collectish_scout_evaluation_history_v1',{method:'POST',body:{p_sku_id:String(row.sku_id),p_days:365}});
    if(seq!==request||!document.getElementById('cxParityDetail'))return;
    const section=document.createRange().createContextualFragment(render(data)).firstElementChild;
    const anchor=host.querySelector('.cx-market-timeline')||host.querySelector('.cx-vendor-depth')||host.querySelector('.cx-scout-market-board');
    if(anchor)anchor.insertAdjacentElement('afterend',section);else host.appendChild(section);
  }catch(error){console.warn('Scout decision history unavailable',error)}
}

const style=document.createElement('style');
style.textContent=`.cx-scout-replay-meta{display:flex;gap:8px;flex-wrap:wrap;margin:7px 0 9px;color:var(--cx-muted);font-size:10px}.cx-scout-replay-meta span{border:1px solid var(--cx-line);border-radius:999px;padding:3px 7px}.cx-scout-replay-list{display:grid;gap:7px}.cx-scout-replay-card{display:grid;grid-template-columns:46px minmax(0,1fr);gap:9px;border:1px solid var(--cx-line);border-radius:11px;padding:8px;background:var(--cx-bg)}.cx-scout-replay-score{display:flex;flex-direction:column;align-items:center;justify-content:center;border-right:1px solid var(--cx-line)}.cx-scout-replay-score strong{font-size:18px}.cx-scout-replay-score span{font-size:11px;color:var(--cx-muted)}.cx-scout-replay-copy{min-width:0}.cx-scout-replay-top{display:flex;justify-content:space-between;gap:8px}.cx-scout-replay-top strong{font-size:11px}.cx-scout-replay-top span,.cx-scout-replay-copy small,.cx-scout-replay-copy em{color:var(--cx-muted);font-size:10px}.cx-scout-replay-copy>b,.cx-scout-replay-copy small,.cx-scout-replay-copy em{display:block;margin-top:3px}.cx-scout-replay-copy em{font-style:normal}.cx-scout-replay-more,.cx-scout-replay-empty{display:block;color:var(--cx-muted);margin-top:7px;font-size:10px}@media(max-width:520px){.cx-scout-replay-top{display:block}.cx-scout-replay-top span{display:block;margin-top:2px}}`;
document.head.appendChild(style);
document.addEventListener('collectish:scout-detail-rendered',event=>void decorate(event));
