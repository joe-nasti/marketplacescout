import { rest } from '../../core/rest.js';
import { validSession } from '../../core/session.js';
import { collectishConfig } from '../../core/config.js';

let rows=[];
let events=[];
let loading=null;
let lastLoadedAt=0;
let syncMessage='';
let loadWarning='';
const AUTO_REFRESH_MS=5*60*1000;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtDate=v=>{if(!v)return'—';const d=new Date(`${v}T00:00:00Z`);return Number.isNaN(d.getTime())?'—':d.toLocaleDateString(undefined,{year:'numeric',month:'short'})};
const watchLabel=v=>({standard_watch:'STANDARD WATCH',recent_card:'RECENT CARD',adoption_breakout:'BREAKOUT',constrained_old_card:'SUPPLY WATCH',constrained_variant:'VARIANT WATCH'}[v]||'WATCH');
const watchClass=v=>v==='adoption_breakout'?'leading':v==='standard_watch'||v==='recent_card'?'confirming':'unclassified';
function host(){return document.getElementById('cxSignals')}
function signalsReady(){return host()?.dataset.cxLazyReady==='1'}
function coverageLabel(e){return e?.coverage_type==='curated_sample'?'curated sample':e?.coverage_type==='partial_event'?'published subset':e?.coverage_type==='complete_event'?'complete event':'coverage unknown'}
function actionable(r){const decks=Number(r.deck_count_30d||0),top8=Number(r.top8_decks_30d||0);if(r.watch_class==='standard_watch')return decks>=2||top8>=1;if(r.watch_class==='recent_card')return decks>=3||top8>=1;if(r.watch_class==='adoption_breakout')return true;return decks>=3&&top8>=1}
function groupedRows(){const clean=rows.filter(actionable);return {
  fresh:clean.filter(r=>['standard_watch','recent_card','adoption_breakout'].includes(r.watch_class)).slice(0,8),
  constrained:clean.filter(r=>['constrained_old_card','constrained_variant'].includes(r.watch_class)).slice(0,6)
}}
function rowHtml(r){
  const history=Number(r.prior_event_count_30d||0)>0?`${r.decks_7d} recent vs ${r.decks_prev_7d} prior`:'Initial competitive baseline';
  const supply=`Direct ${r.direct_available??'—'} · Scout ${r.opportunity_score??'—'} · ${r.card_set_count??'—'} known set${Number(r.card_set_count)===1?'':'s'}`;
  const print=`${r.set_name||'Unknown printing'} · ${r.printing||'printing unknown'} · selected ${fmtDate(r.selected_release_date)}`;
  return `<div class="cx-detail-stat"><span><strong>${esc(r.card_name)}</strong><small>${esc(`${r.format||'Unknown'} · ${r.deck_count_30d} decks · ${r.top8_decks_30d} Top 8 · ${history}`)}</small><small>${esc(print)}</small></span><span><strong><span class="cx-signal-stage ${watchClass(r.watch_class)}">${esc(watchLabel(r.watch_class))}</span> <span class="cx-signal-stage confirming">${esc(`PRIORITY ${r.financial_priority}`)}</span></strong><small>${esc(supply)}</small><small>${esc(r.watch_reason||'')}</small></span></div>`;
}
function sectionHtml(title,sub,items){return `<div class="cx-section-title">${esc(title)}</div><p class="cx-sub">${esc(sub)}</p><div class="cx-detail-list">${items.length?items.map(rowHtml).join(''):'<div class="cx-empty">Nothing qualifies yet.</div>'}</div>`}
function render(){
  const h=host();if(!h||!signalsReady())return;
  let panel=document.getElementById('cxCompetitiveIntel');
  if(!panel){panel=document.createElement('section');panel.id='cxCompetitiveIntel';panel.className='cx-card';const layout=h.querySelector('.cx-signals-layout');if(layout)layout.insertAdjacentElement('beforebegin',panel);else h.appendChild(panel)}
  const {fresh,constrained}=groupedRows();
  const latest=events.slice(0,5).map(e=>`${e.event_name} · ${coverageLabel(e)}`).join(' · ');
  const hasTrend=rows.some(r=>Number(r.prior_event_count_30d||0)>0);
  const baselineNote=hasTrend?'Competitive history is available for at least one format; breakout labels require prior imported events.':'MarketplaceScout is still establishing its competitive baseline. Current results show adoption, not week-over-week momentum yet.';
  const empty=loading?'<div class="cx-empty">Loading financially actionable competitive watches…</div>':'';
  panel.innerHTML=`<div class="cx-page-head"><div><div class="cx-section-title">Competitive watch</div><p class="cx-sub">Tournament play is only surfaced when MarketplaceScout sees a plausible financial reason to care. Established staples are hidden unless adoption is actually accelerating or a specific printing is supply-constrained.</p></div><button type="button" class="cx-refresh" id="cxRefreshMtgo">Refresh MTGO</button></div><p class="cx-sub">${esc(baselineNote)}</p>${latest?`<p class="cx-sub">Coverage: ${esc(latest)}</p>`:''}${loadWarning?`<p class="cx-sub">${esc(loadWarning)}</p>`:''}${empty}${!loading?sectionHtml('New / emerging cards','Prioritize Standard and recently released cards where competitive demand can still change the market.',fresh):''}${!loading?sectionHtml('Constrained older printings','Older cards only appear when the selected printing has a specific supply/reprint case.',constrained):''}<div id="cxCompetitiveMsg" class="cx-sub">${esc(syncMessage)}</div>`;
  document.getElementById('cxRefreshMtgo')?.addEventListener('click',sync);
}
async function load({force=false}={}){
  if(loading)return loading;
  if(!force&&lastLoadedAt&&Date.now()-lastLoadedAt<AUTO_REFRESH_MS){render();return rows}
  const since=new Date(Date.now()-30*86400000).toISOString().slice(0,10);loadWarning='';
  const jobs=[rest('rpc/competitive_financial_opportunities',{method:'POST',body:{p_format:null}}),rest(`competitive_events?select=event_name,format,event_date,published_deck_count,coverage_type&event_date=gte.${since}&order=event_date.desc,fetched_at.desc&limit=20`)];
  loading=Promise.allSettled(jobs).then(([r,e])=>{if(r.status==='fulfilled')rows=Array.isArray(r.value)?r.value:[];else{rows=[];loadWarning='Tournament coverage loaded, but financial matching is temporarily unavailable.'}if(e.status==='fulfilled')events=Array.isArray(e.value)?e.value:[];lastLoadedAt=Date.now();return rows}).finally(()=>{loading=null;render()});
  render();return loading;
}
function ensureLoaded(){if(!signalsReady())return;render();void load().catch(()=>{})}
async function sync(){
  const btn=document.getElementById('cxRefreshMtgo');const original=btn?.textContent||'Refresh MTGO';const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),65000);
  if(btn){btn.disabled=true;btn.textContent='Refreshing…'}syncMessage='Importing the next recent Standard/Pioneer/Modern/Legacy premier results…';render();
  try{const session=await validSession();if(!session)throw new Error('Sign in required');const r=await fetch(`${collectishConfig.supabaseUrl}/functions/v1/competitive-mtgo-sync`,{method:'POST',signal:controller.signal,headers:{apikey:collectishConfig.publishableKey,Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},body:JSON.stringify({limit:4,prefer_formats:['Standard','Pioneer','Modern','Legacy'],skip_imported:true})});const text=await r.text();let data;try{data=text?JSON.parse(text):{}}catch{data={error:text}};if(!r.ok)throw new Error(data?.error||`MTGO sync HTTP ${r.status}`);syncMessage=`Imported ${data.events||0} new event${Number(data.events)===1?'':'s'}, ${data.decks||0} decks and ${data.cards||0} card rows.${data.skipped_imported?` Skipped ${data.skipped_imported} already-imported event${Number(data.skipped_imported)===1?'':'s'}.`:''}`;lastLoadedAt=0;await load({force:true});document.dispatchEvent(new CustomEvent('collectish:competitive-changed',{detail:data}))}catch(e){syncMessage=e?.name==='AbortError'?'MTGO refresh timed out after 65 seconds.':(e?.message||'Could not refresh MTGO results.');render()}finally{clearTimeout(timer);const current=document.getElementById('cxRefreshMtgo');if(current){current.disabled=false;current.textContent=original}}
}
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals'&&signalsReady())queueMicrotask(ensureLoaded)});
document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='signals')queueMicrotask(ensureLoaded)});
document.addEventListener('collectish:competitive-changed',()=>{lastLoadedAt=0;if(signalsReady())void load({force:true})});
if(signalsReady())queueMicrotask(ensureLoaded);
export {load as loadCompetitiveIntel,sync as syncCompetitiveMtgo};