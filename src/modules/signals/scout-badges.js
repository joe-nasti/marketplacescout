import store from '../../state/store.js';
import { rest } from '../../core/rest.js';

let links=[];
let items=new Map();
let context=new Map();
let loading=null;
let signalFilter='all';
let signalSort=false;
const lower=s=>String(s||'').trim().toLowerCase();
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

async function load(){
  if(loading)return loading;
  loading=Promise.all([
    rest('market_intel_items?select=intel_id,signal_stage,direction,title,source_name,source_url,observed_at&order=observed_at.desc&limit=500'),
    rest('market_intel_scout_signal_links?select=intel_id,entity_name,canonical_name,oracle_id,source_scryfall_id,source_product_id,matched_scryfall_id,product_id,family_match&limit=5000'),
    rest('scout_opportunity_context?select=sku_id,product_id,promoted_grade,promoted_score,signal_count,signal_independent_sources,signal_leading_sources,signal_confirming_sources,exact_signal_count,inherited_signal_count,interest_exact_signal_count,interest_inherited_signal_count,interest_corroborating_printings,signal_priority_boost,signal_confidence_label,signal_confidence_reason,latest_signal_at,catalyst_source_name,catalyst_title,primary_event_type,content_conviction_score,catalyst_impact_score,convergence_score,expected_market_reaction_score,expected_reaction_confidence,market_response_score,market_response_status,unpriced_catalyst_gap_score,unpriced_catalyst_gap_state,catalyst_market_state,catalyst_priority_boost,context_priority_boost,discovery_priority_score,urgency_state,urgency_reason,risk_flags&limit=10000').catch(()=>[])
  ]).then(([itemRows,entityRows,contextRows])=>{
    items=new Map((itemRows||[]).map(x=>[x.intel_id,x]));
    links=(entityRows||[]).filter(x=>items.has(x.intel_id));
    context=new Map((contextRows||[]).map(x=>[String(x.sku_id||''),x]));
    decorateList();
    decorateDetail(store.get().scout?.selectedSku||null);
  }).catch(()=>{}).finally(()=>{loading=null});
  return loading;
}

