import { rest } from '../../core/rest.js';
import { validSession } from '../../core/session.js';
import { collectishConfig } from '../../core/config.js';

let rows=[];
let events=[];
let deckEventIds=[];
let loading=null;
let syncMessage='';
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pct=v=>v==null?'—':`${Number(v)>=0?'+':''}${Number(v).toFixed(1)}%`;
const stageClass=s=>s==='early'?'leading':s==='confirming'?'confirming':s==='late'?'lagging':'unclassified';
const BASIC_NAMES=new Set(['plains','island','swamp','mountain','forest','wastes','snow-covered plains','snow-covered island','snow-covered swamp','snow-covered mountain','snow-covered forest']);

function host(){return document.getElementById('cxSignals')}
function coverageLabel(e){return e?.coverage_type==='curated_sample'?'curated sample':e?.coverage_type==='partial_event'?'published event subset':e?.coverage_type==='complete_event'?'complete event':'coverage unknown'}
function clamp(v,min=0,max=100){return Math.max(min,Math.min(max,Number(v)||0))}
function scarcityScore(qty){const q=Number(qty);if(!Number.isFinite(q))return 0;if(q<=2)return 100;if(q<=5)return 85;if(q<=10)return 70;if(q<=25)return 55;if(q<=50)return 40;if(q<=100)return 25;return 10}
function spreadPct(r){const market=Number(r.market_price),direct=Number(r.direct_low);return market>0&&direct>0?(direct-market)/market*100:null}
function normalizeFormat(v){return String(v||'Unknown').trim().toLowerCase()}
function isBasic(name){return BASIC_NAMES.has(String(name||'').trim().toLowerCase())}

function sampleContext(){
  const deckCounts=new Map();
  for(const row of deckEventIds)deckCounts.set(row.event_id,(deckCounts.get(row.event_id)||0)+1);
  const byFormat=new Map();
  for(const e of events){
    if(e.coverage_type==='curated_sample'||!Number(e.published_deck_count))continue;
    const key=normalizeFormat(e.format);
    const entry=byFormat.get(key)||{sampleDecks:0,eventCount:0,incomplete:false,completeEvents:0,coverageTypes:new Set()};
    const stored=deckCounts.get(e.event_id)||0;
    const published=Number(e.published_deck_count)||0;
    entry.eventCount++;
    entry.coverageTypes.add(e.coverage_type||'unknown');
    if(stored>=published){entry.sampleDecks+=published;entry.completeEvents++}else entry.incomplete=true;
    byFormat.set(key,entry);
  }
  return byFormat;
}

function rankedRows(){
  const contexts=sampleContext();
  const withheld={basics:0,premium:0,incomplete:0,unmatched:0};
  const ranked=[];
  for(const r of rows){
    if(isBasic(r.card_name)){withheld.basics++;continue}
    const ctx=contexts.get(normalizeFormat(r.format));
    if(!ctx||ctx.incomplete||!ctx.sampleDecks){withheld.incomplete++;continue}
    if(Number(r.event_count_30d||0)>ctx.completeEvents){withheld.incomplete++;continue}
    if(!r.product_id){withheld.unmatched++;continue}
    const decks=Number(r.deck_count_30d||0),top8=Number(r.top8_decks_30d||0);
    const adoption=ctx.sampleDecks?decks/ctx.sampleDecks*100:0;
    const conversion=decks?top8/decks*100:0;
    const scarcity=scarcityScore(r.direct_available);
    const spread=spreadPct(r);
    const premiumRisk=String(r.printing||'').toLowerCase()!=='normal';
    const obviousPremiumDistortion=premiumRisk&&spread!=null&&spread>=75;
    if(obviousPremiumDistortion){withheld.premium++;continue}
    const adoptionComponent=clamp(adoption*3);
    const conversionComponent=clamp(conversion*1.5);
    const scoutComponent=clamp(r.opportunity_score);
    const spreadComponent=spread==null?0:clamp(spread);
    const priority=clamp(Math.round(adoptionComponent*.25+conversionComponent*.20+scoutComponent*.25+scarcity*.20+spreadComponent*.10-(premiumRisk?10:0)));
    const marketMove=Number(r.market_change_7d_pct);
    let stage='watch';
    if(Number.isFinite(marketMove)&&marketMove>=25)stage='late';
    else if(adoption>=5&&top8>=2&&(!Number.isFinite(marketMove)||marketMove<8)&&Number(r.direct_available)<=25)stage='early';
    else if(adoption>=5&&top8>=1&&(!Number.isFinite(marketMove)||marketMove<25))stage='confirming';
    const reason=stage==='early'?'Competitive adoption + Top 8 results are strong while the selected Scout printing remains supply-tight.'
      :stage==='late'?'Competitive evidence is real, but Scout already shows a material market move.'
      :stage==='confirming'?'Tournament adoption is meaningful and the market setup is worth monitoring for follow-through.'
      :'Competitive evidence exists, but the market setup is not yet strong enough to elevate.';
    ranked.push({...r,sample_decks:ctx.sampleDecks,sample_event_count:ctx.completeEvents,sample_adoption_pct:adoption,top8_conversion_pct:conversion,scarcity_score:scarcity,direct_spread_pct:spread,competitive_priority:priority,premium_risk:premiumRisk,competitive_stage_v2:stage,competitive_reason_v2:reason});
  }
  ranked.sort((a,b)=>Number(b.competitive_priority)-Number(a.competitive_priority)||Number(b.top8_decks_30d)-Number(a.top8_decks_30d)||Number(b.deck_count_30d)-Number(a.deck_count_30d));
  return {ranked,withheld};
}

