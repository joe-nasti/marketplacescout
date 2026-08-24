import store from '../../state/store.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
const pct=n=>n==null||!Number.isFinite(Number(n))?'—':`${Number(n)>=0?'+':''}${Number(n).toFixed(1)}%`;
const rows=()=>store.get().sealed?.rows||[];
const score=r=>r?.scout_sealed_score==null?null:Number(r.scout_sealed_score);
const grade=r=>r?.scout_sealed_grade||'—';
const acq=r=>r?.sealed_acquisition_price==null?null:Number(r.sealed_acquisition_price);
let queued=false;

function status(r){
  if(r.blocker)return {cls:'risk',label:'Blocked',sub:String(r.blocker).replaceAll('_',' ')};
  const buy=Number(r.cardkingdom_buylist_ev||0),a=acq(r);
  if(Number.isFinite(buy)&&buy>0&&Number.isFinite(a)&&a>0&&buy>a)return {cls:'buylist',label:'Buylist backed',sub:'CK buylist EV > acquisition'};
  if(Number(r.market_spread||0)>0)return {cls:'positive',label:'Positive spread',sub:`Market ROI ${pct(r.market_roi_pct)}`};
  if(r.lifecycle_status==='scout_sealed')return {cls:'scout',label:'Scout ready',sub:'Full sealed score available'};
  if(r.lifecycle_status==='ev_ready')return {cls:'neutral',label:'EV ready',sub:'Economics available'};
  return {cls:'neutral',label:'Pending',sub:String(r.lifecycle_status||'').replaceAll('_',' ')};
}

function decorate(){
  queued=false;
  const host=document.getElementById('cxSealedRows');if(!host)return;
  const map=new Map(rows().map(r=>[String(r.sealed_uuid||''),r]));
  for(const row of host.querySelectorAll(':scope > .cx-sealed-row')){
    const r=map.get(String(row.dataset.deck||''));if(!r)continue;
    if(row.dataset.cxDense==='1')continue;
    const s=status(r),sc=score(r);
    row.dataset.cxDense='1';
    row.classList.add('cx-sealed-dense-row');
    row.innerHTML=`<span class="cx-sealed-dense-name"><span class="cx-sealed-dense-grade ${sc==null?'pending':''}">${esc(grade(r))}</span><span><strong>${esc(r.product_name||r.sealed_uuid)}</strong><small>${esc([r.set_code,r.category||r.subtype,r.release_date].filter(Boolean).join(' · '))}</small></span></span><span class="cx-sealed-dense-num"><strong>${sc==null?'—':sc.toFixed(1)}</strong><small>Score</small></span><span class="cx-sealed-dense-num"><strong>${esc(money(acq(r)))}</strong><small>Acq</small></span><span class="cx-sealed-dense-num"><strong>${esc(money(r.tcg_market_ev))}</strong><small>Market EV</small></span><span class="cx-sealed-dense-num ${Number(r.market_spread||0)>=0?'positive':'negative'}"><strong>${esc(money(r.market_spread))}</strong><small>${esc(pct(r.market_roi_pct))}</small></span><span class="cx-sealed-dense-num"><strong>${esc(money(r.cardkingdom_buylist_ev))}</strong><small>CK BL EV</small></span><span class="cx-sealed-dense-num"><strong>${r.market_coverage_pct==null?'—':`${Number(r.market_coverage_pct).toFixed(0)}%`}</strong><small>Coverage</small></span><span class="cx-sealed-dense-status"><span class="cx-sealed-dense-chip ${esc(s.cls)}">${esc(s.label)}</span><small>${esc(s.sub)}</small></span>`;
  }
  host.classList.add('cx-sealed-dense-list');
  const section=host.parentElement;
  if(section&&!section.querySelector('.cx-sealed-dense-head')){
    const head=document.createElement('div');head.className='cx-sealed-dense-head';head.innerHTML='<span>Product</span><span>Score</span><span>Acq</span><span>Market EV</span><span>Spread</span><span>CK BL EV</span><span>Coverage</span><span>Status</span>';section.insertBefore(head,host);
  }
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>requestAnimationFrame(decorate))}

document.addEventListener('collectish:sealed-rendered',schedule);
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='sealed')setTimeout(schedule,60)});
addEventListener('resize',schedule,{passive:true});
queueMicrotask(schedule);
window.CollectishSealedDense={decorate};
