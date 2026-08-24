import store from '../../state/store.js';

let installed=false;
let view='ranked';
let savedView='top';
let filterOpen=false;

const host=()=>document.getElementById('cxScout');
const rows=()=>store.get().scout?.rows||[];
const bySku=()=>new Map(rows().map(r=>[String(r.sku_id||''),r]));
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function activeFilterCount(){
  const ids=['cxParityGrade','cxParitySet','cxScoutMin','cxScoutMax','cxScoutSpread','cxScoutFoil','cxLiquidityFilter'];
  return ids.reduce((n,id)=>n+(document.getElementById(id)?.value?1:0),0);
}
function ensureChrome(){
  const h=host();if(!h)return null;
  let ia=h.querySelector('#cxScoutIa');
  if(!ia){
    ia=document.createElement('section');ia.id='cxScoutIa';ia.className='cx-scout-ia';
    ia.innerHTML=`<div class="cx-scout-ia-row"><div class="cx-scout-saved-views"><button data-scout-saved="top">Top</button><button data-scout-saved="quick">Quick turns</button><button data-scout-saved="buylist">Buylist backed</button><button data-scout-saved="velocity">High velocity</button></div><button type="button" class="cx-refresh cx-scout-filter-trigger" data-scout-filters>Filters <span>0</span></button></div><button type="button" id="cxScoutBudgetStrip" class="cx-scout-budget-strip" data-scout-view="allocate"><span>Budget</span><strong>Open allocation</strong><small>Position-sized buying plan →</small></button>`;
    const head=h.querySelector('.cx-page-head');if(head)head.insertAdjacentElement('afterend',ia);else h.prepend(ia);
  }
  let sheet=h.querySelector('#cxScoutFilterSheet');
  if(!sheet){sheet=document.createElement('section');sheet.id='cxScoutFilterSheet';sheet.className='cx-scout-filter-sheet';sheet.innerHTML='<div class="cx-scout-filter-sheet-head"><strong>Filters</strong><button type="button" data-scout-filter-close aria-label="Close filters">×</button></div><div id="cxScoutFilterSheetBody"></div><div class="cx-scout-filter-sheet-actions"><button type="button" class="cx-secondary" data-scout-filter-reset>Reset</button><button type="button" class="cx-primary" data-scout-filter-close>Show opportunities</button></div>';h.appendChild(sheet)}
  return ia;
}
function syncControls(){
  const h=host(),sheet=h?.querySelector('#cxScoutFilterSheetBody'),toolbar=h?.querySelector('.cx-scout-toolbar');if(!h||!sheet||!toolbar)return;
  const search=toolbar.querySelector('#cxParitySearch');
  if(search&&!search.closest('.cx-scout-search-row')){const row=document.createElement('div');row.className='cx-scout-search-row';toolbar.insertBefore(row,toolbar.firstChild);row.append(search);const b=document.createElement('button');b.type='button';b.className='cx-refresh';b.dataset.scoutFilters='1';b.innerHTML=`Filters <span>${activeFilterCount()}</span>`;row.append(b)}
  [...toolbar.children].forEach(el=>{if(el.classList?.contains('cx-scout-search-row')||el.id==='cxParitySearch')return;sheet.appendChild(el)});
  const compact=sheet.querySelector('[data-cx-compact-filters]');if(compact)compact.classList.add('cx-scout-filter-grid');
  const n=activeFilterCount();h.querySelectorAll('[data-scout-filters] span,.cx-scout-filter-trigger span').forEach(x=>x.textContent=String(n));
}
function allocationText(){const panel=document.getElementById('cxPortfolioAllocation');if(!panel)return null;const stats=[...panel.querySelectorAll('.cx-v5-stat')];const get=label=>{const s=stats.find(x=>x.querySelector('span')?.textContent?.trim()===label);return s?.querySelector('strong')?.textContent?.trim()||''};return {budget:get('Budget'),deployed:get('Deployed'),cash:get('Cash left')}}
function syncBudgetStrip(){const strip=document.getElementById('cxScoutBudgetStrip'),a=allocationText();if(!strip)return;if(!a){strip.innerHTML='<span>Budget</span><strong>Open allocation</strong><small>Position-sized buying plan →</small>';return}strip.innerHTML=`<span>Budget ${esc(a.budget||'')}</span><strong>${esc(a.deployed||'—')} deployed</strong><small>${esc(a.cash||'—')} cash left · Allocate →</small>`}
function applySavedView(){const map=bySku();document.querySelectorAll('#cxParityCards .cx-scout-card').forEach(card=>{const r=map.get(String(card.dataset.sku||''));let show=true;if(savedView==='buylist')show=Boolean(r?.buylist_backed||r?.direct_backed||r?.near_direct_backed);else if(savedView==='velocity')show=Number(r?.avg_daily_qty_sold||0)>=1;card.hidden=!show})}
function syncSurface(){
  const h=host();if(!h)return;const layout=h.querySelector('.cx-scout-layout'),quick=h.querySelector('#cxQuickTurnScout'),alloc=h.querySelector('#cxPortfolioAllocation');
  if(layout)layout.hidden=view!=='ranked';if(quick)quick.hidden=view!=='quick';if(alloc)alloc.hidden=view!=='allocate';
  h.classList.toggle('cx-scout-view-ranked',view==='ranked');h.classList.toggle('cx-scout-view-quick',view==='quick');h.classList.toggle('cx-scout-view-allocate',view==='allocate');
  h.querySelectorAll('[data-scout-saved]').forEach(b=>b.classList.toggle('active',(view==='quick'&&b.dataset.scoutSaved==='quick')||(view==='ranked'&&b.dataset.scoutSaved===savedView)));
  if(view==='ranked')applySavedView();syncBudgetStrip();
}
function setSaved(next){if(next==='quick'){view='quick';savedView='quick'}else{view='ranked';savedView=next||'top'}syncSurface();if(view==='quick')document.getElementById('cxQuickTurnScout')?.scrollIntoView({block:'start'})}
function setView(next){view=next||'ranked';if(view==='ranked'&&savedView==='quick')savedView='top';syncSurface()}
function openFilters(open=true){filterOpen=Boolean(open);host()?.classList.toggle('cx-scout-filters-open',filterOpen);document.body.classList.toggle('cx-scout-filter-lock',filterOpen)}
function resetFilters(){const ids=['cxParityGrade','cxParitySet','cxScoutMin','cxScoutMax','cxScoutSpread','cxScoutFoil','cxLiquidityFilter'];ids.forEach(id=>{const el=document.getElementById(id);if(!el)return;el.value='';el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}))});syncControls()}
function compressDetail(){
  const h=document.getElementById('cxParityDetail');if(!h||h.dataset.cxIa==='1')return;const best=[...h.querySelectorAll('.cx-v5-section')].find(x=>x.querySelector('.cx-section-title')?.textContent?.trim()==='Best trade');if(!best)return;h.dataset.cxIa='1';
  const call=best.querySelector('.cx-v5-callout');const values=call?[...call.querySelectorAll(':scope > div')].map(x=>({label:x.querySelector('span')?.textContent?.trim(),value:x.querySelector('strong')?.textContent?.trim()})):[];const get=label=>values.find(x=>x.label===label)?.value||'—';
  const decision=document.createElement('section');decision.className='cx-scout-decision';decision.innerHTML=`<small>Decision</small><strong>Buy ${esc(get('Best observed US buy'))} → ${esc(get('Est. Direct net'))}</strong><span>${esc(get('Est. Direct profit'))}</span>`;const title=h.querySelector('.cx-v5-title');(title||h.firstElementChild)?.insertAdjacentElement('afterend',decision);best.classList.add('cx-scout-execution-primary');
  const cash=[...h.querySelectorAll('.cx-v5-section')].find(x=>x.querySelector('.cx-section-title')?.textContent?.trim()==='Cash floor');if(cash)cash.classList.add('cx-scout-why-buy');
  const evidenceTitles=new Set(['Market pricing','Demand & supply','Liquidity & margin']);const evidence=[...h.querySelectorAll('.cx-v5-section')].filter(x=>evidenceTitles.has(x.querySelector('.cx-section-title')?.textContent?.trim()));if(evidence.length){const d=document.createElement('details');d.className='cx-v5-details cx-scout-evidence';d.innerHTML='<summary>Evidence & pricing</summary><div class="cx-scout-evidence-body"></div>';const body=d.querySelector('.cx-scout-evidence-body');evidence[0].insertAdjacentElement('beforebegin',d);evidence.forEach(x=>body.appendChild(x))}
  const pos=h.querySelector('.cx-position-sizing');if(pos)pos.classList.add('cx-scout-execution-secondary');
}
function scheduleDetail(){for(const ms of [0,120,420])setTimeout(()=>{const h=document.getElementById('cxParityDetail');if(h)delete h.dataset.cxIa;compressDetail()},ms)}
function ensure(){if(!host())return;ensureChrome();syncControls();syncSurface()}
function click(e){const saved=e.target.closest?.('[data-scout-saved]');if(saved){e.preventDefault();setSaved(saved.dataset.scoutSaved);return}if(e.target.closest?.('[data-scout-filters]')){e.preventDefault();openFilters(true);return}if(e.target.closest?.('[data-scout-filter-close]')){e.preventDefault();openFilters(false);return}if(e.target.closest?.('[data-scout-filter-reset]')){e.preventDefault();resetFilters();return}const v=e.target.closest?.('[data-scout-view]');if(v){e.preventDefault();setView(v.dataset.scoutView)}}
function input(e){if(['cxParityGrade','cxParitySet','cxScoutMin','cxScoutMax','cxScoutSpread','cxScoutFoil','cxLiquidityFilter'].includes(e.target?.id))setTimeout(()=>{syncControls();applySavedView()},0)}
export function installScoutIaV2(){
  if(installed)return;installed=true;document.addEventListener('click',click,true);document.addEventListener('input',input,true);document.addEventListener('change',input,true);
  document.addEventListener('collectish:scout-v5-ready',()=>setTimeout(ensure,0));document.addEventListener('collectish:scout-list-rendered',()=>setTimeout(()=>{ensure();applySavedView()},0));document.addEventListener('collectish:scout-post-render-modules-ready',()=>setTimeout(ensure,0));document.addEventListener('collectish:idle-modules-ready',()=>setTimeout(ensure,0));document.addEventListener('collectish:position-sizing-changed',()=>{ensure();scheduleDetail()});document.addEventListener('collectish:scout-detail-rendered',scheduleDetail);document.addEventListener('collectish:seller-cashflow-changed',()=>setTimeout(ensure,0));document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='scout')setTimeout(ensure,60)});document.addEventListener('collectish:ready',()=>setTimeout(ensure,100));queueMicrotask(ensure)
}
installScoutIaV2();window.CollectishScoutIaV2={ensure,setView,setSaved,openFilters};
