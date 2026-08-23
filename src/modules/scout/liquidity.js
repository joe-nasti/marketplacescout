import store from '../../state/store.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function baseScore(r){return Number(r?.promoted_score??r?.v5_shadow_score??r?.opportunity_score??0)}
function liquidity(r){
  const rank=Number(r?.sales_rank),vel=Number(r?.avg_daily_qty_sold);
  let rankScore=25;
  if(Number.isFinite(rank)&&rank>0){if(rank<=30)rankScore=95;else if(rank<=80)rankScore=85;else if(rank<=180)rankScore=70;else if(rank<=300)rankScore=50;else if(rank<=500)rankScore=32;else rankScore=18}
  let velScore=null;
  if(Number.isFinite(vel)&&vel>0){if(vel>=9)velScore=100;else if(vel>=3)velScore=86;else if(vel>=1)velScore=72;else if(vel>=0.5)velScore=58;else velScore=42}
  const score=Math.round(velScore==null?rankScore:rankScore*.65+velScore*.35);
  let label='SLOW',bonus=0,target=30;
  if(score>=85){label='VERY LIQUID';bonus=8;target=15}
  else if(score>=70){label='LIQUID';bonus=5;target=18}
  else if(score>=55){label='NORMAL+';bonus=2;target=22}
  else if(score>=40){label='NORMAL';bonus=0;target=25}
  return {score,label,bonus,target,adjusted:Math.min(100,baseScore(r)+bonus),rank:Number.isFinite(rank)&&rank>0?rank:null,velocity:Number.isFinite(vel)&&vel>0?vel:null};
}
function rows(){return store.get().scout?.rows||[]}
function bySku(){return new Map(rows().map(r=>[String(r.sku_id),r]))}
function addFilter(){
  const bar=document.querySelector('#cxScout .cx-scout-toolbar');if(!bar||document.getElementById('cxLiquidityFilter'))return;
  const s=document.createElement('select');s.id='cxLiquidityFilter';s.innerHTML='<option value="">All liquidity</option><option value="very">Very liquid</option><option value="liquid">Liquid+</option><option value="normal">Normal+</option><option value="slow">Slow / all</option>';bar.appendChild(s);s.addEventListener('change',applyFilter);
}
function applyFilter(){
  const v=document.getElementById('cxLiquidityFilter')?.value||'',map=bySku();let first=null;
  document.querySelectorAll('#cxParityCards .cx-scout-card').forEach(card=>{
    const r=map.get(String(card.dataset.sku)),m=liquidity(r);let show=true;
    if(v==='very')show=m.score>=85;else if(v==='liquid')show=m.score>=70;else if(v==='normal')show=m.score>=55;else if(v==='slow')show=true;
    card.style.display=show?'':'none';if(show&&!first)first=card;
  });
  if(first&&document.querySelector('#cxParityCards .cx-scout-card.selected')?.style.display==='none')first.click();
}
function decorateList(){
  addFilter();const map=bySku();
  document.querySelectorAll('#cxParityCards .cx-scout-card').forEach(card=>{
    card.querySelector('.cx-liquidity-badge')?.remove();const r=map.get(String(card.dataset.sku));if(!r)return;const m=liquidity(r),top=card.querySelector('.cx-scout-card-top');if(!top)return;
    const b=document.createElement('span');b.className='cx-v5-badge cx-liquidity-badge';b.textContent=`${m.label}${m.bonus?` +${m.bonus}`:''}`;b.title=`Liquidity ${m.score}/100 · target net ROI ${m.target}%`;top.appendChild(b);
  });applyFilter();
}
function stat(label,value,sub=''){return `<div class="cx-v5-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`}
function decorateDetail(sku){
  const h=document.getElementById('cxParityDetail');if(!h||!sku)return;h.querySelector('.cx-liquidity-section')?.remove();const r=rows().find(x=>String(x.sku_id)===String(sku));if(!r)return;const m=liquidity(r);
  const section=document.createElement('section');section.className='cx-v5-section cx-liquidity-section';
  section.innerHTML=`<div class="cx-section-title">Liquidity & margin</div><div class="cx-v5-grid">${stat('Liquidity',`${m.label} · ${m.score}/100`,m.velocity!=null?`${m.velocity.toFixed(1)} observed sales/day`:'sales rank model')}${stat('Sales rank',m.rank!=null?`#${m.rank}`:'—')}${stat('Target net ROI',`${m.target}%`,'lower target only when exit velocity is stronger')}${stat('Liquidity bonus',`+${m.bonus} pts`,`${baseScore(r)} base → ${m.adjusted} execution-adjusted`)}</div><small class="cx-sub">Liquidity is an execution overlay: fast-selling cards can justify thinner margins. The base Scout thesis remains visible separately.</small>`;
  const demand=[...h.querySelectorAll('.cx-v5-section')].find(x=>x.querySelector('.cx-section-title')?.textContent?.trim()==='Demand & supply');if(demand)demand.insertAdjacentElement('afterend',section);else h.appendChild(section);
}
document.addEventListener('collectish:scout-list-rendered',()=>setTimeout(decorateList,0));
document.addEventListener('collectish:scout-detail-rendered',e=>setTimeout(()=>decorateDetail(e.detail?.sku),0));
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='scout'){setTimeout(decorateList,80);setTimeout(()=>decorateDetail(store.get().scout?.selectedSku),100)}});
export {liquidity as scoutLiquidity};