function matching(row){
  if(!row)return[];
  const sf=lower(row.scryfall_id),pid=String(row.product_id||''),name=lower(row.product_name);
  const seen=new Set(),out=[];
  for(const link of links){
    const hit=(sf&&lower(link.matched_scryfall_id)===sf)||(pid&&String(link.product_id||'')===pid)||(name&&lower(link.entity_name)===name);
    if(!hit||seen.has(link.intel_id))continue;
    const item=items.get(link.intel_id);
    if(item){seen.add(link.intel_id);out.push({...item,_oracleFamily:Boolean(link.family_match),_signalCard:link.canonical_name||link.entity_name})}
  }
  return out.sort((a,b)=>new Date(b.observed_at||0)-new Date(a.observed_at||0));
}
function contextFor(row){return context.get(String(row?.sku_id||''))||null}
function pretty(value){return String(value||'').replaceAll('_',' ').replace(/\b\w/g,m=>m.toUpperCase())}
function gradeRank(row){return({A:5,B:4,C:3,D:2,F:1})[String(row?.promoted_grade||'').toUpperCase()]||0}
function eligiblePriorityBoost(row){return gradeRank(row)>=4?Number(contextFor(row)?.context_priority_boost||0):0}
function signalPriorityScore(row){return Number(row?.promoted_score||0)+eligiblePriorityBoost(row)}
function relativeAge(value){
  const t=new Date(value||0).getTime();if(!Number.isFinite(t)||!t)return'unknown age';
  const h=Math.max(0,Math.floor((Date.now()-t)/3600000));if(h<1)return'within 1h';if(h<24)return`${h}h ago`;return`${Math.floor(h/24)}d ago`;
}
function signalScope(c){
  const interestExact=Number(c?.interest_exact_signal_count||0),interestInherited=Number(c?.interest_inherited_signal_count||0),crossPrint=Number(c?.interest_corroborating_printings||0),exact=Number(c?.exact_signal_count||0),inherited=Number(c?.inherited_signal_count||0);
  if(crossPrint>=2)return`${crossPrint} printings moving`;
  if(interestExact>0)return'exact SKU';
  if(interestInherited>0)return'related printing';
  if(exact>0&&inherited===0)return'exact printing';
  if(inherited>0)return'Oracle family';
  return'underlying card';
}
function compactWhyNow(c){
  if(!c)return'';
  const sources=Number(c.signal_independent_sources||0),leading=Number(c.signal_leading_sources||0),confirming=Number(c.signal_confirming_sources||0),gap=Number(c.unpriced_catalyst_gap_score||0);
  const bits=[];
  if(sources){bits.push(`${sources} source${sources===1?'':'s'}`);bits.push(leading?`${leading} leading`:confirming?`${confirming} confirming`:'context');bits.push(signalScope(c));if(c.latest_signal_at)bits.push(relativeAge(c.latest_signal_at))}
  if(gap>0)bits.push(`catalyst gap ${gap}`);
  return bits.join(' · ');
}
function matchesSignalFilter(row){
  const c=contextFor(row),label=String(c?.signal_confidence_label||'');
  if(signalFilter==='corroborated')return label==='corroborated'||label==='strong_corroboration';
  if(signalFilter==='emerging')return label==='emerging';
  if(signalFilter==='none')return !c||Number(c.signal_count||0)===0;
  return true;
}
function ensureSignalPriorityControls(host){
  let controls=host.querySelector(':scope > .cx-signal-priority-controls');if(controls)return controls;
  controls=document.createElement('div');controls.className='cx-signal-priority-controls';
  controls.innerHTML=`<span>Opportunity context</span><button type="button" data-signal-filter="all">All</button><button type="button" data-signal-filter="corroborated">Corroborated</button><button type="button" data-signal-filter="emerging">Emerging</button><button type="button" data-signal-filter="none">No signal</button><button type="button" data-signal-sort>Sort within grade + context</button>`;
  controls.addEventListener('click',e=>{
    const filter=e.target.closest('[data-signal-filter]'),sort=e.target.closest('[data-signal-sort]');
    if(filter){signalFilter=filter.dataset.signalFilter||'all';applySignalPriorityView()}
    if(sort){signalSort=!signalSort;applySignalPriorityView()}
  });
  host.prepend(controls);return controls;
}
function applySignalPriorityView(){
  const host=document.getElementById('cxParityCards');if(!host)return;
  const rows=store.get().scout?.rows||[],bySku=new Map(rows.map(r=>[String(r.sku_id),r]));
  const controls=ensureSignalPriorityControls(host);
  controls.querySelectorAll('[data-signal-filter]').forEach(b=>b.classList.toggle('active',b.dataset.signalFilter===signalFilter));
  const sortButton=controls.querySelector('[data-signal-sort]');if(sortButton){sortButton.classList.toggle('active',signalSort);sortButton.setAttribute('aria-pressed',String(signalSort))}
  const cards=[...host.querySelectorAll(':scope > .cx-scout-card')];
  for(const card of cards){const row=bySku.get(String(card.dataset.sku)),visible=matchesSignalFilter(row);card.dataset.signalPriorityHidden=visible?'false':'true';card.hidden=!visible}
  if(signalSort){cards.sort((a,b)=>{
    const ar=bySku.get(String(a.dataset.sku)),br=bySku.get(String(b.dataset.sku));
    return gradeRank(br)-gradeRank(ar)||signalPriorityScore(br)-signalPriorityScore(ar)||Number(br?.promoted_score||0)-Number(ar?.promoted_score||0);
  }).forEach(card=>host.appendChild(card))}
}
function decorateList(){
  const rows=store.get().scout?.rows||[],bySku=new Map(rows.map(r=>[String(r.sku_id),r]));
  document.querySelectorAll('#cxParityCards .cx-scout-card').forEach(card=>{
    card.querySelector('.cx-intel-mini')?.remove();
    const row=bySku.get(String(card.dataset.sku)),c=contextFor(row);if(!c)return;
    const top=card.querySelector('.cx-scout-card-top');if(!top)return;
    const why=compactWhyNow(c),urgency=String(c.urgency_state||'standard');
    if(!why&&urgency==='standard')return;
    const badge=document.createElement('span');badge.className=`cx-intel-mini cx-urgency-${urgency}`;
    badge.textContent=`◉ ${pretty(urgency)}${why?` · ${why}`:''}`;
    badge.title=`Why now: ${c.urgency_reason||'External context only.'} Scout grade and economics are unchanged.`;top.appendChild(badge);
  });
  applySignalPriorityView();
}
function decorateDetail(sku){
  const host=document.getElementById('cxParityDetail');if(!host||!sku)return;
  host.querySelector('.cx-intel-detail')?.remove();
  const row=(store.get().scout?.rows||[]).find(r=>String(r.sku_id)===String(sku)),c=contextFor(row),signals=matching(row);if(!c&&!signals.length)return;
  const boost=eligiblePriorityBoost(row),signalBoost=Number(c?.signal_priority_boost||0),catalystBoost=Number(c?.catalyst_priority_boost||0),exact=Number(c?.exact_signal_count||0),inherited=Number(c?.inherited_signal_count||0),risks=Array.isArray(c?.risk_flags)?c.risk_flags:[];
  const catalyst=c?.catalyst_impact_score!=null?`<div class="cx-v5-component"><strong>Creator catalyst · ${esc(c.catalyst_source_name||'creator')}</strong><small>Conviction ${esc(c.content_conviction_score??'—')} · Catalyst ${esc(c.catalyst_impact_score??'—')} · Expected ${esc(c.expected_market_reaction_score??'—')} · Market ${esc(c.market_response_score??'—')} · Gap ${esc(c.unpriced_catalyst_gap_score??'—')}</small><small>${esc(pretty(c.unpriced_catalyst_gap_state||c.catalyst_market_state||'watching'))} · ${esc(c.catalyst_title||c.primary_event_type||'')}</small></div>`:'';
  const contextBlock=c?`<div class="cx-v5-component"><strong>${esc(pretty(c.urgency_state||'standard'))}${boost>0?` · +${boost} context priority`:''}</strong><small><b>Why now:</b> ${esc(compactWhyNow(c)||c.urgency_reason||'No elevated external urgency.')}</small><small>Signal +${esc(signalBoost)} · catalyst +${esc(catalystBoost)} · ${esc(exact)} exact-SKU link${exact===1?'':'s'} · ${esc(inherited)} inherited link${inherited===1?'':'s'}</small><small>${esc(c.urgency_reason||'Scout economics remain primary.')}${risks.length?` Risks: ${esc(risks.map(pretty).join(', '))}.`:''}</small></div>`:'';
  const signalList=signals.length?`<div class="cx-intel-detail-list">${signals.slice(0,5).map(x=>`<a href="${esc(x.source_url)}" target="_blank" rel="noopener"><span class="cx-signal-stage ${esc(x.signal_stage)}">${esc(x.signal_stage)}</span><strong>${esc(x.title||x.source_name||'Market signal')}</strong><small>${esc(x.source_name||'External source')}${x._oracleFamily?` · underlying card: ${esc(x._signalCard)}`:' · exact/linked printing'}</small></a>`).join('')}</div>`:'';
  const section=document.createElement('section');section.className='cx-v5-section cx-intel-detail';
  section.innerHTML=`<div class="cx-section-title">Opportunity context <span class="cx-intel-context">priority/urgency only · grade unchanged</span></div>${contextBlock}${catalyst}${signalList}`;
  const anchor=host.querySelector('.cx-v5-components')||host.firstElementChild;if(anchor?.parentNode)anchor.parentNode.insertBefore(section,anchor.nextSibling);else host.appendChild(section);
}

document.addEventListener('collectish:scout-list-rendered',()=>{if(context.size)decorateList();else load()});
document.addEventListener('collectish:scout-detail-rendered',e=>{if(context.size)decorateDetail(e.detail?.sku);else load()});
document.addEventListener('collectish:intel-changed',()=>{links=[];items.clear();context.clear();load()});
document.addEventListener('collectish:ready',()=>load());

load();
