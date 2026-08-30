import { rest } from '../../core/rest.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const DAYS=30;
let activeCard='';
let activeData=null;
let observer=null;

function fmtDate(v){
  if(!v)return 'Date unknown';
  const d=new Date(`${v}T12:00:00Z`);
  return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
}
function plural(n,word){return `${n} ${word}${Number(n)===1?'':'s'}`}
function unique(rows,key){return new Set(rows.map(r=>r?.[key]).filter(Boolean)).size}
function inFilter(values){return values.map(v=>String(v).replace(/[(),]/g,'')).join(',')}
function sourceLabel(e){return e?.primary_source==='mtgo'?'MTGO':String(e?.primary_source||'Source').toUpperCase()}
function coverageLabel(e){return e?.coverage_type==='curated_sample'?'curated sample':e?.coverage_type==='partial_event'?'published subset':e?.coverage_type==='complete_event'?'complete event':'coverage unknown'}
function drawer(){
  let d=document.getElementById('cxCompetitiveEvidence');
  if(d)return d;
  d=document.createElement('div');
  d.id='cxCompetitiveEvidence';
  d.className='cx-evidence-shell';
  d.setAttribute('aria-hidden','true');
  d.innerHTML=`<button class="cx-evidence-backdrop" type="button" aria-label="Close evidence"></button><aside class="cx-evidence-drawer" role="dialog" aria-modal="true" aria-labelledby="cxEvidenceTitle"><div id="cxEvidenceBody"></div></aside>`;
  document.body.appendChild(d);
  d.querySelector('.cx-evidence-backdrop')?.addEventListener('click',closeEvidence);
  return d;
}
function closeEvidence(){
  const d=document.getElementById('cxCompetitiveEvidence');
  if(!d)return;
  d.classList.remove('open');
  d.setAttribute('aria-hidden','true');
  document.body.classList.remove('cx-evidence-open');
}
function openShell(cardName){
  const d=drawer();
  activeCard=cardName;
  activeData=null;
  d.classList.add('open');
  d.setAttribute('aria-hidden','false');
  document.body.classList.add('cx-evidence-open');
  const body=d.querySelector('#cxEvidenceBody');
  if(body)body.innerHTML=headerHtml(cardName)+`<div class="cx-evidence-loading">Tracing competitive evidence…</div>`;
  requestAnimationFrame(()=>d.querySelector('.cx-evidence-close')?.focus());
}
function headerHtml(cardName,subtitle='Competitive evidence · last 30 days'){
  return `<div class="cx-evidence-head"><div><div class="cx-evidence-kicker">Signal evidence</div><h2 id="cxEvidenceTitle">${esc(cardName)}</h2><p>${esc(subtitle)}</p></div><button class="cx-evidence-close" type="button" aria-label="Close evidence">×</button></div>`;
}
function mergeAppearances(cardRows,deckMap,eventMap){
  const byDeck=new Map();
  for(const row of cardRows||[]){
    const deck=deckMap.get(row.deck_id);const event=deck?eventMap.get(deck.event_id):null;
    if(!deck||!event)continue;
    const current=byDeck.get(row.deck_id)||{deck,event,card_name:row.card_name,quantity:0,sections:new Set()};
    current.quantity+=Number(row.quantity||0);
    if(row.section)current.sections.add(row.section);
    byDeck.set(row.deck_id,current);
  }
  return [...byDeck.values()].map(a=>({...a,sections:[...a.sections]}));
}
async function fetchEvidence(cardName){
  const encoded=encodeURIComponent(cardName);
  const cardRows=await rest(`competitive_deck_cards?select=deck_id,section,quantity,card_name&card_name=eq.${encoded}&limit=500`);
  const deckIds=[...new Set((cardRows||[]).map(r=>r.deck_id).filter(Boolean))];
  if(!deckIds.length)return {cardName,appearances:[],decks:[],events:[]};
  const decks=await rest(`competitive_decks?select=deck_id,event_id,player_name,placement,record,source_url&deck_id=in.(${inFilter(deckIds)})&limit=500`);
  const eventIds=[...new Set((decks||[]).map(r=>r.event_id).filter(Boolean))];
  const events=eventIds.length?await rest(`competitive_events?select=event_id,event_name,format,event_type,event_date,primary_source,source_url,coverage_type,published_deck_count,player_count,coverage_note&event_id=in.(${inFilter(eventIds)})&limit=500`):[];
  const eventMap=new Map((events||[]).map(e=>[e.event_id,e]));
  const deckMap=new Map((decks||[]).map(d=>[d.deck_id,d]));
  const since=Date.now()-DAYS*86400000;
  const appearances=mergeAppearances(cardRows,deckMap,eventMap).filter(x=>{
    const t=x.event?.event_date?new Date(`${x.event.event_date}T12:00:00Z`).getTime():0;
    return !t||t>=since;
  }).sort((a,b)=>String(b.event.event_date||'').localeCompare(String(a.event.event_date||''))||Number(a.deck.placement||999)-Number(b.deck.placement||999));
  return {cardName,appearances,decks:appearances.map(a=>a.deck),events:[...new Map(appearances.map(a=>[a.event.event_id,a.event])).values()]};
}
function metricHtml(value,label){return `<div class="cx-evidence-metric"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`}
function overviewHtml(data){
  const {decks,events}=data;
  const pilots=unique(decks,'player_name');
  const top8=decks.filter(d=>Number(d.placement)>0&&Number(d.placement)<=8).length;
  const wins=decks.filter(d=>Number(d.placement)===1).length;
  const best=decks.reduce((n,d)=>{const p=Number(d.placement)||999;return Math.min(n,p)},999);
  const formats=[...new Set(events.map(e=>e.format).filter(Boolean))];
  const latest=events.map(e=>e.event_date).filter(Boolean).sort().at(-1);
  const summary=decks.length?`${plural(decks.length,'published deck')} across ${plural(events.length,'event')} and ${plural(pilots,'pilot')}${top8?`, including ${plural(top8,'Top 8')}`:''}.`:'No stored competitive deck evidence was found in this window.';
  return `<section class="cx-evidence-overview"><p class="cx-evidence-lede">${esc(summary)}</p><div class="cx-evidence-metrics">${metricHtml(decks.length,'decks')}${metricHtml(events.length,'events')}${metricHtml(pilots,'pilots')}${metricHtml(top8,'Top 8s')}</div><div class="cx-evidence-facts"><div><span>Formats</span><strong>${esc(formats.join(', ')||'Unknown')}</strong></div><div><span>Best finish</span><strong>${best<999?`#${best}`:'—'}${wins?` · ${wins} win${wins===1?'':'s'}`:''}</strong></div><div><span>Latest evidence</span><strong>${esc(fmtDate(latest))}</strong></div><div><span>Window</span><strong>${DAYS} days</strong></div></div><p class="cx-evidence-note">Deck counts reflect published lists we imported, not complete tournament metagame share unless the source explicitly reports complete coverage.</p></section>`;
}
function sectionSummary(a){
  const main=a.sections.includes('main'),side=a.sections.includes('side');
  if(main&&side)return 'main + side';
  if(side)return 'sideboard';
  return 'main';
}
function appearanceRow(a){
  const e=a.event,d=a.deck;
  const finish=Number(d.placement)>0?`#${d.placement}`:'Finish unknown';
  return `<button type="button" class="cx-evidence-appearance" data-deck-id="${esc(d.deck_id)}"><span class="cx-evidence-source">${esc(sourceLabel(e))}</span><span class="cx-evidence-appearance-main"><strong>${esc(e.event_name||'Competitive event')}</strong><small>${esc(`${fmtDate(e.event_date)} · ${e.format||'Unknown format'} · ${d.player_name||'Unknown pilot'}`)}</small></span><span class="cx-evidence-finish"><strong>${esc(finish)}</strong><small>${esc(`${a.quantity||0}× ${sectionSummary(a)}`)}</small></span><span class="cx-evidence-chevron">›</span></button>`;
}
function decksHtml(data){
  if(!data.appearances.length)return '<div class="cx-evidence-empty">No published deck appearances found in the last 30 days.</div>';
  return `<div class="cx-evidence-list">${data.appearances.map(appearanceRow).join('')}</div>`;
}
function sourcesHtml(data){
  if(!data.events.length)return '<div class="cx-evidence-empty">No source records found.</div>';
  const rows=[...data.events].sort((a,b)=>String(b.event_date||'').localeCompare(String(a.event_date||''))).map(e=>`<div class="cx-evidence-source-row"><div><strong>${esc(e.event_name||'Competitive event')}</strong><small>${esc(`${fmtDate(e.event_date)} · ${e.format||'Unknown format'} · ${coverageLabel(e)}`)}</small><small>${esc(`${e.published_deck_count??'—'} published decks${e.player_count?` · ${e.player_count} players`:''}`)}</small></div>${e.source_url?`<a href="${esc(e.source_url)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>`:''}</div>`).join('');
  return `<div class="cx-evidence-list">${rows}</div>`;
}
function renderEvidence(data,tab='overview'){
  const body=drawer().querySelector('#cxEvidenceBody');
  if(!body)return;
  activeData=data;
  const contents=tab==='decks'?decksHtml(data):tab==='sources'?sourcesHtml(data):overviewHtml(data);
  body.innerHTML=headerHtml(data.cardName)+`<div class="cx-evidence-tabs" role="tablist"><button type="button" data-evidence-tab="overview" class="${tab==='overview'?'active':''}">Overview</button><button type="button" data-evidence-tab="decks" class="${tab==='decks'?'active':''}">Decks <span>${data.decks.length}</span></button><button type="button" data-evidence-tab="sources" class="${tab==='sources'?'active':''}">Sources <span>${data.events.length}</span></button></div><div class="cx-evidence-content">${contents}</div>`;
  bindDrawerActions();
}
function bindDrawerActions(){
  const d=drawer();
  d.querySelector('.cx-evidence-close')?.addEventListener('click',closeEvidence);
  d.querySelectorAll('[data-evidence-tab]').forEach(btn=>btn.addEventListener('click',()=>{if(activeData)renderEvidence(activeData,btn.dataset.evidenceTab)}));
  d.querySelectorAll('[data-deck-id]').forEach(btn=>btn.addEventListener('click',()=>void openDeck(btn.dataset.deckId)));
}
async function openDeck(deckId){
  if(!activeData)return;
  const appearance=activeData.appearances.find(a=>a.deck.deck_id===deckId);
  if(!appearance)return;
  const body=drawer().querySelector('#cxEvidenceBody');
  if(body)body.innerHTML=headerHtml(activeCard,'Loading full deck list…')+`<div class="cx-evidence-loading">Loading deck…</div>`;
  try{
    const cards=await rest(`competitive_deck_cards?select=section,card_name,quantity&deck_id=eq.${encodeURIComponent(deckId)}&order=section.asc,card_name.asc&limit=200`);
    renderDeck(appearance,cards||[]);
  }catch(e){renderError(e)}
}
function cardSection(cards,section,label){
  const rows=cards.filter(c=>c.section===section).sort((a,b)=>String(a.card_name).localeCompare(String(b.card_name)));
  const total=rows.reduce((n,c)=>n+Number(c.quantity||0),0);
  return `<section class="cx-evidence-deck-section"><h3>${esc(label)} <span>${total}</span></h3><div>${rows.map(c=>`<div class="cx-evidence-card-row ${String(c.card_name).toLowerCase()===String(activeCard).toLowerCase()?'selected':''}"><strong>${esc(c.quantity)}×</strong><span>${esc(c.card_name)}</span></div>`).join('')}</div></section>`;
}
function renderDeck(a,cards){
  const body=drawer().querySelector('#cxEvidenceBody');if(!body)return;
  const e=a.event,d=a.deck;
  body.innerHTML=`<div class="cx-evidence-head cx-evidence-deck-head"><div><button class="cx-evidence-back" type="button">← All appearances</button><div class="cx-evidence-kicker">${esc(`${sourceLabel(e)} · ${e.format||'Competitive'}`)}</div><h2 id="cxEvidenceTitle">${esc(e.event_name||'Competitive event')}</h2><p>${esc(`${fmtDate(e.event_date)} · ${d.player_name||'Unknown pilot'}${Number(d.placement)>0?` · finish #${d.placement}`:''}${d.record?` · ${d.record}`:''}`)}</p></div><button class="cx-evidence-close" type="button" aria-label="Close evidence">×</button></div><div class="cx-evidence-deck-actions"><span>${esc(coverageLabel(e))}</span>${(d.source_url||e.source_url)?`<a href="${esc(d.source_url||e.source_url)}" target="_blank" rel="noopener noreferrer">View original event ↗</a>`:''}</div><div class="cx-evidence-deck-grid">${cardSection(cards,'main','Main deck')}${cardSection(cards,'side','Sideboard')}</div>`;
  body.querySelector('.cx-evidence-close')?.addEventListener('click',closeEvidence);
  body.querySelector('.cx-evidence-back')?.addEventListener('click',()=>renderEvidence(activeData,'decks'));
}
function renderError(error){
  const body=drawer().querySelector('#cxEvidenceBody');if(!body)return;
  body.innerHTML=headerHtml(activeCard)+`<div class="cx-evidence-empty"><strong>Evidence could not be loaded.</strong><p>${esc(error?.message||error||'Unknown error')}</p><button type="button" class="cx-evidence-retry">Try again</button></div>`;
  body.querySelector('.cx-evidence-close')?.addEventListener('click',closeEvidence);
  body.querySelector('.cx-evidence-retry')?.addEventListener('click',()=>void openEvidence(activeCard));
}
async function openEvidence(cardName){
  if(!cardName)return;
  openShell(cardName);
  try{renderEvidence(await fetchEvidence(cardName))}catch(e){renderError(e)}
}
function cardNameForRow(row){
  const strong=row.querySelector('span:first-child > strong');
  return strong?.textContent?.trim()||'';
}
function enhanceRows(root=document){
  const candidates=[];
  if(root.matches?.('#cxCompetitiveIntel .cx-detail-stat:not([data-evidence-ready])'))candidates.push(root);
  root.querySelectorAll?.('#cxCompetitiveIntel .cx-detail-stat:not([data-evidence-ready])').forEach(row=>candidates.push(row));
  candidates.forEach(row=>{
    const cardName=cardNameForRow(row);if(!cardName)return;
    row.dataset.evidenceReady='1';row.classList.add('cx-competitive-evidence-row');row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-label',`View competitive evidence for ${cardName}`);
    const action=document.createElement('button');action.type='button';action.className='cx-evidence-row-action';action.textContent='View evidence →';action.addEventListener('click',e=>{e.stopPropagation();void openEvidence(cardName)});row.appendChild(action);
    row.addEventListener('click',e=>{if(e.target.closest('a,button'))return;void openEvidence(cardName)});
    row.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&!e.target.closest('button')){e.preventDefault();void openEvidence(cardName)}});
  });
}
function install(){
  enhanceRows();
  observer=new MutationObserver(muts=>{for(const m of muts)for(const n of m.addedNodes)if(n.nodeType===1)enhanceRows(n)});
  observer.observe(document.body,{childList:true,subtree:true});
  document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals')queueMicrotask(()=>enhanceRows())});
  document.addEventListener('keydown',e=>{const d=document.getElementById('cxCompetitiveEvidence');if(e.key==='Escape'&&d?.classList.contains('open'))closeEvidence()});
}

install();
export { openEvidence as openCompetitiveEvidence };
