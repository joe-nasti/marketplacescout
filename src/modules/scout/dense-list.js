import store from '../../state/store.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
const score=r=>Number(r?.promoted_score??r?.v5_shadow_score??r?.opportunity_score??0);
const grade=r=>r?.promoted_grade||r?.v5_shadow_grade||(score(r)>=80?'A':score(r)>=70?'B':score(r)>=60?'C':score(r)>=50?'D':'F');
const premium=r=>{const m=Number(r?.sku_market_price||0),d=Number(r?.direct_low||0);return m>0&&d>0?(d/m-1)*100:null};
const rows=()=>store.get().scout?.rows||[];
let queued=false;

function denseBadge(r){
  if(r.direct_backed)return '<span class="cx-scout-dense-chip direct">Direct backed</span>';
  if(r.buylist_backed)return '<span class="cx-scout-dense-chip backed">Buylist backed</span>';
  if(r.near_direct_backed)return '<span class="cx-scout-dense-chip near">Near Direct</span>';
  if(r.source_verify)return '<span class="cx-scout-dense-chip verify">Verify</span>';
  return '<span class="cx-scout-dense-chip neutral">Open thesis</span>';
}
function decorate(){
  queued=false;
  const host=document.getElementById('cxParityCards');if(!host)return;
  const bySku=new Map(rows().map(r=>[String(r.sku_id||''),r]));
  for(const card of host.querySelectorAll(':scope > .cx-scout-card')){
    const r=bySku.get(String(card.dataset.sku||''));if(!r)continue;
    const p=premium(r),velocity=Math.max(0,Number(r.avg_daily_qty_sold||0));
    card.classList.remove('cx-scout-compact-card');
    card.classList.add('cx-scout-dense-row');
    card.innerHTML=`<span class="cx-scout-dense-card"><span class="cx-scout-thumb" data-v5-thumb="${esc(r.sku_id)}"><span class="cx-scout-thumb-placeholder">${esc(grade(r))}</span></span><span class="cx-scout-dense-name"><span class="cx-scout-card-top"><span class="cx-grade cx-grade-${esc(grade(r).toLowerCase())}">${esc(grade(r))}</span><span class="cx-score-mini">Scout ${Math.round(score(r))}/100</span></span><strong>${esc(r.product_name||r.sku_id)}</strong><small>${esc([r.set_name,r.printing,r.condition].filter(Boolean).join(' · '))}</small></span></span><span class="cx-scout-dense-score"><strong>${Math.round(score(r))}</strong><small>Score</small></span><span class="cx-scout-dense-num"><strong>${esc(money(r.sku_market_price))}</strong><small>Market</small></span><span class="cx-scout-dense-num"><strong>${esc(money(r.direct_low))}</strong><small>Direct</small></span><span class="cx-scout-dense-num ${p!=null&&p>=20?'positive':''}"><strong>${p==null?'—':`${p>=0?'+':''}${p.toFixed(0)}%`}</strong><small>D premium</small></span><span class="cx-scout-dense-num"><strong>${velocity.toFixed(1)}/d</strong><small>Velocity</small></span><span class="cx-scout-dense-floor"><strong>${esc(money(r.ck_buylist))}</strong><small>CK buylist</small></span><span class="cx-scout-dense-signal">${denseBadge(r)}<small>${r.direct_backed?'Cash floor supports Direct':r.buylist_backed?'Cash exit supports thesis':r.near_direct_backed?'Exit floor near Direct':r.source_verify?'Source needs verification':'Open for full thesis'}</small></span>`;
  }
  host.classList.add('cx-scout-dense-list');
  const section=host.parentElement;
  if(section&&!section.querySelector('.cx-scout-dense-head')){
    const head=document.createElement('div');head.className='cx-scout-dense-head';head.innerHTML='<span>Card</span><span>Score</span><span>Market</span><span>Direct</span><span>D premium</span><span>Velocity</span><span>CK BL</span><span>Signal</span>';section.insertBefore(head,host);
  }
  window.CollectishScoutListImages?.refresh?.();
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>requestAnimationFrame(decorate))}

document.addEventListener('collectish:scout-list-rendered',schedule);
document.addEventListener('collectish:scout-v5-ready',schedule);
document.addEventListener('collectish:scout-post-render-modules-ready',schedule);
document.addEventListener('collectish:idle-modules-ready',schedule);
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='scout')setTimeout(schedule,60)});
addEventListener('resize',schedule,{passive:true});
queueMicrotask(schedule);

window.CollectishScoutDense={decorate};
