import store from '../../state/store.js';
import { rest } from '../../core/rest.js';
import { aggregateVideoTheses } from './video-theses.js';

let events=[];
let loading=null;
let loadedAt=0;
const TTL=5*60*1000;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const lower=s=>String(s||'').trim().toLowerCase();
const baseName=s=>String(s||'').replace(/\s*\([^)]*(foil|showcase|borderless|extended art|serialized|retro frame|etched|alternate art|halo foil|rainbow foil|surge foil|galaxy foil)[^)]*\)\s*/ig,' ').replace(/\s+/g,' ').trim();
const pretty=s=>String(s||'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
function timeLabel(ms){const s=Math.max(0,Math.floor(Number(ms||0)/1000)),m=Math.floor(s/60),h=Math.floor(m/60);return h?`${h}:${String(m%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`:`${m}:${String(s%60).padStart(2,'0')}`}
function youtubeUrl(videoId,startMs){return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Math.max(0,Math.floor(Number(startMs||0)/1000))}s`}
function itemFor(event){return (store.get().intel?.items||[]).find(x=>String(x.intel_id)===String(event.intel_id))||null}
function cardEntities(item){return (Array.isArray(item?.market_intel_entities)?item.market_intel_entities:[]).filter(e=>e.entity_type==='card')}
function matchesRow(event,row){const item=itemFor(event);if(!item||!row)return false;const rowName=lower(baseName(row.product_name)),pid=String(row.product_id||''),sf=String(row.scryfall_id||'');return cardEntities(item).some(e=>(sf&&String(e.scryfall_id||'')===sf)||(pid&&String(e.product_id||'')===pid)||lower(baseName(e.entity_name))===rowName)}
function arrow(direction){return direction==='bearish'?'↓':direction==='bullish'?'↑':direction==='mixed'?'↕':'•'}
function eventChip(type,direction,item){return `<span class="cx-signal-stage ${esc(item?.signal_stage||'unclassified')}">${esc(pretty(type))} ${arrow(direction)}</span>`}
function thesisData(){return aggregateVideoTheses(events,store.get().intel?.items||[])}
function momentLinks(thesis,limit=5){return thesis.moments.slice(0,limit).map(({event})=>`<a href="${esc(youtubeUrl(event.video_id,event.start_ms))}" target="_blank" rel="noopener">${esc(timeLabel(event.start_ms))}</a>`).join(' · ')}
function decorateSignals(){
  document.querySelectorAll('.cx-video-event-strip').forEach(x=>x.remove());
  document.querySelectorAll('#cxSignalsFeed [data-video-thesis-collapsed="1"]').forEach(x=>{x.hidden=false;x.removeAttribute('data-video-thesis-collapsed')});
  for(const thesis of thesisData()){
    const primaryId=String(thesis.primary_event?.intel_id||'');
    const claim=document.querySelector(`#cxSignalsFeed [data-intel-id="${CSS.escape(primaryId)}"]`);if(!claim)continue;
    for(const {event} of thesis.moments){const id=String(event?.intel_id||'');if(!id||id===primaryId)continue;const dup=document.querySelector(`#cxSignalsFeed [data-intel-id="${CSS.escape(id)}"]`);if(dup){dup.hidden=true;dup.dataset.videoThesisCollapsed='1'}}
    const wrap=document.createElement('div');wrap.className='cx-video-event-strip';wrap.style.cssText='display:flex;align-items:center;gap:.45rem;flex-wrap:wrap;margin:.45rem 0 .15rem;font-size:.82rem';
    const count=thesis.supporting_count>1?` · ${thesis.supporting_count} supporting moments`:'';
    const evidence=thesis.primary_event?.evidence?` · ${esc(thesis.primary_event.evidence)}`:'';
    wrap.innerHTML=`${eventChip(thesis.primary_event?.event_type,thesis.direction,thesis.primary_item)}<strong>${esc(thesis.card_name)}</strong><small class="cx-sub">${esc(thesis.channel_name)}${esc(count)}</small><span class="cx-video-moments">${momentLinks(thesis)}</span><small class="cx-sub">${evidence}</small>`;
    claim.appendChild(wrap);
  }
}
function decorateScoutDetail(sku){
  const host=document.getElementById('cxParityDetail');if(!host||!sku)return;host.querySelector('.cx-video-catalyst-detail')?.remove();
  const row=(store.get().scout?.rows||[]).find(r=>String(r.sku_id)===String(sku));if(!row)return;
  const matched=events.filter(e=>matchesRow(e,row));if(!matched.length)return;
  const matchedIds=new Set(matched.map(e=>String(e.intel_id)));
  const theses=thesisData().filter(t=>t.moments.some(({event})=>matchedIds.has(String(event.intel_id))));if(!theses.length)return;
  const top=theses[0],creators=new Set(theses.map(x=>x.channel_name).filter(Boolean)),types=[...new Set(theses.map(x=>pretty(x.primary_event?.event_type)))].slice(0,3);
  const strength=Math.round(Number(top.max_prominence||0)*100),latest=theses.slice(0,3);
  const rows=latest.map(t=>`<div class="cx-v5-stat"><span>${esc(pretty(t.primary_event?.event_type))}</span><strong>${esc(t.channel_name||'Creator')} · ${Math.round(Number(t.max_prominence||0)*100)}</strong><small>${t.supporting_count} supporting moment${t.supporting_count===1?'':'s'} · ${momentLinks(t,4)}</small></div>`).join('');
  const section=document.createElement('section');section.className='cx-v5-section cx-video-catalyst-detail';section.innerHTML=`<div class="cx-section-title">Creator catalysts <span class="cx-intel-context">timestamped video evidence</span></div><div class="cx-v5-grid"><div class="cx-v5-stat"><span>Content momentum</span><strong>${strength}/100 · ${creators.size} creator${creators.size===1?'':'s'}</strong><small>${esc(types.join(' · '))}</small></div>${rows}</div><small class="cx-sub">Repeated moments from one creator video are collapsed into one thesis. Creator exposure is context, not a Scout-grade input yet.</small>`;
  const anchor=host.querySelector('.cx-intelligence-detail')||host.querySelector('.cx-v5-components')||host.firstElementChild;if(anchor?.parentNode)anchor.parentNode.insertBefore(section,anchor.nextSibling);else host.appendChild(section);
}
function decorate(){decorateSignals();decorateScoutDetail(store.get().scout?.selectedSku||null)}
async function load(force=false){if(loading)return loading;if(!force&&loadedAt&&Date.now()-loadedAt<TTL){decorate();return events}loading=rest('market_intel_video_events?select=*&order=created_at.desc&limit=300').then(rows=>{events=Array.isArray(rows)?rows:[];loadedAt=Date.now();store.update('intel',{videoEvents:events,videoTheses:thesisData(),videoEventsLoadedAt:loadedAt});decorate();return events}).catch(()=>events).finally(()=>{loading=null});return loading}

document.addEventListener('collectish:intel-changed',()=>setTimeout(()=>void load(true),30));
document.addEventListener('collectish:scout-detail-rendered',e=>{if(events.length)decorateScoutDetail(e.detail?.sku);else void load()});
document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='signals')setTimeout(()=>void load(),90)});
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals')setTimeout(decorateSignals,100)});
document.addEventListener('collectish:ready',()=>void load());

void load();
export { load as loadVideoEvents };
