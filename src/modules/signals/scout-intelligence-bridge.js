import store from '../../state/store.js';
import { rest } from '../../core/rest.js';

let competitive=[];
let commander=[];
let cedh=[];
let cedhCards=[];
let corroborated=[];
let loading=null;
const lower=s=>String(s||'').trim().toLowerCase();
const baseName=s=>String(s||'').replace(/\s*\([^)]*(foil|showcase|borderless|extended art|serialized|retro frame|etched|alternate art|halo foil|rainbow foil|surge foil|galaxy foil)[^)]*\)\s*/ig,' ').replace(/\s+/g,' ').trim();
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function scoutRows(){return store.get().scout?.rows||[]}
function matchScout({sku_id,product_id,scryfall_id,card_name,commander}={}){
  const rows=scoutRows();
  if(sku_id){const x=rows.find(r=>String(r.sku_id)===String(sku_id));if(x)return x}
  if(scryfall_id){const x=rows.find(r=>String(r.scryfall_id||'')===String(scryfall_id));if(x)return x}
  if(product_id){const x=rows.find(r=>String(r.product_id)===String(product_id));if(x)return x}
  const q=lower(baseName(card_name||commander));if(!q)return null;
  return rows.find(r=>lower(baseName(r.product_name))===q)||rows.find(r=>lower(r.product_name)===q)||null;
}
function tryOpenTarget(target){
  const row=matchScout(target);
  const input=document.getElementById('cxParitySearch');
  if(!row){const q=baseName(target?.card_name||target?.commander||'');if(q&&input){input.value=q;input.dispatchEvent(new Event('input',{bubbles:true}))}return false}
  if(input){input.value=baseName(row.product_name);input.dispatchEvent(new Event('input',{bubbles:true}))}
  const selector=`#cxParityCards .cx-scout-card[data-sku="${CSS.escape(String(row.sku_id))}"]`;
  const card=document.querySelector(selector);if(!card)return false;
  card.click();card.scrollIntoView({block:'center',behavior:'smooth'});return true;
}
function openScout(target){window.CollectishShell?.switchPage?.('scout');const attempts=[0,60,140,280,500,900,1500,2400];let done=false;for(const ms of attempts)setTimeout(()=>{if(!done)done=tryOpenTarget(target)},ms)}
function detailFor(row){
  if(!row)return{competitive:[],commander:[],cedh:[],cedhCards:[],crossSource:[]};
  const name=lower(baseName(row.product_name)),pid=String(row.product_id||''),sku=String(row.sku_id||'');
  const match=x=>(sku&&String(x.sku_id||'')===sku)||(pid&&String(x.product_id||'')===pid);
  const comp=competitive.filter(x=>match(x)||lower(baseName(x.card_name))===name);
  const edh=commander.filter(x=>match(x)||lower(baseName(x.card_name))===name);
  const c=cedh.filter(x=>match(x)||lower(baseName(x.commander))===name);
  const cc=cedhCards.filter(x=>match(x)||lower(baseName(x.card_name))===name);
  const multi=corroborated.filter(x=>match(x)||lower(baseName(x.card_name))===name);
  return{competitive:comp,commander:edh,cedh:c,cedhCards:cc,crossSource:multi};
}
function badgeSummary(ctx){
  const out=[];
  if(ctx.crossSource.length){const x=ctx.crossSource[0];out.push(Number(x.dynamic_sources||0)>0?'MULTI ↑':`MULTI ${x.evidence_sources||2}`)}
  if(ctx.competitive.length)out.push(`COMP ${Math.max(...ctx.competitive.map(x=>Number(x.deck_count_30d||0)))}`);
  if(ctx.commander.length){const top=ctx.commander[0];out.push(top.watch_class==='edh_breakout'?'EDH ↑':`EDH #${top.edhrec_rank}`)}
  if(ctx.cedhCards.length){const x=ctx.cedhCards[0];out.push(x.watch_class==='cedh_breakout'?'cEDH ↑':x.watch_class==='cedh_recent_card'?'cEDH NEW':`cEDH ${x.deck_count_30d||0}`)}
  else if(ctx.cedh.length)out.push(`cEDH CMD ${ctx.cedh[0].entries_30d||ctx.cedh[0].entries||0}`);
  return out;
}
function decorateScoutList(){
  const bySku=new Map(scoutRows().map(r=>[String(r.sku_id),r]));
  document.querySelectorAll('#cxParityCards .cx-scout-card').forEach(card=>{
    card.querySelector('.cx-intelligence-mini')?.remove();
    const row=bySku.get(String(card.dataset.sku)),ctx=detailFor(row),parts=badgeSummary(ctx);if(!parts.length)return;
    const top=card.querySelector('.cx-scout-card-top');if(!top)return;
    const el=document.createElement('span');el.className='cx-intel-mini cx-intelligence-mini';el.textContent=`◎ ${parts.join(' · ')}`;el.title='Cross-source / competitive / Commander intelligence context; does not change Scout grade';top.appendChild(el);
  });
}
function intelligenceRow(label,value,sub){return `<div class="cx-v5-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`}
function decorateScoutDetail(sku){
  const host=document.getElementById('cxParityDetail');if(!host||!sku)return;host.querySelector('.cx-intelligence-detail')?.remove();
  const row=scoutRows().find(r=>String(r.sku_id)===String(sku)),ctx=detailFor(row);if(!ctx.competitive.length&&!ctx.commander.length&&!ctx.cedh.length&&!ctx.cedhCards.length&&!ctx.crossSource.length)return;
  const pieces=[];
  if(ctx.crossSource.length){const x=ctx.crossSource[0],dynamic=Number(x.dynamic_sources||0)>0?` · ${x.dynamic_sources} changing/new`:'';pieces.push(intelligenceRow('Cross-source',`${x.evidence_sources||2} evidence families · score ${x.corroboration_score||'—'}`,`${x.watch_reason||'Independent sources align'}${dynamic}`))}
  if(ctx.competitive.length){const x=ctx.competitive[0];pieces.push(intelligenceRow('Competitive',`${x.deck_count_30d||0} decks · ${x.top8_decks_30d||0} Top 8`,`${x.format||'Competitive'} · PLAYED + SCOUT`))}
  if(ctx.commander.length){const x=ctx.commander[0],trend=x.rank_improvement_pct==null?'baseline':`${Number(x.rank_improvement_pct)>=0?'+':''}${Number(x.rank_improvement_pct).toFixed(0)}% rank move`;pieces.push(intelligenceRow('EDHREC',`#${x.edhrec_rank||'—'} · ${trend}`,`${String(x.watch_class||'').replace(/_/g,' ')} · ${x.edhrec_signal||'Commander demand'}`))}
  if(ctx.cedhCards.length){const x=ctx.cedhCards[0],label=x.watch_class==='cedh_breakout'?'BREAKOUT':x.watch_class==='cedh_recent_card'?'NEW / RECENT':'PLAYED + SCOUT';pieces.push(intelligenceRow('cEDH card',`${x.deck_count_30d||0}/${x.structured_decks_30d||'—'} structured lists · ${x.top16_decks_30d||0} Top 16`,`${x.share_30d_pct??'—'}% structured-list adoption · ${label}`))}
  if(ctx.cedh.length){const x=ctx.cedh[0];pieces.push(intelligenceRow('cEDH commander',`${x.entries_30d||x.entries||0} known entries · ${x.top16_entries||0} Top 16`,x.share_30d_pct!=null?`${x.share_30d_pct}% known-commander share`:'Tournament baseline'))}
  const section=document.createElement('section');section.className='cx-v5-section cx-intelligence-detail';section.innerHTML=`<div class="cx-section-title">Market intelligence <span class="cx-intel-context">context only</span></div><div class="cx-v5-grid">${pieces.join('')}</div><small class="cx-sub">Cross-source corroboration, Signals, competitive play, EDHREC and cEDH context do not change the Scout grade yet.</small>`;
  const anchor=host.querySelector('.cx-v5-components')||host.firstElementChild;if(anchor?.parentNode)anchor.parentNode.insertBefore(section,anchor.nextSibling);else host.appendChild(section);
}
function targetForIntelCard(card){const id=card?.dataset?.intelId;if(!id)return null;const item=(store.get().intel?.items||[]).find(x=>String(x.intel_id)===String(id));const entities=Array.isArray(item?.market_intel_entities)?item.market_intel_entities:[];for(const e of entities){const target={product_id:e.product_id,scryfall_id:e.scryfall_id,card_name:e.entity_name};if(matchScout(target))return target}const first=entities[0];return first?{product_id:first.product_id,scryfall_id:first.scryfall_id,card_name:first.entity_name}:null}
function targetForSignalEntity(el){const card=el.closest('.cx-signal-card');const id=card?.dataset?.intelId;const item=(store.get().intel?.items||[]).find(x=>String(x.intel_id)===String(id));const name=String(el.textContent||'').replace(/\s*✓\s*$/,'').trim();const entity=(item?.market_intel_entities||[]).find(e=>lower(e.entity_name)===lower(name));return entity?{product_id:entity.product_id,scryfall_id:entity.scryfall_id,card_name:entity.entity_name}:{card_name:name}}
function decorateSignalsLinks(){document.querySelectorAll('#cxSignalsFeed .cx-signal-card').forEach(card=>{const target=targetForIntelCard(card);if(!target)return;card.classList.add('cx-scout-deep-link');card.setAttribute('role','button');card.setAttribute('tabindex','0');card.title='Open linked card in Scout'});document.querySelectorAll('#cxCompetitiveIntel .cx-detail-stat').forEach(el=>{if(el.dataset.scoutLinked==='1')return;const name=el.querySelector('strong')?.textContent?.trim()||'';if(!name)return;el.dataset.scoutLinked='1';el.classList.add('cx-scout-deep-link');el.setAttribute('role','button');el.setAttribute('tabindex','0');el.title='Open this card in Scout'})}
function delegatedOpen(event){const blocked=event.target.closest?.('a,button,input,select,textarea,label');if(blocked)return;const entity=event.target.closest?.('#cxSignalsFeed .cx-signal-entities span');if(entity){const target=targetForSignalEntity(entity);if(target){event.preventDefault();openScout(target)}return}const signalCard=event.target.closest?.('#cxSignalsFeed .cx-signal-card');if(signalCard){const target=targetForIntelCard(signalCard);if(target){event.preventDefault();openScout(target)}return}const comp=event.target.closest?.('#cxCompetitiveIntel .cx-detail-stat');if(comp){const name=comp.querySelector('strong')?.textContent?.trim()||'';if(name){event.preventDefault();openScout({card_name:name})}}}
function delegatedKey(event){if(event.key!=='Enter'&&event.key!==' ')return;const el=event.target.closest?.('#cxSignalsFeed .cx-signal-card,#cxCompetitiveIntel .cx-detail-stat');if(!el)return;event.preventDefault();if(el.matches('.cx-signal-card')){const target=targetForIntelCard(el);if(target)openScout(target)}else{const name=el.querySelector('strong')?.textContent?.trim()||'';if(name)openScout({card_name:name})}}
async function load(){
  if(loading)return loading;
  loading=Promise.allSettled([
    rest('rpc/competitive_scout_opportunities',{method:'POST',body:{p_format:null}}),
    rest('rpc/commander_edh_opportunities',{method:'POST',body:{p_limit:150}}),
    rest('rpc/cedh_commander_rollups',{method:'POST',body:{p_days:90,p_min_event_size:16}}),
    rest('rpc/cedh_card_opportunities',{method:'POST',body:{p_days:90}}),
    rest('rpc/cross_source_market_watches',{method:'POST',body:{p_limit:100}})
  ]).then(([a,b,c,d,e])=>{competitive=a.status==='fulfilled'&&Array.isArray(a.value)?a.value:[];commander=b.status==='fulfilled'&&Array.isArray(b.value)?b.value:[];cedh=c.status==='fulfilled'&&Array.isArray(c.value)?c.value:[];cedhCards=d.status==='fulfilled'&&Array.isArray(d.value)?d.value:[];corroborated=e.status==='fulfilled'&&Array.isArray(e.value)?e.value:[];decorateScoutList();decorateScoutDetail(store.get().scout?.selectedSku||null);decorateSignalsLinks()}).finally(()=>{loading=null});
  return loading;
}

document.addEventListener('click',delegatedOpen,true);
document.addEventListener('keydown',delegatedKey,true);
document.addEventListener('collectish:scout-list-rendered',()=>{if(competitive.length||commander.length||cedh.length||cedhCards.length||corroborated.length)decorateScoutList();else void load()});
document.addEventListener('collectish:scout-detail-rendered',e=>{if(competitive.length||commander.length||cedh.length||cedhCards.length||corroborated.length)decorateScoutDetail(e.detail?.sku);else void load()});
document.addEventListener('collectish:intel-changed',()=>setTimeout(decorateSignalsLinks,0));
document.addEventListener('collectish:competitive-changed',()=>{loading=null;void load()});
document.addEventListener('collectish:commander-intel-changed',()=>{loading=null;void load()});
document.addEventListener('collectish:cross-source-changed',()=>{loading=null;void load()});
document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='signals')setTimeout(decorateSignalsLinks,60)});
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals')setTimeout(decorateSignalsLinks,80)});
document.addEventListener('collectish:open-scout-card',e=>openScout(e.detail||{}));
document.addEventListener('collectish:ready',()=>void load());

void load();
export { openScout as openScoutIntelligenceCard, load as loadScoutIntelligenceContext };
