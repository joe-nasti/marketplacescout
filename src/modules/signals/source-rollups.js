import store from '../../state/store.js';
import { rest } from '../../core/rest.js';

let rollups=[];
let loading=null;
const lower=s=>String(s||'').trim().toLowerCase();

function match(row){
  if(!row)return null;
  const sf=lower(row.scryfall_id),pid=String(row.product_id||''),name=lower(row.product_name);
  return rollups.find(x=>(sf&&lower(x.scryfall_id)===sf)||(pid&&String(x.product_id||'')===pid)||(name&&lower(x.entity_name)===name))||null;
}

function timing(r){
  if(!r)return'';
  if(Number(r.early_sources)>0)return'EARLY';
  if(Number(r.confirming_sources)>0)return'CONFIRMING';
  if(Number(r.late_sources)>0)return'LATE';
  return'UNRATED';
}

function summary(r){
  const sources=Number(r.independent_source_count||0),claims=Number(r.claim_count||0),stage=timing(r);
  return `${sources} source${sources===1?'':'s'} · ${claims} claim${claims===1?'':'s'}${stage!=='UNRATED'?` · ${stage}`:''}`;
}

function compact(r){
  if(!r)return null;
  return {
    independentSources:Number(r.independent_source_count||0),
    claims:Number(r.claim_count||0),
    timing:timing(r),
    direction:Number(r.intel_direction_score||0),
    earlySources:Number(r.early_sources||0),
    confirmingSources:Number(r.confirming_sources||0),
    lateSources:Number(r.late_sources||0),
    latestObservedAt:r.latest_observed_at||null,
    entityName:r.entity_name||null
  };
}

function getCompactForRow(row){return compact(match(row))}

function decorateList(){
  const rows=store.get().scout?.rows||[];
  const bySku=new Map(rows.map(r=>[String(r.sku_id),r]));
  document.querySelectorAll('#cxParityCards .cx-scout-card').forEach(card=>{
    const r=match(bySku.get(String(card.dataset.sku)));if(!r)return;
    const top=card.querySelector('.cx-scout-card-top');if(!top)return;
    let badge=card.querySelector('.cx-intel-mini');
    if(!badge){badge=document.createElement('span');badge.className='cx-intel-mini';top.appendChild(badge)}
    badge.textContent=`◉ ${summary(r)}`;
    const score=Number(r.intel_direction_score||0);
    badge.title=`Independent intelligence rollup. Direction score ${score>=0?'+':''}${score.toFixed(1)}. Signals do not change Scout grade.`;
  });
}

function decorateDetail(sku){
  const host=document.getElementById('cxParityDetail');if(!host||!sku)return;
  const row=(store.get().scout?.rows||[]).find(r=>String(r.sku_id)===String(sku));
  const r=match(row);if(!r)return;
  const section=host.querySelector('.cx-intel-detail');if(!section)return;
  section.querySelector('[data-intel-rollup]')?.remove();
  const line=document.createElement('div');line.dataset.intelRollup='1';line.className='cx-signal-meta';
  const score=Number(r.intel_direction_score||0);
  line.textContent=`Consensus: ${summary(r)} · direction ${score>=0?'+':''}${score.toFixed(1)}`;
  const title=section.querySelector('.cx-section-title');
  if(title)title.insertAdjacentElement('afterend',line);else section.prepend(line);
}

async function load(){
  if(loading)return loading;
  loading=rest('market_intel_entity_rollups?select=*&order=latest_observed_at.desc&limit=500')
    .then(data=>{rollups=Array.isArray(data)?data:[];decorateList();decorateDetail(store.get().scout?.selectedSku||null);return rollups})
    .catch(error=>{console.warn('Intel source rollup load failed',error);return rollups})
    .finally(()=>{loading=null});
  return loading;
}

document.addEventListener('collectish:intel-evaluated',()=>void load());
document.addEventListener('collectish:intel-changed',()=>{rollups=[];void load()});
document.addEventListener('collectish:scout-list-rendered',()=>{if(rollups.length)decorateList();else void load()});
document.addEventListener('collectish:scout-detail-rendered',e=>{if(rollups.length)decorateDetail(e.detail?.sku);else void load()});
document.addEventListener('collectish:ready',()=>void load());

window.CollectishIntelRollups={getCompactForRow,load};
export { load as loadIntelSourceRollups, getCompactForRow };