function rowHtml(r){
  const stage=r.competitive_stage_v2||r.competitive_stage||'watch';
  const adoption=`${r.deck_count_30d}/${r.sample_decks} decks · ${Number(r.sample_adoption_pct||0).toFixed(1)}% published sample`;
  const conversion=`${r.top8_decks_30d} Top 8 · ${Number(r.top8_conversion_pct||0).toFixed(0)}% conversion`;
  const setup=`Direct ${r.direct_available??'—'} · spread ${r.direct_spread_pct==null?'—':`${Number(r.direct_spread_pct).toFixed(0)}%`} · Scout ${r.opportunity_score??'—'}`;
  const print=`${r.set_name||'Unknown set'} · ${r.printing||'printing unknown'}${r.premium_risk?' · PREMIUM PRINT':''}`;
  return `<div class="cx-detail-stat"><span><strong>${esc(r.card_name)}</strong><small>${esc(`${r.format||'Unknown format'} · ${adoption} · ${conversion}`)}</small><small>${esc(print)}</small></span><span><strong><span class="cx-signal-stage ${stageClass(stage)}">${esc(String(stage).toUpperCase())}</span> <span class="cx-signal-stage confirming">${esc(`PRIORITY ${r.competitive_priority}`)}</span></strong><small>${esc(setup)}</small><small>${esc(r.competitive_reason_v2||'')}</small></span></div>`;
}
function render(){
  const h=host();if(!h)return;
  let panel=document.getElementById('cxCompetitiveIntel');
  if(!panel){panel=document.createElement('section');panel.id='cxCompetitiveIntel';panel.className='cx-card';const layout=h.querySelector('.cx-signals-layout');if(layout)layout.insertAdjacentElement('beforebegin',panel);else h.appendChild(panel)}
  const latest=events.slice(0,4).map(e=>`${e.event_name}${e.format?` · ${e.format}`:''} · ${coverageLabel(e)} · ${e.published_deck_count||'?'} published`).join(' · ');
  const {ranked,withheld}=rankedRows();
  const withheldParts=[];
  if(withheld.basics)withheldParts.push(`${withheld.basics} basic-land matches hidden`);
  if(withheld.premium)withheldParts.push(`${withheld.premium} premium-print distortions hidden`);
  if(withheld.incomplete)withheldParts.push(`${withheld.incomplete} rows withheld for incomplete/mismatched event coverage`);
  panel.innerHTML=`<div class="cx-page-head"><div><div class="cx-section-title">Competitive opportunities</div><p class="cx-sub">Published tournament samples ranked against Scout market setup. Adoption is published-sample adoption—not full-field metagame share unless an event is explicitly marked complete. Curated League samples are excluded from share calculations.</p></div><button type="button" class="cx-refresh" id="cxRefreshMtgo">Refresh MTGO</button></div>${latest?`<p class="cx-sub">Latest imported: ${esc(latest)}</p>`:''}<div class="cx-detail-list">${ranked.length?ranked.slice(0,12).map(rowHtml).join(''):'<div class="cx-empty">No fully linked competitive market setups yet. Refresh MTGO to import recent Challenge/Qualifier/Showcase results.</div>'}</div>${withheldParts.length?`<p class="cx-sub">Ranking guardrails: ${esc(withheldParts.join(' · '))}.</p>`:''}<div id="cxCompetitiveMsg" class="cx-sub">${esc(syncMessage)}</div>`;
  document.getElementById('cxRefreshMtgo')?.addEventListener('click',sync);
}
async function loadAllDeckEventIds(){
  const out=[];let offset=0;
  for(let page=0;page<8;page++){
    const batch=await rest(`competitive_decks?select=event_id&order=created_at.desc&limit=1000&offset=${offset}`);
    if(!Array.isArray(batch))break;
    out.push(...batch);
    if(batch.length<1000)break;
    offset+=1000;
  }
  return out;
}
async function load(){
  if(loading)return loading;
  const since=new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  loading=Promise.all([
    rest('rpc/competitive_scout_opportunities',{method:'POST',body:{p_format:null}}),
    rest(`competitive_events?select=event_id,event_name,format,event_date,player_count,published_deck_count,coverage_type,coverage_note,source_url,fetched_at&event_date=gte.${since}&order=event_date.desc,fetched_at.desc&limit=250`),
    loadAllDeckEventIds()
  ]).then(([r,e,d])=>{rows=Array.isArray(r)?r:[];events=Array.isArray(e)?e:[];deckEventIds=Array.isArray(d)?d:[];render();return rows}).catch(error=>{console.warn('Competitive intel load failed',error);render();return rows}).finally(()=>{loading=null});
  return loading;
}
async function sync(){
  const btn=document.getElementById('cxRefreshMtgo');
  const original=btn?.textContent||'Refresh MTGO';
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),65000);
  if(btn){btn.disabled=true;btn.textContent='Refreshing…'}
  syncMessage='Fetching and parsing up to 4 recent MTGO Challenge/Qualifier/Showcase/Trial results…';render();
  try{
    const session=await validSession();if(!session)throw new Error('Sign in required');
    const r=await fetch(`${collectishConfig.supabaseUrl}/functions/v1/competitive-mtgo-sync`,{method:'POST',signal:controller.signal,headers:{apikey:collectishConfig.publishableKey,Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},body:JSON.stringify({limit:4})});
    const text=await r.text();let data;try{data=text?JSON.parse(text):{}}catch{data={error:text}};
    if(!r.ok)throw new Error(data?.error||`MTGO sync HTTP ${r.status}`);
    const errorCount=Number(data.errors||0);
    const seconds=Math.max(1,Math.round(Number(data.elapsed_ms||0)/1000));
    syncMessage=`Imported ${data.events||0} event${Number(data.events)===1?'':'s'}, ${data.decks||0} decks and ${data.cards||0} card rows in ${seconds}s.${errorCount?` ${errorCount} event${errorCount===1?'':'s'} could not be fully imported.`:''}${Number(data.events||0)===0?` MTGO discovery found ${data.discovered||0} decklist URL${Number(data.discovered)===1?'':'s'}${data.message?`: ${data.message}`:'.'}`:''}`;
    loading=null;await load();document.dispatchEvent(new CustomEvent('collectish:competitive-changed',{detail:data}));
  }catch(e){
    syncMessage=e?.name==='AbortError'?'MTGO refresh timed out after 65 seconds. Nothing will keep spinning; try again or inspect the returned event errors.':(e?.message||'Could not refresh MTGO results.');
    render();
  }finally{clearTimeout(timer);const current=document.getElementById('cxRefreshMtgo');if(current){current.disabled=false;current.textContent=original}}
}
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals')queueMicrotask(()=>void load())});
document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='signals')queueMicrotask(()=>void load())});
document.addEventListener('collectish:competitive-changed',()=>{loading=null;void load()});
export { load as loadCompetitiveIntel, sync as syncCompetitiveMtgo };
