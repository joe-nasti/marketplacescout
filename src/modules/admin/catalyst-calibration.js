import {rest} from '../../core/rest.js';

let loading=false;
const MIN_SAMPLE=8;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const num=v=>Number.isFinite(Number(v))?Number(v):0;
const pct=v=>v==null||!Number.isFinite(Number(v))?'—':`${Number(v)>=0?'+':''}${Number(v).toFixed(1)}%`;
const fmt=v=>v==null||!Number.isFinite(Number(v))?'—':Number(v).toFixed(2).replace(/0+$/,'').replace(/\.$/,'');

function ensure(){
  const parent=document.getElementById('cxAdminSinglesModules');if(!parent)return null;
  let host=document.getElementById('cxCatalystCalibration');
  if(!host){
    host=document.createElement('section');host.id='cxCatalystCalibration';host.className='cx-admin-module cx-catalyst-calibration';
    host.innerHTML=`<div class="cx-cal-head"><div><span>SCOUT × SIGNALS</span><h3>Catalyst calibration</h3><p>Shadow-score validation and proposed source weights. Official Scout ranking and production source weights remain unchanged.</p></div><button type="button" class="cx-refresh" data-cal-refresh>Refresh</button></div><div class="cx-cal-status" data-cal-status>Loading calibration data…</div><div class="cx-cal-metrics" data-cal-metrics></div><div class="cx-cal-grid"><section><div class="cx-cal-section-head"><strong>Modifier bands</strong><small>Does more catalyst conviction produce better outcomes?</small></div><div data-cal-bands></div></section><section><div class="cx-cal-section-head"><strong>Sources & creators</strong><small>Current weight → proposed shadow weight. Nothing here changes production scoring.</small></div><div data-cal-sources></div></section></div>`;
    parent.prepend(host);
    host.querySelector('[data-cal-refresh]')?.addEventListener('click',()=>load());
  }
  return host;
}
function metric(label,value,sub,state='neutral'){return `<div class="cx-cal-metric ${state}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></div>`}
function maturity(row,h='7d'){return num(row[`matured_${h}`])}
function sampleState(n){return n>=MIN_SAMPLE?'ready':n>0?'early':'empty'}
function bandOrder(v){return {'−8..−4':0,'-8..-4':0,'−3..−1':1,'-3..-1':1,'0':2,'+1..+3':3,'+4..+7':4,'+8..+12':5}[v]??99}
function bandRows(rows){
  if(!rows.length)return '<div class="cx-cal-empty">No catalyst snapshots yet. Open Scout against live Signals data to begin the calibration ledger.</div>';
  const sorted=[...rows].sort((a,b)=>bandOrder(a.modifier_band)-bandOrder(b.modifier_band));
  return `<div class="cx-cal-table"><div class="cx-cal-tr head"><span>Modifier</span><span>Samples</span><span>1d</span><span>7d</span><span>30d</span><span>7d tx</span></div>${sorted.map(r=>{const n=maturity(r,'7d'),state=sampleState(n);return `<div class="cx-cal-tr ${state}"><strong>${esc(r.modifier_band)}</strong><span>${esc(r.snapshots)}</span><span>${pct(r.avg_market_change_1d_pct)}</span><span>${pct(r.avg_market_change_7d_pct)}</span><span>${pct(r.avg_market_change_30d_pct)}</span><span>${fmt(r.avg_transactions_7d)}</span><small>${state==='ready'?'usable sample':state==='early'?`${n}/${MIN_SAMPLE} mature 7d`:'awaiting maturity'}</small></div>`}).join('')}</div>`;
}
function proposalLabel(r){
  if(r.proposed_weight==null)return `wait for ${MIN_SAMPLE} mature 7d`;
  const delta=num(r.proposed_delta),verb=r.recommendation==='raise'?'raise':r.recommendation==='lower'?'lower':'hold';
  return `${verb} ${delta>0?'+':''}${fmt(delta)}`;
}
function confidenceLabel(r){
  const c=String(r.proposal_confidence||'').replace(/_/g,' ');
  if(c==='insufficient shadow sample')return `${maturity(r,'7d')}/${MIN_SAMPLE}`;
  return c||'pending';
}
function sourceRows(rows){
  if(!rows.length)return '<div class="cx-cal-empty">Source/creator calibration will populate as shadow snapshots mature.</div>';
  const sorted=[...rows].sort((a,b)=>maturity(b,'7d')-maturity(a,'7d')||num(b.snapshots)-num(a.snapshots)).slice(0,18);
  return `<div class="cx-cal-sources">${sorted.map(r=>{const n=maturity(r,'7d'),state=sampleState(n),proposed=r.proposed_weight==null?'—':fmt(r.proposed_weight),current=fmt(r.current_weight),history=num(r.historical_measured_signals);return `<article class="cx-cal-source ${state}"><div><strong>${esc(r.source_label)}</strong><small>${esc(r.source_type)} · ${r.snapshots} snapshots · ${history} historical measured</small><div class="cx-cal-weight"><span><b>${current}</b><small>current</small></span><i>→</i><span><b>${proposed}</b><small>proposed</small></span><em class="${esc(r.recommendation||'wait')}">${esc(proposalLabel(r))}</em></div></div><div class="cx-cal-source-outcomes"><span><b>${pct(r.avg_market_change_7d_pct)}</b><small>7d price</small></span><span><b>${fmt(r.avg_transactions_7d)}</b><small>7d tx</small></span><span><b>${r.historical_predictive_pct==null?'—':`${fmt(r.historical_predictive_pct)}%`}</b><small>hist predictive</small></span><span class="cx-cal-sample ${state}" title="Proposal confidence: ${esc(r.proposal_confidence||'pending')}">${esc(confidenceLabel(r))}</span></div></article>`}).join('')}</div>`;
}
async function load(){
  const host=ensure();if(!host||loading)return;loading=true;host.querySelector('[data-cal-status]').textContent='Reading shadow outcomes…';
  try{
    const [bands,sources,shots]=await Promise.all([
      rest('market_intel_catalyst_shadow_backtest_summary?select=*&order=scorer_version.desc'),
      rest('market_intel_catalyst_shadow_weight_proposals?select=*&order=matured_7d.desc,snapshots.desc'),
      rest('market_intel_catalyst_shadow_snapshots?select=snapshot_id,future_release,captured_at&order=captured_at.desc&limit=500')
    ]);
    const total=(shots||[]).length,future=(shots||[]).filter(x=>x.future_release).length,mature7=(bands||[]).reduce((s,x)=>s+maturity(x,'7d'),0),mature30=(bands||[]).reduce((s,x)=>s+maturity(x,'30d'),0),readySources=(sources||[]).filter(x=>x.proposed_weight!=null).length;
    host.querySelector('[data-cal-status]').textContent=total?`${total} shadow snapshot${total===1?'':'s'} recorded · ${mature7} have matured through 7 days · proposed weights remain shadow-only`:'Collection is armed; no snapshots have been recorded yet.';
    host.querySelector('[data-cal-metrics]').innerHTML=[metric('Snapshots',String(total),`${future} future-thesis only`,total?'good':'neutral'),metric('7d mature',String(mature7),'primary calibration window',mature7>=MIN_SAMPLE?'good':mature7?'warn':'neutral'),metric('30d mature',String(mature30),'longer-term validation',mature30>=MIN_SAMPLE?'good':'neutral'),metric('Weight proposals',String(readySources),`≥${MIN_SAMPLE} mature 7d required`,readySources?'good':'neutral')].join('');
    host.querySelector('[data-cal-bands]').innerHTML=bandRows(bands||[]);
    host.querySelector('[data-cal-sources]').innerHTML=sourceRows(sources||[]);
  }catch(error){host.querySelector('[data-cal-status]').textContent=`Calibration data unavailable: ${error?.message||error}`}
  finally{loading=false}
}

document.addEventListener('collectish:admin-modules-ready',()=>{ensure();if(document.body.classList.contains('cx-admin-singles-active'))void load()});
document.addEventListener('collectish:admin-section-change',e=>{if(e.detail?.section==='singles')void load()});
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='admin')setTimeout(()=>{ensure();if(document.body.classList.contains('cx-admin-singles-active'))void load()},120)});

window.CollectishCatalystCalibration={load,render:ensure};
