import { rest } from '../../core/rest.js';

const cache=new Map();
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const fmt=v=>n(v).toFixed(1).replace(/\.0$/,'');
const clamp=(v,max)=>Math.max(0,Math.min(max,n(v)));

async function loadScore(sku){
  const key=String(sku||'');if(!key)return null;
  if(cache.has(key))return cache.get(key);
  const job=rest(`scout_opportunities_v5?select=sku_id,promoted_score,promoted_grade,thesis_points,direct_execution_points,buylist_backing_points,exit_floor_points,confirmation_points&sku_id=eq.${encodeURIComponent(key)}&limit=1`)
    .then(rows=>Array.isArray(rows)?rows[0]||null:null).catch(()=>null);
  cache.set(key,job);const row=await job;cache.set(key,Promise.resolve(row));return row;
}

function component(label,value,max,sub){
  return `<div class="cx-v5-component"><span>${esc(label)}</span><strong>${fmt(value)}<small>/${max}</small></strong><progress max="${max}" value="${clamp(value,max)}"></progress><em>${esc(sub)}</em></div>`;
}
function removeLegacyV4(h){
  for(const stat of h.querySelectorAll('.cx-v5-stat')){
    if(stat.querySelector('span')?.textContent?.trim()==='Legacy v4 score')stat.remove();
  }
}
async function reconcile(sku){
  const h=document.getElementById('cxParityDetail');if(!h||!sku)return;
  h.querySelector(':scope > .cx-v5-components')?.remove();
  removeLegacyV4(h);
  const row=await loadScore(sku);if(!row||String(document.querySelector('#cxParityCards .cx-scout-card.selected')?.dataset?.sku||sku)!==String(sku))return;
  const thesis=n(row.thesis_points),execution=n(row.direct_execution_points)+n(row.buylist_backing_points),floor=n(row.exit_floor_points),confirmation=n(row.confirmation_points);
  const sum=thesis+execution+floor+confirmation,promoted=n(row.promoted_score),delta=Math.abs(sum-promoted);
  let details=h.querySelector(':scope > .cx-scout-score-explain');
  if(!details){details=document.createElement('details');details.className='cx-v5-details cx-scout-score-explain';const badges=h.querySelector(':scope > .cx-v5-badges');if(badges)badges.insertAdjacentElement('afterend',details);else h.querySelector('.cx-v5-title')?.insertAdjacentElement('afterend',details)}
  details.innerHTML=`<summary>Why this score? <strong>${esc(row.promoted_grade||'')} ${fmt(promoted)}</strong></summary><div class="cx-v5-components">${component('Thesis',thesis,70,'card quality')}${component('Execution',execution,20,'Direct + buylist execution')}${component('Exit / Floor',floor,5,'cash support')}${component('Confirmation',confirmation,5,'independent price confirmation')}</div><small class="cx-sub">Components ${fmt(sum)} → promoted Scout ${fmt(promoted)}${delta>.6?' · score reconciliation pending':''}</small>`;
  removeLegacyV4(h);
}
function schedule(sku){for(const ms of [0,120,420])setTimeout(()=>void reconcile(sku),ms)}

document.addEventListener('collectish:scout-detail-rendered',e=>schedule(e.detail?.sku));
document.addEventListener('collectish:position-sizing-changed',()=>schedule(document.querySelector('#cxParityCards .cx-scout-card.selected')?.dataset?.sku));
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='scout')schedule(document.querySelector('#cxParityCards .cx-scout-card.selected')?.dataset?.sku)});

window.CollectishScoutScoreExplain={reconcile};
