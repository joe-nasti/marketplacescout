import { rest } from '../../core/rest.js';

let rows=[];
let loading=null;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pct=v=>v==null?'—':`${Number(v).toFixed(0)}%`;

function host(){return document.getElementById('cxSignals')}

function rowHtml(r){
  const evaluated=Number(r.early_claims||0)+Number(r.confirming_claims||0)+Number(r.late_claims||0);
  const timing=evaluated?`${pct(r.early_pct)} early · ${pct(r.confirming_pct)} confirming · ${pct(r.late_pct)} late`:'Not enough evaluated history yet';
  return `<div class="cx-detail-stat"><span><strong>${esc(r.author==='Unknown'?r.source_name:`${r.author} · ${r.source_name}`)}</strong><small>${esc(`${r.covered_claims}/${r.total_claims} claims covered · ${r.source_items} source item${Number(r.source_items)===1?'':'s'}`)}</small></span><span><strong>${esc(timing)}</strong><small>${r.timing_score==null?'Timing score pending':`Timing score ${Number(r.timing_score).toFixed(0)}/100`}</small></span></div>`;
}

function render(){
  const h=host();if(!h)return;
  let panel=document.getElementById('cxIntelSourcePerformance');
  if(!panel){
    panel=document.createElement('section');panel.id='cxIntelSourcePerformance';panel.className='cx-card';
    const layout=h.querySelector('.cx-signals-layout');
    if(layout)layout.insertAdjacentElement('beforebegin',panel);else h.appendChild(panel);
  }
  panel.hidden=h.dataset.signalsView!=='scan';
  const useful=rows.filter(r=>Number(r.total_claims||0)>0).slice(0,8);
  panel.innerHTML=`<div class="cx-section-title">Source timing profiles</div><p class="cx-sub">MarketplaceScout measures whether each author/source tends to arrive before, during, or after market movement. This is timing history—not a trust score or recommendation.</p><div class="cx-detail-list">${useful.length?useful.map(rowHtml).join(''):'<div class="cx-empty">Timing profiles will appear as more linked card signals accumulate.</div>'}</div>`;
}

async function load(){
  if(loading)return loading;
  loading=rest('market_intel_source_performance?select=*&order=covered_claims.desc,total_claims.desc,latest_observed_at.desc&limit=50')
    .then(data=>{rows=Array.isArray(data)?data:[];render();return rows})
    .catch(error=>{console.warn('Intel source-performance load failed',error);render();return rows})
    .finally(()=>{loading=null});
  return loading;
}

document.addEventListener('collectish:intel-evaluated',()=>void load());
document.addEventListener('collectish:intel-changed',e=>{if(e.detail?.source!=='primary-load')void load()});
document.addEventListener('collectish:signals-primary-ready',()=>setTimeout(()=>void load(),1600));

export { load as loadIntelSourcePerformance };
