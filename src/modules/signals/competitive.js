import { rest } from '../../core/rest.js';
import { validSession } from '../../core/session.js';
import { collectishConfig } from '../../core/config.js';

let emergingRows=[];
let establishedRows=[];
let events=[];
let loading=null;
let lastLoadedAt=0;
let syncMessage='';
let loadWarning='';
const AUTO_REFRESH_MS=5*60*1000;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=v=>v==null?'—':`$${Number(v).toFixed(2)}`;
const pct=v=>v==null?'—':`${Number(v)>=0?'+':''}${Number(v).toFixed(0)}%`;
const fmtDate=v=>{if(!v)return'—';const d=new Date(`${v}T00:00:00Z`);return Number.isNaN(d.getTime())?'—':d.toLocaleDateString(undefined,{year:'numeric',month:'short'})};
const watchLabel=v=>({standard_watch:'STANDARD WATCH',recent_card:'RECENT CARD',adoption_breakout:'BREAKOUT',constrained_old_card:'SUPPLY WATCH',constrained_variant:'VARIANT WATCH'}[v]||'WATCH');
const watchClass=v=>v==='adoption_breakout'?'leading':v==='standard_watch'||v==='recent_card'?'confirming':'unclassified';
function host(){return document.getElementById('cxSignals')}
function signalsReady(){return host()?.dataset.cxLazyReady==='1'}
function coverageLabel(e){return e?.coverage_type==='curated_sample'?'curated sample':e?.coverage_type==='partial_event'?'published subset':e?.coverage_type==='complete_event'?'complete event':'coverage unknown'}
function actionable(r){const decks=Number(r.deck_count_30d||0),top8=Number(r.top8_decks_30d||0);if(r.watch_class==='standard_watch')return decks>=2||top8>=1;if(r.watch_class==='recent_card')return decks>=3||top8>=1;if(r.watch_class==='adoption_breakout')return true;return decks>=3&&top8>=1}
function emergingGroups(){const clean=emergingRows.filter(actionable);return {
  breakout:clean.filter(r=>r.watch_class==='adoption_breakout').slice(0,8),
  fresh:clean.filter(r=>['standard_watch','recent_card'].includes(r.watch_class)).slice(0,8),
  constrained:clean.filter(r=>['constrained_old_card','constrained_variant'].includes(r.watch_class)).slice(0,6)
}}
function establishedScore(r){const decks=Number(r.deck_count_30d||0),top8=Number(r.top8_decks_30d||0),scout=Number(r.opportunity_score||0),qty=Number(r.direct_available);const scarcity=Number.isFinite(qty)?Math.max(0,Math.min(25,25-qty/5)):0;return Math.round(Math.min(100,scout*.55+Math.min(30,decks*1.2)+Math.min(20,top8*2.5)+scarcity*.35))}
function establishedList(){return establishedRows.filter(r=>r.product_id&&Number(r.deck_count_30d||0)>=2).sort((a,b)=>establishedScore(b)-establishedScore(a)||Number(b.top8_decks_30d)-Number(a.top8_decks_30d)||Number(b.deck_count_30d)-Number(a.deck_count_30d)).slice(0,10)}
function emergingRowHtml(r){
  const history=Number(r.prior_event_count_30d||0)>0?`${r.decks_7d} recent vs ${r.decks_prev_7d} prior`:'Initial competitive baseline';
  const supply=`Direct ${r.direct_available??'—'} · Scout ${r.opportunity_score??'—'} · ${r.card_set_count??'—'} known set${Number(r.card_set_count)===1?'':'s'}`;
  const print=`${r.set_name||'Unknown printing'} · ${r.printing||'printing unknown'} · selected ${fmtDate(r.selected_release_date)}`;
  return `<div class="cx-detail-stat"><span><strong>${esc(r.card_name)}</strong><small>${esc(`${r.format||'Unknown'} · ${r.deck_count_30d} decks · ${r.top8_decks_30d} Top 8 · ${history}`)}</small><small>${esc(print)}</small></span><span><strong><span class="cx-signal-stage ${watchClass(r.watch_class)}">${esc(watchLabel(r.watch_class))}</span> <span class="cx-signal-stage confirming">${esc(`PRIORITY ${r.financial_priority}`)}</span></strong><small>${esc(supply)}</small><small>${esc(r.watch_reason||'')}</small></span></div>`;
}
function establishedRowHtml(r){
  const market=Number(r.market_price),direct=Number(r.direct_low);const spread=market>0&&direct>0?(direct-market)/market*100:null;
  const play=`${r.format||'Unknown'} · ${r.deck_count_30d} published decks · ${r.top8_decks_30d} Top 8${Number(r.wins_30d||0)?` · ${r.wins_30d} win${Number(r.wins_30d)===1?'':'s'}`:''}`;
  const print=`${r.set_name||'Unknown printing'} · ${r.printing||'printing unknown'}`;
  const setup=`Market ${money(r.market_price)} · Direct ${money(r.direct_low)} · ${r.direct_available??'—'} Direct qty · spread ${pct(spread)}`;
  return `<div class="cx-detail-stat"><span><strong>${esc(r.card_name)}</strong><small>${esc(play)}</small><small>${esc(print)}</small></span><span><strong><span class="cx-signal-stage neutral">PLAYED + SCOUT</span> <span class="cx-signal-stage confirming">${esc(`SETUP ${establishedScore(r)}`)}</span></strong><small>${esc(setup)}</small><small>${esc(`Scout ${r.opportunity_score??'—'} · established competitive usage; this label does not imply new adoption.`)}</small></span></div>`;
}
function sectionHtml(title,sub,items,rowFn){return `<div class="cx-section-title">${esc(title)}</div><p class="cx-sub">${esc(sub)}</p><div class="cx-detail-list">${items.length?items.map(rowFn).join(''):'<div class="cx-empty">Nothing qualifies yet.</div>'}</div>`}
function render(){
  const h=host();if(!h||!signalsReady())return;
  let panel=document.getElementById('cxCompetitiveIntel');
  if(!panel){panel=document.createElement('section');panel.id='cxCompetitiveIntel';panel.className='cx-card';const layout=h.querySelector('.cx-signals-layout');if(layout)layout.insertAdjacentElement('beforebegin',panel);else h.appendChild(panel)}
  const established=establishedList();const {breakout,fresh,constrained}=emergingGroups();
  const latest=events.slice(0,5).map(e=>`${e.event_name} · ${coverageLabel(e)}`).join(' · ');
  const hasTrend=emergingRows.some(r=>Number(r.prior_event_count_30d||0)>0);
  const baselineNote=hasTrend?'Competitive history is available for at least one format; BREAKOUT requires prior imported events.':'MarketplaceScout is still establishing its competitive baseline. Current results show adoption, not week-over-week momentum yet.';
  const empty=loading?'<div class="cx-empty">Loading competitive lenses…</div>':'';
  panel.innerHTML=`<div class="cx-page-head"><div><div class="cx-section-title">Competitive watch</div><p class="cx-sub">Two separate lenses: established competitive cards with attractive Scout setups, and emerging competitive demand that may create a new financial opportunity.</p></div><button type="button" class="cx-refresh" id="cxRefreshMtgo">Refresh now</button></div><p class="cx-sub">MTGO competitive results refresh automatically every 6 hours. Use Refresh now only for an on-demand check.</p><p class="cx-sub">${esc(baselineNote)}</p>${latest?`<p class="cx-sub">Coverage: ${esc(latest)}</p>`:''}${loadWarning?`<p class="cx-sub">${esc(loadWarning)}</p>`:''}${empty}${!loading?sectionHtml('Established competitive + Scout setups','Heavily played cards whose selected printing currently has a decent Scout setup. Useful even when the competitive demand is not new.',established,establishedRowHtml):''}${!loading&&breakout.length?sectionHtml('Newly competitive / adoption breakouts','Cards whose competitive adoption is increasing versus prior imported events and whose Scout setup gives that change financial relevance.',breakout,emergingRowHtml):''}${!loading?sectionHtml('New / recent competitive cards','Standard and relatively recent cards already seeing meaningful competitive play. Until enough history exists, these are baseline watch candidates—not claimed breakouts.',fresh,emergingRowHtml):''}${!loading?sectionHtml('Constrained printing watches','Older cards where the actionable competitive thesis is about a specific printing or supply/reprint setup.',constrained,emergingRowHtml):''}<div id="cxCompetitiveMsg" class="cx-sub">${esc(syncMessage)}</div>`;
  document.getElementById('cxRefreshMtgo')?.addEventListener('click',sync);
}
async function load({force=false}={}){
  if(loading)return loading;
  if(!force&&lastLoadedAt&&Date.now()-lastLoadedAt<AUTO_REFRESH_MS){render();return emergingRows}
  const since=new Date(Date.now()-30*86400000).toISOString().slice(0,10);loadWarning='';
  const jobs=[
    rest('rpc/competitive_financial_opportunities',{method:'POST',body:{p_format:null}}),
    rest('rpc/competitive_scout_opportunities',{method:'POST',body:{p_format:null}}),
    rest(`competitive_events?select=event_name,format,event_date,published_deck_count,coverage_type&event_date=gte.${since}&order=event_date.desc,fetched_at.desc&limit=20`)
  ];
  loading=Promise.allSettled(jobs).then(([em,est,e])=>{
    if(em.status==='fulfilled')emergingRows=Array.isArray(em.value)?em.value:[];else{emergingRows=[];loadWarning='Emerging competitive matching is temporarily unavailable.'}
    if(est.status==='fulfilled')establishedRows=Array.isArray(est.value)?est.value:[];else{establishedRows=[];loadWarning=loadWarning||'Established competitive Scout matching is temporarily unavailable.'}
    if(e.status==='fulfilled')events=Array.isArray(e.value)?e.value:[];
    lastLoadedAt=Date.now();return emergingRows;
  }).finally(()=>{loading=null;render()});
  render();return loading;
}
function ensureLoaded(){if(!signalsReady())return;render();void load().catch(()=>{})}
async function sync(){
  const btn=document.getElementById('cxRefreshMtgo');const original=btn?.textContent||'Refresh now';const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),65000);
  if(btn){btn.disabled=true;btn.textContent='Refreshing…'}syncMessage='Importing the next recent Standard/Pioneer/Modern/Legacy premier results…';render();
  try{const session=await validSession();if(!session)throw new Error('Sign in required');const r=await fetch(`${collectishConfig.supabaseUrl}/functions/v1/competitive-mtgo-sync`,{method:'POST',signal:controller.signal,headers:{apikey:collectishConfig.publishableKey,Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},body:JSON.stringify({limit:4,prefer_formats:['Standard','Pioneer','Modern','Legacy'],skip_imported:true})});const text=await r.text();let data;try{data=text?JSON.parse(text):{}}catch{data={error:text}};if(!r.ok)throw new Error(data?.error||`MTGO sync HTTP ${r.status}`);syncMessage=`Imported ${data.events||0} new event${Number(data.events)===1?'':'s'}, ${data.decks||0} decks and ${data.cards||0} card rows.${data.skipped_imported?` Skipped ${data.skipped_imported} already-imported event${Number(data.skipped_imported)===1?'':'s'}.`:''}`;lastLoadedAt=0;await load({force:true});document.dispatchEvent(new CustomEvent('collectish:competitive-changed',{detail:data}))}catch(e){syncMessage=e?.name==='AbortError'?'MTGO refresh timed out after 65 seconds.':(e?.message||'Could not refresh MTGO results.');render()}finally{clearTimeout(timer);const current=document.getElementById('cxRefreshMtgo');if(current){current.disabled=false;current.textContent=original}}
}
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals'&&signalsReady())queueMicrotask(ensureLoaded)});
document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='signals')queueMicrotask(ensureLoaded)});
document.addEventListener('collectish:competitive-changed',()=>{lastLoadedAt=0;if(signalsReady())void load({force:true})});
if(signalsReady())queueMicrotask(ensureLoaded);
export {load as loadCompetitiveIntel,sync as syncCompetitiveMtgo};