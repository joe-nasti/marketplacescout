import store from '../../state/store.js';
import { rest } from '../../core/rest.js';

let competitive=[];
let commander=[];
let cedh=[];
let cedhCards=[];
let corroborated=[];
let loading=null;
let originIntelId=null;
const lower=s=>String(s||'').trim().toLowerCase();
const baseName=s=>String(s||'').replace(/\s*\([^)]*(foil|showcase|borderless|extended art|serialized|retro frame|etched|alternate art|halo foil|rainbow foil|surge foil|galaxy foil)[^)]*\)\s*/ig,' ').replace(/\s+/g,' ').trim();
const slug=s=>String(s||'').normalize('NFKD').replace(/[’']/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase();
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function scoutRows(){return store.get().scout?.rows||[]}
function intelItems(){return Array.isArray(store.get().intel?.items)?store.get().intel.items:[]}
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
function openScout(target){originIntelId=target?.origin_intel_id||null;window.CollectishShell?.switchPage?.('scout');const attempts=[0,60,140,280,500,900,1500,2400];let done=false;for(const ms of attempts)setTimeout(()=>{if(!done)done=tryOpenTarget(target)},ms)}
function signalMatchesRow(item,row){
  if(!item||!row)return false;
  const sku=String(row.sku_id||''),pid=String(row.product_id||''),sf=String(row.scryfall_id||''),name=lower(baseName(row.product_name));
  const entities=Array.isArray(item.market_intel_entities)?item.market_intel_entities:[];
  if(entities.some(e=>(sku&&String(e.sku_id||'')===sku)||(pid&&String(e.product_id||'')===pid)||(sf&&String(e.scryfall_id||'')===sf)||lower(baseName(e.entity_name))===name))return true;
  const mentions=Array.isArray(item.market_intel_card_mentions)?item.market_intel_card_mentions:[];
  return mentions.some(m=>(sf&&String(m.scryfall_id||'')===sf)||lower(baseName(m.card_name))===name);
}
function signalCatalysts(row){
  const rows=intelItems().filter(item=>signalMatchesRow(item,row));
  rows.sort((a,b)=>{
    const aOrigin=originIntelId&&String(a.intel_id)===String(originIntelId)?1:0,bOrigin=originIntelId&&String(b.intel_id)===String(originIntelId)?1:0;
    if(aOrigin!==bOrigin)return bOrigin-aOrigin;
    return new Date(b.observed_at||0)-new Date(a.observed_at||0);
  });
  return rows.slice(0,6);
}
function detailFor(row){
  if(!row)return{competitive:[],commander:[],cedh:[],cedhCards:[],crossSource:[],signals:[]};
  const name=lower(baseName(row.product_name)),pid=String(row.product_id||''),sku=String(row.sku_id||'');
  const match=x=>(sku&&String(x.sku_id||'')===sku)||(pid&&String(x.product_id||'')===pid);
  const comp=competitive.filter(x=>match(x)||lower(baseName(x.card_name))===name);
  const edh=commander.filter(x=>match(x)||lower(baseName(x.card_name))===name);
  const c=cedh.filter(x=>match(x)||lower(baseName(x.commander))===name);
  const cc=cedhCards.filter(x=>match(x)||lower(baseName(x.card_name))===name);
  const multi=corroborated.filter(x=>match(x)||lower(baseName(x.card_name))===name);
  return{competitive:comp,commander:edh,cedh:c,cedhCards:cc,crossSource:multi,signals:signalCatalysts(row)};
}
function canonicalEdhrecRank(row,ctx){
  const exact=Number(row?.edhrec_rank||0);if(exact>0)return exact;
  const oracle=lower(baseName(row?.product_name));
  const sibling=scoutRows().find(x=>lower(baseName(x.product_name))===oracle&&Number(x.edhrec_rank||0)>0);
  if(Number(sibling?.edhrec_rank||0)>0)return Number(sibling.edhrec_rank);
  const intel=(ctx?.commander||[]).find(x=>Number(x.edhrec_rank||0)>0);
  return Number(intel?.edhrec_rank||0);
}
function hydrateOracleDetail(host,row,ctx){
  if(!host||!row)return;
  const rank=canonicalEdhrecRank(row,ctx);
  if(rank>0){const tile=[...host.querySelectorAll('.cx-v5-stat')].find(x=>x.querySelector('span')?.textContent?.trim()==='EDHREC rank');const value=tile?.querySelector('strong');if(value)value.textContent=`#${rank.toLocaleString()}`}
  const edh=slug(baseName(row.product_name));
  if(edh){const link=[...host.querySelectorAll('.cx-v5-links a')].find(a=>a.textContent?.trim().startsWith('EDHREC'));if(link)link.href=`https://edhrec.com/cards/${edh}`}
}
function badgeSummary(ctx){
  const out=[];
  if(ctx.signals.length)out.push(`SIG ${ctx.signals.length}`);
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
    const el=document.createElement('span');el.className='cx-intel-mini cx-intelligence-mini';el.textContent=`◎ ${parts.join(' · ')}`;el.title='Signals, cross-source, competitive and Commander intelligence context; does not change Scout grade yet';top.appendChild(el);
  });
}
function intelligenceRow(label,value,sub){return `<div class="cx-v5-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`}
function catalystAge(value){if(!value)return'';const ms=Date.now()-new Date(value).getTime();if(!Number.isFinite(ms))return'';const hours=Math.max(0,Math.round(ms/3600000));if(hours<1)return'now';if(hours<24)return`${hours}h`;const days=Math.round(hours/24);return`${days}d`}
function catalystSource(item){return item.source_name||item.author||String(item.source_type||'Signal').replace(/_/g,' ')}
function catalystMarkup(items){
  if(!items.length)return'';
  return `<div class="cx-scout-catalysts"><div class="cx-scout-catalysts-head"><strong>Why this is showing up</strong><small>${items.length} linked signal${items.length===1?'':'s'}</small></div>${items.map(item=>{
    const opened=originIntelId&&String(item.intel_id)===String(originIntelId),stage=String(item.signal_stage||'unclassified').replace(/_/g,' '),direction=String(item.direction||'neutral').replace(/_/g,' '),summary=item.summary||item.title||'Linked market signal',source=catalystSource(item),time=catalystAge(item.observed_at),href=item.source_url?`<a href="${esc(item.source_url)}" target="_blank" rel="noopener">Source ↗</a>`:'';
    return `<article class="cx-scout-catalyst${opened?' is-origin':''}"><div class="cx-scout-catalyst-meta"><span class="cx-signal-stage ${esc(item.signal_stage||'unclassified')}">${esc(stage)}</span><span class="cx-signal-direction ${esc(item.direction||'neutral')}">${esc(direction)}</span><small>${esc(source)}${time?` · ${esc(time)}`:''}</small>${opened?'<b>Opened from Signals</b>':''}</div><p>${esc(summary)}</p>${href}</article>`;
  }).join('')}</div>`;
}
function decorateScoutDetail(sku){
  const host=document.getElementById('cxParityDetail');if(!host||!sku)return;host.querySelector('.cx-intelligence-detail')?.remove();
  const row=scoutRows().find(r=>String(r.sku_id)===String(sku)),ctx=detailFor(row);hydrateOracleDetail(host,row,ctx);if(!ctx.competitive.length&&!ctx.commander.length&&!ctx.cedh.length&&!ctx.cedhCards.length&&!ctx.crossSource.length&&!ctx.signals.length)return;
  const pieces=[];
  if(ctx.crossSource.length){const x=ctx.crossSource[0],dynamic=Number(x.dynamic_sources||0)>0?` · ${x.dynamic_sources} changing/new`:'';pieces.push(intelligenceRow('Cross-source',`${x.evidence_sources||2} evidence families · score ${x.corroboration_score||'—'}`,`${x.watch_reason||'Independent sources align'}${dynamic}`))}
  if(ctx.competitive.length){const x=ctx.competitive[0];pieces.push(intelligenceRow('Competitive',`${x.deck_count_30d||0} decks · ${x.top8_decks_30d||0} Top 8`,`${x.format||'Competitive'} · PLAYED + SCOUT`))}
  if(ctx.commander.length){const x=ctx.commander[0],trend=x.rank_improvement_pct==null?'baseline':`${Number(x.rank_improvement_pct)>=0?'+':''}${Number(x.rank_improvement_pct).toFixed(0)}% rank move`;pieces.push(intelligenceRow('EDHREC',`#${x.edhrec_rank||'—'} · ${trend}`,`${String(x.watch_class||'').replace(/_/g,' ')} · ${x.edhrec_signal||'Commander demand'}`))}
  if(ctx.cedhCards.length){const x=ctx.cedhCards[0],label=x.watch_class==='cedh_breakout'?'BREAKOUT':x.watch_class==='cedh_recent_card'?'NEW / RECENT':'PLAYED + SCOUT';pieces.push(intelligenceRow('cEDH card',`${x.deck_count_30d||0}/${x.structured_decks_30d||'—'} structured lists · ${x.top16_decks_30d||0} Top 16`,`${x.share_30d_pct??'—'}% structured-list adoption · ${label}`))}
  if(ctx.cedh.length){const x=ctx.cedh[0];pieces.push(intelligenceRow('cEDH commander',`${x.entries_30d||x.entries||0} known entries · ${x.top16_entries||0} Top 16`,x.share_30d_pct!=null?`${x.share_30d_pct}% known-commander share`:'Tournament baseline'))}
  const section=document.createElement('section');section.className='cx-v5-section cx-intelligence-detail';section.innerHTML=`<div class="cx-section-title">Market intelligence <span class="cx-intel-context">context only</span></div>${catalystMarkup(ctx.signals)}${pieces.length?`<div class="cx-v5-grid">${pieces.join('')}</div>`:''}<small class="cx-sub">Signals and corroborating evidence explain why this card deserves attention. They do not change the Scout grade yet.</small>`;
  const anchor=host.querySelector('.cx-v5-components')||host.firstElementChild;if(anchor?.parentNode)anchor.parentNode.insertBefore(section,anchor.nextSibling);else host.appendChild(section);
}
function verifiedCardEntity(e){return e?.entity_type==='card'&&!!(e?.scryfall_id||e?.product_id)}
function targetForIntelCard(card){const id=card?.dataset?.intelId;if(!id)return null;const item=intelItems().find(x=>String(x.intel_id)===String(id));const entities=(Array.isArray(item?.market_intel_entities)?item.market_intel_entities:[]).filter(verifiedCardEntity);for(const e of entities){const target={product_id:e.product_id,scryfall_id:e.scryfall_id,card_name:e.entity_name,origin_intel_id:id};if(matchScout(target))return target}const first=entities[0];return first?{product_id:first.product_id,scryfall_id:first.scryfall_id,card_name:first.entity_name,origin_intel_id:id}:null}
function targetForSignalEntity(el){const card=el.closest('.cx-signal-card');const id=card?.dataset?.intelId;const item=intelItems().find(x=>String(x.intel_id)===String(id));const name=String(el.textContent||'').replace(/\s*✓\s*$/,'').replace(/^(?:Card|Format|Set|Product|Other)\s*·\s*/i,'').trim();const entity=(item?.market_intel_entities||[]).find(e=>lower(e.entity_name)===lower(name));return verifiedCardEntity(entity)?{product_id:entity.product_id,scryfall_id:entity.scryfall_id,card_name:entity.entity_name,origin_intel_id:id}:null}
function decorateSignalsLinks(){document.querySelectorAll('#cxSignalsFeed .cx-signal-card').forEach(card=>{card.classList.remove('cx-scout-deep-link');card.removeAttribute('role');card.removeAttribute('tabindex');card.removeAttribute('title');const target=targetForIntelCard(card);if(!target)return;card.classList.add('cx-scout-deep-link');card.setAttribute('role','button');card.setAttribute('tabindex','0');card.title='Open linked card in Scout'});document.querySelectorAll('#cxCompetitiveIntel .cx-detail-stat').forEach(el=>{if(el.dataset.scoutLinked==='1')return;const name=el.querySelector('strong')?.textContent?.trim()||'';if(!name)return;el.dataset.scoutLinked='1';el.classList.add('cx-scout-deep-link');el.setAttribute('role','button');el.setAttribute('tabindex','0');el.title='Open this card in Scout'})}
function delegatedOpen(event){const blocked=event.target.closest?.('a,button,input,select,textarea,label');if(blocked)return;const entity=event.target.closest?.('#cxSignalsFeed .cx-signal-entities span');if(entity){const target=targetForSignalEntity(entity);if(target){event.preventDefault();openScout(target)}return}const signalCard=event.target.closest?.('#cxSignalsFeed .cx-signal-card');if(signalCard){const target=targetForIntelCard(signalCard);if(target){event.preventDefault();openScout(target)}return}const comp=event.target.closest?.('#cxCompetitiveIntel .cx-detail-stat');if(comp){const name=comp.querySelector('strong')?.textContent?.trim()||'';if(name){event.preventDefault();openScout({card_name:name})}}}
function delegatedKey(event){if(event.key!=='Enter'&&event.key!==' ')return;const el=event.target.closest?.('#cxSignalsFeed .cx-signal-card,#cxCompetitiveIntel .cx-detail-stat');if(!el)return;event.preventDefault();if(el.matches('.cx-signal-card')){const target=targetForIntelCard(el);if(target)openScout(target)}else{const name=el.querySelector('strong')?.textContent?.trim()||'';if(name)openScout({card_name:name})}}
async function load(){
  if(loading)return loading;
  const shared=store.get().intel||{},sharedRows=Array.isArray(shared.crossSourceRows)?shared.crossSourceRows:[],freshShared=sharedRows.length&&Date.now()-Number(shared.crossSourceLoadedAt||0)<5*60*1000;
  loading=Promise.allSettled([
    rest('rpc/competitive_scout_opportunities',{method:'POST',body:{p_format:null}}),
    rest('rpc/commander_edh_opportunities',{method:'POST',body:{p_limit:150}}),
    rest('rpc/cedh_commander_rollups',{method:'POST',body:{p_days:90,p_min_event_size:16}}),
    rest('rpc/cedh_card_opportunities',{method:'POST',body:{p_days:90}}),
    freshShared?Promise.resolve(sharedRows):rest('rpc/cross_source_market_watches',{method:'POST',body:{p_limit:100}})
  ]).then(([a,b,c,d,e])=>{
    competitive=a.status==='fulfilled'&&Array.isArray(a.value)?a.value:[];
    commander=b.status==='fulfilled'&&Array.isArray(b.value)?b.value:[];
    cedh=c.status==='fulfilled'&&Array.isArray(c.value)?c.value:[];
    cedhCards=d.status==='fulfilled'&&Array.isArray(d.value)?d.value:[];
    corroborated=e.status==='fulfilled'&&Array.isArray(e.value)?e.value:[];
    if(!freshShared&&corroborated.length)store.update('intel',{crossSourceRows:corroborated,crossSourceLoadedAt:Date.now()});
    decorateScoutList();decorateScoutDetail(store.get().scout?.selectedSku||null);decorateSignalsLinks();
  }).finally(()=>{loading=null});
  return loading;
}

