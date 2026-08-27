import store from '../../state/store.js';
import { rest } from '../../core/rest.js';
import { aggregateVideoTheses } from './video-theses.js';

let events=[];
let responses=[];
let loading=null;
let loadedAt=0;
const TTL=5*60*1000;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const lower=s=>String(s||'').trim().toLowerCase();
const baseName=s=>String(s||'').replace(/\s*\([^)]*(foil|showcase|borderless|extended art|serialized|retro frame|etched|alternate art|halo foil|rainbow foil|surge foil|galaxy foil)[^)]*\)\s*/ig,' ').replace(/\s+/g,' ').trim();
const pretty=s=>String(s||'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
const money=n=>Number.isFinite(Number(n))?`$${Number(n).toFixed(2)}`:'—';
const pct=n=>Number.isFinite(Number(n))?`${Number(n)>=0?'+':''}${Number(n).toFixed(1)}%`:'—';
function timeLabel(ms){const s=Math.max(0,Math.floor(Number(ms||0)/1000)),m=Math.floor(s/60),h=Math.floor(m/60);return h?`${h}:${String(m%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`:`${m}:${String(s%60).padStart(2,'0')}`}
function youtubeUrl(videoId,startMs){return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Math.max(0,Math.floor(Number(startMs||0)/1000))}s`}
function itemFor(event){return (store.get().intel?.items||[]).find(x=>String(x.intel_id)===String(event.intel_id))||null}
function cardEntities(item){return (Array.isArray(item?.market_intel_entities)?item.market_intel_entities:[]).filter(e=>e.entity_type==='card')}
function matchesRow(event,row){const item=itemFor(event);if(!item||!row)return false;const rowName=lower(baseName(row.product_name)),pid=String(row.product_id||''),sf=String(row.scryfall_id||'');return cardEntities(item).some(e=>(sf&&String(e.scryfall_id||'')===sf)||(pid&&String(e.product_id||'')===pid)||lower(baseName(e.entity_name))===rowName)}
function arrow(direction){return direction==='bearish'?'↓':direction==='bullish'?'↑':direction==='mixed'?'↕':'•'}
function eventChip(type,direction,item){return `<span class="cx-signal-stage ${esc(item?.signal_stage||'unclassified')}">${esc(pretty(type))} ${arrow(direction)}</span>`}
function thesisData(){return aggregateVideoTheses(events,store.get().intel?.items||[])}
function momentLinks(thesis,limit=5){return thesis.moments.slice(0,limit).map(({event})=>`<a href="${esc(youtubeUrl(event.video_id,event.start_ms))}" target="_blank" rel="noopener">${esc(timeLabel(event.start_ms))}</a>`).join(' · ')}
function responseForThesis(thesis){
  const ids=new Set(thesis.moments.map(({event})=>String(event?.intel_id||'')));
  const rows=responses.filter(r=>ids.has(String(r.intel_id||'')));
  if(!rows.length)return null;
  return rows.sort((a,b)=>Number(b.catalyst_impact_score||0)-Number(a.catalyst_impact_score||0)||Number(b.convergence_score||0)-Number(a.convergence_score||0)||Number(b.market_response_score||0)-Number(a.market_response_score||0))[0];
}
function responseLabel(r){if(!r)return'';if(r.latest_horizon==='t0')return `${pretty(r.catalyst_market_state||'Watching')} · baseline captured`;return pretty(r.catalyst_market_state||r.market_response_status||'Watching')}
function responseEvidence(r){if(!r)return'';if(r.latest_horizon==='t0')return `T0 ${money(r.baseline_market_price)} market · ${money(r.baseline_direct_low)} Direct`;const bits=[`Market ${pct(r.market_price_change_pct)}`,`Direct ${pct(r.direct_low_change_pct)}`];if(Number.isFinite(Number(r.direct_available_change_pct)))bits.push(`Direct supply ${pct(r.direct_available_change_pct)}`);if(Number.isFinite(Number(r.transaction_velocity_lift_30d_pct)))bits.push(`sales velocity ${pct(r.transaction_velocity_lift_30d_pct)}`);return bits.join(' · ')}
function scopeEvidence(r){if(!r)return'';const speakers=Math.max(1,Number(r.qualified_speaker_count||1)),sources=Math.max(1,Number(r.independent_source_count||1)),creators=Math.max(1,Number(r.independent_creator_count||1)),nonvideo=Math.max(0,Number(r.independent_nonvideo_source_count||0));return `${speakers} supporting speaker${speakers===1?'':'s'} · ${sources} independent source${sources===1?'':'s'} · ${creators} creator source${creators===1?'':'s'}${nonvideo?` · ${nonvideo} non-video`:''}`}
function scoreEvidence(r){if(!r)return'';return `Conviction ${Number(r.content_conviction_score??r.creator_conviction_score??0)} · Catalyst ${Number(r.catalyst_impact_score||0)} · Convergence ${Number(r.convergence_score||0)} · Market ${Number(r.market_response_score||0)}`}
function decorateSignals(){
  document.querySelectorAll('.cx-video-event-strip').forEach(x=>x.remove());
  document.querySelectorAll('#cxSignalsFeed [data-video-thesis-collapsed="1"]').forEach(x=>{x.hidden=false;x.removeAttribute('data-video-thesis-collapsed')});
  for(const thesis of thesisData()){
    const primaryId=String(thesis.primary_event?.intel_id||'');
    const claim=document.querySelector(`#cxSignalsFeed [data-intel-id="${CSS.escape(primaryId)}"]`);if(!claim)continue;
    for(const {event} of thesis.moments){const id=String(event?.intel_id||'');if(!id||id===primaryId)continue;const dup=document.querySelector(`#cxSignalsFeed [data-intel-id="${CSS.escape(id)}"]`);if(dup){dup.hidden=true;dup.dataset.videoThesisCollapsed='1'}}
    const response=responseForThesis(thesis);
    const wrap=document.createElement('div');wrap.className='cx-video-event-strip';wrap.style.cssText='display:flex;align-items:center;gap:.45rem;flex-wrap:wrap;margin:.45rem 0 .15rem;font-size:.82rem';
    const count=thesis.supporting_count>1?` · ${thesis.supporting_count} supporting moments`:'';
    const evidence=thesis.primary_event?.evidence?` · ${esc(thesis.primary_event.evidence)}`:'';
    const market=response?`<span class="cx-signal-stage"><strong>Catalyst ${Number(response.catalyst_impact_score||0)}</strong> · Conviction ${Number(response.content_conviction_score??response.creator_conviction_score??0)} · Convergence ${Number(response.convergence_score||0)} · Market ${Number(response.market_response_score||0)}</span><small class="cx-sub">${esc(scopeEvidence(response))} · ${esc(responseLabel(response))} · ${esc(responseEvidence(response))}</small>`:'';
    wrap.innerHTML=`${eventChip(thesis.primary_event?.event_type,thesis.direction,thesis.primary_item)}<strong>${esc(thesis.card_name)}</strong><small class="cx-sub">${esc(thesis.channel_name)}${esc(count)}</small><span class="cx-video-moments">${momentLinks(thesis)}</span>${market}<small class="cx-sub">${evidence}</small>`;
    claim.appendChild(wrap);
  }
}
function decorateScoutDetail(sku){
  const host=document.getElementById('cxParityDetail');if(!host||!sku)return;host.querySelector('.cx-video-catalyst-detail')?.remove();
  const row=(store.get().scout?.rows||[]).find(r=>String(r.sku_id)===String(sku));if(!row)return;
  const matched=events.filter(e=>matchesRow(e,row));if(!matched.length)return;
  const matchedIds=new Set(matched.map(e=>String(e.intel_id)));
  const theses=thesisData().filter(t=>t.moments.some(({event})=>matchedIds.has(String(event.intel_id))));if(!theses.length)return;
  const top=theses[0],topResponse=responseForThesis(top),latest=theses.slice(0,3);
  const conviction=Number(topResponse?.content_conviction_score??topResponse?.creator_conviction_score??Math.round(Number(top.max_prominence||0)*100));
  const catalyst=Number(topResponse?.catalyst_impact_score??0),convergence=Number(topResponse?.convergence_score??0),market=Number(topResponse?.market_response_score??0);
  const speakers=Math.max(1,Number(topResponse?.qualified_speaker_count||1));
  const convictionStat=`<div class="cx-v5-stat"><span>Conviction</span><strong>${conviction}/100</strong><small>Strongest qualified speaker plus bounded same-video consensus. ${speakers} supporting speaker${speakers===1?'':'s'}; repeated timestamps alone add nothing.</small></div>`;
  const responseStat=topResponse?`<div class="cx-v5-stat"><span>Catalyst / convergence / market</span><strong>${catalyst} / ${convergence} / ${market}</strong><small>${esc(scopeEvidence(topResponse))} · ${esc(responseLabel(topResponse))} · ${esc(responseEvidence(topResponse))}</small></div>`:'';
  const rows=latest.map(t=>{const r=responseForThesis(t);return `<div class="cx-v5-stat"><span>${esc(pretty(t.primary_event?.event_type))}</span><strong>${esc(t.channel_name||'Creator')}${r?` · catalyst ${Number(r.catalyst_impact_score||0)}`:''}</strong><small>${t.supporting_count} supporting moment${t.supporting_count===1?'':'s'} · ${momentLinks(t,4)}${r?` · ${Math.max(1,Number(r.qualified_speaker_count||1))} speaker${Math.max(1,Number(r.qualified_speaker_count||1))===1?'':'s'} · convergence ${Number(r.convergence_score||0)} · market ${Number(r.market_response_score||0)}`:''}</small></div>`}).join('');
  const section=document.createElement('section');section.className='cx-v5-section cx-video-catalyst-detail';section.innerHTML=`<div class="cx-section-title">Creator catalysts <span class="cx-intel-context">timestamped video + speaker consensus + independent convergence + market response</span></div><div class="cx-v5-grid">${convictionStat}${responseStat}${rows}</div><small class="cx-sub">Conviction starts with the strongest qualified speaker thesis and can receive a bounded bonus when additional high-confidence speakers in the same video independently endorse it. Echoes such as “yeah” or “agreed” do not earn consensus credit. Multiple speakers still remain one independent source for Convergence. Catalyst impact also considers event intent and a conservative source-reach prior. Market reaction is measured separately from price, Direct supply, and post-signal sales velocity.</small>`;
  const anchor=host.querySelector('.cx-intelligence-detail')||host.querySelector('.cx-v5-components')||host.firstElementChild;if(anchor?.parentNode)anchor.parentNode.insertBefore(section,anchor.nextSibling);else host.appendChild(section);
}
function decorate(){decorateSignals();decorateScoutDetail(store.get().scout?.selectedSku||null)}
async function load(force=false){
  if(loading)return loading;if(!force&&loadedAt&&Date.now()-loadedAt<TTL){decorate();return events}
  loading=Promise.all([
    rest('market_intel_video_events?select=*&order=created_at.desc&limit=300').catch(()=>[]),
    rest('market_intel_video_market_response?select=*&order=catalyst_impact_score.desc&limit=300').catch(()=>[])
  ]).then(([eventRows,responseRows])=>{events=Array.isArray(eventRows)?eventRows:[];responses=Array.isArray(responseRows)?responseRows:[];loadedAt=Date.now();store.update('intel',{videoEvents:events,videoTheses:thesisData(),videoMarketResponses:responses,videoEventsLoadedAt:loadedAt});decorate();return events}).finally(()=>{loading=null});
  return loading;
}

document.addEventListener('collectish:intel-changed',()=>setTimeout(()=>void load(true),30));
document.addEventListener('collectish:scout-detail-rendered',e=>{if(events.length)decorateScoutDetail(e.detail?.sku);else void load()});
document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='signals')setTimeout(()=>void load(),90)});
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals')setTimeout(decorateSignals,100)});
document.addEventListener('collectish:ready',()=>void load());

void load();
export { load as loadVideoEvents };
