import store from '../../state/store.js';
import { rest } from '../../core/rest.js';

let links=[];
let items=new Map();
let confidence=new Map();
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
    rest('market_intel_scout_confidence?select=product_id,canonical_name,signal_count,independent_sources,leading_sources,confirming_sources,bullish_signals,bearish_signals,inherited_signal_count,exact_signal_count,latest_signal_at,weighted_net,priority_boost,confidence_label,confidence_reason&limit=5000').catch(()=>[])
  ]).then(([itemRows,entityRows,confidenceRows])=>{
    items=new Map((itemRows||[]).map(x=>[x.intel_id,x]));
    links=(entityRows||[]).filter(x=>items.has(x.intel_id));
    confidence=new Map((confidenceRows||[]).map(x=>[String(x.product_id||''),x]));
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
    if(item){
      seen.add(link.intel_id);
      out.push({...item,_oracleFamily:Boolean(link.family_match),_signalCard:link.canonical_name||link.entity_name});
    }
  }
  return out.sort((a,b)=>new Date(b.observed_at||0)-new Date(a.observed_at||0));
}
function confidenceFor(row){return confidence.get(String(row?.product_id||''))||null}
function summary(signals,c){
  const leading=signals.filter(x=>x.signal_stage==='leading').length;
  const confirming=signals.filter(x=>x.signal_stage==='confirming').length;
  const base=`${signals.length} signal${signals.length===1?'':'s'}${leading?` · ${leading} early`:confirming?` · ${confirming} confirming`:''}`;
  return Number(c?.priority_boost||0)>0?`${base} · +${c.priority_boost} priority`:base;
}
function confidenceLabel(c){
  const x=String(c?.confidence_label||'').replaceAll('_',' ');
  return x?x.replace(/\b\w/g,m=>m.toUpperCase()):'Signal context';
}
function signalPriorityScore(row){return Number(row?.promoted_score||0)+Number(confidenceFor(row)?.priority_boost||0)}
function relativeAge(value){
  const t=new Date(value||0).getTime();if(!Number.isFinite(t)||!t)return'unknown age';
  const h=Math.max(0,Math.floor((Date.now()-t)/3600000));
  if(h<1)return'within 1h';if(h<24)return`${h}h ago`;const d=Math.floor(h/24);return`${d}d ago`;
}
function matchesSignalFilter(row){
  const c=confidenceFor(row),label=String(c?.confidence_label||'');
  if(signalFilter==='corroborated')return label==='corroborated'||label==='strong_corroboration';
  if(signalFilter==='emerging')return label==='emerging';
  if(signalFilter==='none')return !c||Number(c.signal_count||0)===0;
  return true;
}
function ensureSignalPriorityControls(host){
  let controls=host.querySelector(':scope > .cx-signal-priority-controls');
  if(controls)return controls;
  controls=document.createElement('div');controls.className='cx-signal-priority-controls';
  controls.innerHTML=`<span>Signal priority</span><button type="button" data-signal-filter="all">All</button><button type="button" data-signal-filter="corroborated">Corroborated</button><button type="button" data-signal-filter="emerging">Emerging</button><button type="button" data-signal-filter="none">No signal</button><button type="button" data-signal-sort>Sort by grade + signal</button>`;
  controls.addEventListener('click',e=>{
    const filter=e.target.closest('[data-signal-filter]');
    const sort=e.target.closest('[data-signal-sort]');
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
  for(const card of cards){
    const row=bySku.get(String(card.dataset.sku));
    const visible=matchesSignalFilter(row);card.dataset.signalPriorityHidden=visible?'false':'true';card.hidden=!visible;
  }
  if(signalSort){
    cards.sort((a,b)=>{
      const ar=bySku.get(String(a.dataset.sku)),br=bySku.get(String(b.dataset.sku));
      return signalPriorityScore(br)-signalPriorityScore(ar)||Number(br?.promoted_score||0)-Number(ar?.promoted_score||0);
    }).forEach(card=>host.appendChild(card));
  }
}
function decorateList(){
  const rows=store.get().scout?.rows||[];
  const bySku=new Map(rows.map(r=>[String(r.sku_id),r]));
  document.querySelectorAll('#cxParityCards .cx-scout-card').forEach(card=>{
    card.querySelector('.cx-intel-mini')?.remove();
    const row=bySku.get(String(card.dataset.sku));
    const signals=matching(row);if(!signals.length)return;
    const c=confidenceFor(row),top=card.querySelector('.cx-scout-card-top');if(!top)return;
    const badge=document.createElement('span');badge.className='cx-intel-mini';badge.textContent=`◉ ${summary(signals,c)}`;
    badge.title=c?.confidence_reason||'Underlying-card market intelligence; exact-SKU execution remains separate and Scout grade is unchanged';
    top.appendChild(badge);
  });
  applySignalPriorityView();
}
function decorateDetail(sku){
  const host=document.getElementById('cxParityDetail');if(!host||!sku)return;
  host.querySelector('.cx-intel-detail')?.remove();
  const row=(store.get().scout?.rows||[]).find(r=>String(r.sku_id)===String(sku));
  const signals=matching(row);if(!signals.length)return;
  const c=confidenceFor(row),boost=Number(c?.priority_boost||0);
  const inherited=Number(c?.inherited_signal_count||0),exact=Number(c?.exact_signal_count||0),leading=Number(c?.leading_sources||0),sources=Number(c?.independent_sources||0);
  const whyNow=c?`${sources} independent source${sources===1?'':'s'} · ${leading} leading · latest ${relativeAge(c.latest_signal_at)}${inherited?` · Oracle-family context`:exact?' · exact-printing context':''}`:'';
  const confidenceBlock=c?`<div class="cx-v5-component"><strong>${esc(confidenceLabel(c))}${boost>0?` · +${boost} priority`:''}</strong><small><b>Why now:</b> ${esc(whyNow)}</small><small>${esc(exact)} exact-printing link${exact===1?'':'s'} · ${esc(inherited)} Oracle-family link${inherited===1?'':'s'}</small><small>${esc(c.confidence_reason||'Signals provide contextual support only.')}</small></div>`:'';
  const section=document.createElement('section');section.className='cx-v5-section cx-intel-detail';
  section.innerHTML=`<div class="cx-section-title">Underlying demand signals <span class="cx-intel-context">priority context · grade unchanged</span></div>${confidenceBlock}<div class="cx-intel-detail-list">${signals.slice(0,5).map(x=>`<a href="${esc(x.source_url)}" target="_blank" rel="noopener"><span class="cx-signal-stage ${esc(x.signal_stage)}">${esc(x.signal_stage)}</span><strong>${esc(x.title||x.source_name||'Market signal')}</strong><small>${esc(x.source_name||'External source')}${x._oracleFamily?` · underlying card: ${esc(x._signalCard)}`:' · exact/linked printing'}</small></a>`).join('')}</div>`;
  const anchor=host.querySelector('.cx-v5-components')||host.firstElementChild;
  if(anchor?.parentNode)anchor.parentNode.insertBefore(section,anchor.nextSibling);else host.appendChild(section);
}

document.addEventListener('collectish:scout-list-rendered',()=>{if(links.length)decorateList();else load()});
document.addEventListener('collectish:scout-detail-rendered',e=>{if(links.length)decorateDetail(e.detail?.sku);else load()});
document.addEventListener('collectish:intel-changed',()=>{links=[];items.clear();confidence.clear();load()});
document.addEventListener('collectish:ready',()=>load());

load();
