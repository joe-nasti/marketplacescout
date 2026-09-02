import { rest } from '../../core/rest.js';

let rows=[];
let loading=null;
let loadedAt=0;
const TTL=5*60*1000;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pretty=s=>String(s||'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const timeLabel=ms=>{const s=Math.max(0,Math.floor(Number(ms||0)/1000)),m=Math.floor(s/60),h=Math.floor(m/60);return h?`${h}:${String(m%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`:`${m}:${String(s%60).padStart(2,'0')}`};
const youtubeUrl=(videoId,startMs)=>`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Math.max(0,Math.floor(Number(startMs||0)/1000))}s`;
function canonicalRows(data){const m=new Map();for(const r of data||[]){const k=`${norm(r.source_card_name)}|${norm(r.target_card_name)}|${Number(r.start_ms||0)}`,old=m.get(k);if(!old||String(r.updated_at||'')>String(old.updated_at||''))m.set(k,r)}return [...m.values()]}
function consensusLabel(r){const n=Number(r.same_video_speaker_count||0),sub=Number(r.same_video_substantive_speakers||0),bonus=Number(r.same_video_consensus_bonus||0),tier=String(r.same_video_consensus_tier||'none');if(!n)return '';if(tier==='echo_only')return `${n} voices · echo only${bonus?` · +${bonus} same-video`:''}`;if(sub>=2)return `${n} voices · ${pretty(tier)}${bonus?` · +${bonus} same-video`:''}`;return `${n} voice${n===1?'':'s'} · no consensus bonus`}

function render(){
  document.querySelector('.cx-actionable-synergy-relationships')?.remove();
  const feed=document.getElementById('cxSignalsFeed');
  if(!feed||!rows.length)return;
  const top=canonicalRows(rows).sort((a,b)=>(Number(b.same_video_consensus_bonus||0)-Number(a.same_video_consensus_bonus||0))||(Number(b.conviction||0)-Number(a.conviction||0))).slice(0,12);
  const panel=document.createElement('section');
  panel.className='cx-v5-section cx-actionable-synergy-relationships';
  panel.style.cssText='margin:0 0 1rem';
  const cards=top.map(r=>{
    const context=r.source_is_unreleased?'Unreleased card creates current opportunity':'New card synergy';
    const link=r.source_video_id?` · <a href="${esc(youtubeUrl(r.source_video_id,r.start_ms))}" target="_blank" rel="noopener">${esc(timeLabel(r.start_ms))}</a>`:'';
    const consensus=consensusLabel(r);
    return `<div class="cx-v5-stat"><span>${esc(context)}</span><strong>${esc(r.target_card_name)} ← ${esc(r.source_card_name)} · conviction ${Math.round(Number(r.conviction||0)*100)}</strong><small>${esc(r.source_name||'Creator')} · ${esc(pretty(r.relationship_type))}${consensus?` · ${esc(consensus)}`:''}${link}${r.summary?` · ${esc(String(r.summary).slice(0,220))}`:''}</small></div>`;
  }).join('');
  panel.innerHTML=`<div class="cx-section-title">Actionable new-card synergies <span class="cx-intel-context">existing cards recommended because of newly reviewed cards</span></div><div class="cx-v5-grid">${cards}</div><small class="cx-sub">Same-video speaker agreement is bounded context only (max +8 lifecycle priority). It does not change the official Scout grade and the entire video still counts as one convergence source.</small>`;
  const future=document.querySelector('.cx-future-card-theses');
  if(future?.parentNode)future.parentNode.insertBefore(panel,future.nextSibling);else feed.parentNode?.insertBefore(panel,feed);
}

async function load(force=false){
  if(loading)return loading;
  if(!force&&loadedAt&&Date.now()-loadedAt<TTL){render();return rows}
  loading=rest('market_intel_actionable_synergy_speaker_context?select=*&order=created_at.desc&limit=80').then(r=>{rows=Array.isArray(r)?r:[];loadedAt=Date.now();render();return rows}).catch(()=>[]).finally(()=>{loading=null});
  return loading;
}

document.addEventListener('collectish:signals-primary-ready',()=>setTimeout(()=>void load(),2800));
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals')setTimeout(render,90)});
document.addEventListener('collectish:intel-changed',e=>{if(e.detail?.source!=='primary-load')void load(true)});
export { load as loadSynergyRelationships };
