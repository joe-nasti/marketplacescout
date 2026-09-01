import store from '../../state/store.js';
import { registerComponent } from '../../core/lifecycle.js';
import { uiEvidenceMarker, directPremiumEvidence } from '../../core/ui-primitives.js';

const detail=()=>document.getElementById('cxParityDetail');
const norm=s=>String(s||'').trim().toLowerCase();
const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
const pct=n=>n==null||!Number.isFinite(Number(n))?'—':`\${Number(n).toFixed(0)}%`;
const score=r=>Number(r?.promoted_score??r?.v5_shadow_score??r?.opportunity_score??0);
const grade=r=>r?.promoted_grade||r?.v5_shadow_grade||(score(r)>=80?'A':score(r)>=70?'B':score(r)>=60?'C':score(r)>=50?'D':'F');
const points=(label,value,max)=>{const chip=document.createElement('span');chip.className='cx-v5-score-chip';const v=Number(value||0);chip.innerHTML=`<b>${label}</b><strong>${Number.isInteger(v)?v:v.toFixed(1)}<small>/${max}</small></strong>`;return chip};
function selectedRow(sku){const scout=store.get().scout||{};return (scout.rows||[]).find(r=>String(r.sku_id)===String(sku))||null}
function sectionByTitle(h,title){return [...h.querySelectorAll('.cx-v5-section')].find(section=>norm(section.querySelector(':scope > .cx-section-title')?.textContent)===norm(title))||null}
function addMarker(stat,html){if(!stat||!html||stat.querySelector('[data-cx-evidence-kind]'))return;const value=stat.querySelector('strong,b,.cx-v5-stat-value')||stat.lastElementChild;if(value)value.insertAdjacentHTML('beforeend',html)}

function compactHeader(h,row){
  const hero=h.querySelector('.cx-scout-hero'),oldTitle=h.querySelector('.cx-v5-title'),oldBadges=h.querySelector('.cx-v5-badges'),oldComponents=h.querySelector('.cx-v5-components');if(!oldTitle||!oldComponents)return;
  const scout=store.get().scout||{},visible=scout.visible||scout.rows||[],position=Math.max(0,visible.findIndex(r=>String(r.sku_id)===String(row.sku_id)))+1,filters=scout.filters||{},filterCount=['grade','set','min','max','spread','foil','liquidity'].reduce((n,k)=>n+(filters[k]?1:0),0);
  const nav=document.createElement('div');nav.className='cx-card-detail-nav';const close=h.querySelector('.cx-mobile-detail-close');if(close){close.textContent='Back';close.setAttribute('aria-label','Back to Scout results');nav.append(close)}const trail=document.createElement('div');trail.innerHTML=`<strong>Scout · ${position||1} of ${visible.length||1}</strong><small>${score(row)>=80?'HOT · ':''}score ↓ · filters ${filterCount}</small>`;nav.append(trail);h.prepend(nav);
  const head=document.createElement('div');head.className='cx-v5-compact-head';if(hero)head.append(hero);
  const info=document.createElement('div');info.className='cx-v5-compact-info';
  const title=document.createElement('div');title.className='cx-v5-compact-title';title.textContent=row.product_name||'Unknown card';
  const set=document.createElement('div');set.className='cx-v5-compact-set';set.textContent=`${row.set_name||'Unknown set'}${row.collector_number?` · #${row.collector_number}`:''}`;
  const meta=document.createElement('div');meta.className='cx-v5-compact-meta';
  const printing=document.createElement('span');printing.className='cx-v5-printing-chip';printing.textContent=[row.condition,row.printing,row.language].filter(Boolean).join(' · ')||'Printing unknown';
  const overall=document.createElement('span');overall.className='cx-v5-overall-chip';overall.innerHTML=`<span class="cx-grade cx-grade-${grade(row).toLowerCase()}">${grade(row)}</span><strong>${score(row)}<small>/100</small></strong>`;
  meta.append(printing,overall);
  const thesis=document.createElement('p');thesis.className='cx-card-detail-thesis';thesis.textContent=Number(row.avg_daily_qty_sold||0)>=1?'Rising attention with measurable velocity and a printing-specific execution gap.':row.buylist_backed?'The cash floor supports this exact printing while the market gap remains actionable.':'A printing-specific opportunity with market pricing and exit evidence.';
  info.append(title,set,meta,thesis);if(oldBadges?.children.length){oldBadges.classList.add('cx-v5-compact-badges');info.append(oldBadges)}head.append(info);oldTitle.replaceWith(head);
  const buy=Number(row.cheapest_buy||row.tcg_low||0),direct=Number(row.direct_low||0),roi=buy>0&&row.direct_net_profit!=null?Number(row.direct_net_profit)/buy*100:null,kpis=document.createElement('div');kpis.className='cx-card-kpi-tape';kpis.innerHTML=`<span><small>Market</small><b>${money(row.sku_market_price)}</b></span><span><small>Direct</small><b>${money(direct)}</b></span><span class="positive"><small>Cash floor</small><b>${money(row.ck_buylist)}</b></span><span><small>Buy target</small><b>${money(buy)}</b></span><span class="positive"><small>ROI</small><b>${pct(roi)}</b></span>`;head.after(kpis);
  const execution=Number(row.direct_execution_points||0)+Number(row.buylist_backing_points||0),strip=document.createElement('div');strip.className='cx-v5-score-strip';strip.append(points('Thesis',row.thesis_points,70),points('Exec',execution,20),points('Floor',row.exit_floor_points,5),points('Conf',row.confirmation_points,5));oldComponents.replaceWith(strip);
  const market=sectionByTitle(h,'Across the market'),decision=h.querySelector('.cx-scout-decision');if(market&&decision){decision.classList.add('cx-card-best-opportunity');market.insertAdjacentElement('afterend',decision)}
}

