import { rest } from '../../core/rest.js';

let rows=[];
let loading=null;
let loadedAt=0;
const TTL=5*60*1000;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pretty=s=>String(s||'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
const dateLabel=s=>{if(!s)return'Release date unknown';const d=new Date(`${s}T12:00:00`);return Number.isNaN(d.valueOf())?String(s):d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})};

function render(){
  document.querySelector('.cx-future-card-theses')?.remove();
  const feed=document.getElementById('cxSignalsFeed');
  if(!feed||!rows.length)return;
  const active=rows.filter(r=>r.lifecycle_state!=='archived').slice(0,12);
  if(!active.length)return;
  const panel=document.createElement('section');
  panel.className='cx-v5-section cx-future-card-theses';
  panel.style.cssText='margin:0 0 1rem';
  const cards=active.map(r=>{
    const state=r.lifecycle_state==='unreleased_deferred'?'Saved for release':r.lifecycle_state==='release_window'?'Release window':'Post-release watch';
    const creators=Math.max(1,Number(r.independent_creator_count||1));
    const thesisCount=Math.max(1,Number(r.thesis_count||1));
    return `<div class="cx-v5-stat"><span>${esc(state)} · ${esc(dateLabel(r.release_date))}</span><strong>${esc(r.card_name)} · conviction ${Number(r.strongest_conviction_score||0)}</strong><small>${creators} creator${creators===1?'':'s'} · ${thesisCount} retained thesis${thesisCount===1?'':'es'} · ${esc(pretty(r.strongest_event_type||'creator review'))}${r.strongest_evidence?` · “${esc(String(r.strongest_evidence).slice(0,220))}”`:''}</small></div>`;
  }).join('');
  panel.innerHTML=`<div class="cx-section-title">Future card theses <span class="cx-intel-context">strong creator opinions retained through release</span></div><div class="cx-v5-grid">${cards}</div><small class="cx-sub">Unreleased cards are retained separately from actionable Scout opportunities. They automatically re-surface at release and remain in the post-release watch window for 90 days, preserving the original creator thesis instead of rediscovering it from scratch.</small>`;
  feed.parentNode?.insertBefore(panel,feed);
}

async function load(force=false){
  if(loading)return loading;
  if(!force&&loadedAt&&Date.now()-loadedAt<TTL){render();return rows}
  loading=rest('market_intel_future_card_thesis_rollups?select=*&lifecycle_state=neq.archived&order=strongest_conviction_score.desc,release_date.asc&limit=40').then(r=>{rows=Array.isArray(r)?r:[];loadedAt=Date.now();render();return rows}).catch(()=>[]).finally(()=>{loading=null});
  return loading;
}

document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='signals')setTimeout(()=>void load(),80)});
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals')setTimeout(render,80)});
document.addEventListener('collectish:intel-changed',()=>void load(true));
document.addEventListener('collectish:ready',()=>void load());

void load();
export { load as loadFutureCardTheses };