document.addEventListener('click',delegatedOpen,true);
document.addEventListener('keydown',delegatedKey,true);
document.addEventListener('collectish:scout-list-rendered',()=>{if(competitive.length||commander.length||cedh.length||cedhCards.length||corroborated.length||intelItems().length)decorateScoutList();else void load()});
document.addEventListener('collectish:scout-detail-rendered',e=>{if(competitive.length||commander.length||cedh.length||cedhCards.length||corroborated.length||intelItems().length)decorateScoutDetail(e.detail?.sku);else void load()});
document.addEventListener('collectish:intel-changed',()=>{decorateScoutList();decorateScoutDetail(store.get().scout?.selectedSku||null);setTimeout(decorateSignalsLinks,0)});
document.addEventListener('collectish:competitive-changed',()=>{loading=null;void load()});
document.addEventListener('collectish:commander-intel-changed',()=>{loading=null;void load()});
document.addEventListener('collectish:cross-source-changed',e=>{if(Array.isArray(e.detail?.rows)){corroborated=e.detail.rows;decorateScoutList();decorateScoutDetail(store.get().scout?.selectedSku||null)}});
document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='signals')setTimeout(decorateSignalsLinks,60)});
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals')setTimeout(decorateSignalsLinks,80)});
document.addEventListener('collectish:open-scout-card',e=>openScout(e.detail||{}));
document.addEventListener('collectish:ready',()=>void load());

void load();
export { openScout as openScoutIntelligenceCard, load as loadScoutIntelligenceContext };