function tierSpreads(h,row){
  sectionByTitle(h,'Best trade')?.classList.add('cx-v5-tier-best');
  const cash=sectionByTitle(h,'Cash floor'),tcgLow=Number(row.tcg_low||0),ck=Number(row.ck_buylist||0);
  if(cash){cash.classList.add('cx-v5-tier-cash');if(tcgLow>0&&ck>tcgLow){const spread=(ck/tcgLow-1)*100;cash.classList.add('cx-v5-positive-exit');const badge=document.createElement('span');badge.className='cx-v5-instant-exit';badge.textContent=`⚡ +${spread.toFixed(1)}% Instant Exit`;cash.querySelector(':scope > .cx-section-title')?.after(badge)}}
  const pricing=sectionByTitle(h,'Market pricing');
  const market=Number(row.sku_market_price||0),direct=Number(row.direct_low||0),p=market>0&&direct>0?(direct/market-1)*100:null,directEvidence=directPremiumEvidence(p);
  pricing?.querySelectorAll('.cx-v5-stat').forEach(stat=>{const label=norm(stat.querySelector(':scope > span')?.textContent);if(label==='mana pool'||label==='cardmarket / mkm'||label==='cardmarket')stat.classList.add('cx-v5-passive-reference');if(label==='tcg low'||label==='low'||label==='tcgplayer low')addMarker(stat,uiEvidenceMarker('inferred','Lowest observed ask; quantity available near this price is not established.'));if(label.includes('direct')&&directEvidence)addMarker(stat,uiEvidenceMarker(directEvidence.kind,directEvidence.help));if(label.includes('velocity')||label.includes('sales/day'))addMarker(stat,uiEvidenceMarker('verified','Measured TCGplayer marketplace sales; Direct vs non-Direct is not identified.'))});
}

export function decorateScoutDetailCompact(event){const h=detail(),sku=event?.detail?.sku||store.get().scout?.selectedSku,row=selectedRow(sku);if(!h||!row||h.querySelector('.cx-v5-compact-head'))return;compactHeader(h,row);tierSpreads(h,row)}
function schedule(event){requestAnimationFrame(()=>requestAnimationFrame(()=>decorateScoutDetailCompact(event)))}
registerComponent('scout-detail-compact-header',{mount(){document.addEventListener('collectish:scout-detail-rendered',schedule)},unmount(){document.removeEventListener('collectish:scout-detail-rendered',schedule)},onPage(page){if(page==='scout')schedule()}});
