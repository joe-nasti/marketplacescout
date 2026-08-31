import {rest} from '../../core/rest.js';

let loading=false,deciding=false;
const MIN_SAMPLE=8;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const num=v=>Number.isFinite(Number(v))?Number(v):0;
const pct=v=>v==null||!Number.isFinite(Number(v))?'—':`${Number(v)>=0?'+':''}${Number(v).toFixed(1)}%`;
const fmt=v=>v==null||!Number.isFinite(Number(v))?'—':Number(v).toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
const key=s=>String(s||'').trim().toLowerCase();

function ensure(){
  const parent=document.getElementById('cxAdminSinglesModules');if(!parent)return null;
  let host=document.getElementById('cxCatalystCalibration');
  if(!host){
    host=document.createElement('section');host.id='cxCatalystCalibration';host.className='cx-admin-module cx-catalyst-calibration';
    host.innerHTML=`<div class="cx-cal-head"><div><span>SCOUT × SIGNALS</span><h3>Catalyst calibration</h3><p>Shadow validation and candidate promotion. Official Scout ranking and production source weights remain unchanged.</p></div><button type="button" class="cx-refresh" data-cal-refresh>Refresh</button></div><div class="cx-cal-status" data-cal-status>Loading calibration data…</div><div class="cx-cal-metrics" data-cal-metrics></div><section class="cx-cal-candidate-model"><div class="cx-cal-section-head"><strong>Candidate model backtest</strong><small>Approved candidate weights are rescored against the same historical outcomes. Production remains untouched.</small></div><div data-cal-candidate-model></div></section><div class="cx-cal-grid"><section><div class="cx-cal-section-head"><strong>Modifier bands</strong><small>Does more catalyst conviction produce better outcomes?</small></div><div data-cal-bands></div></section><section><div class="cx-cal-section-head"><strong>Sources & creators</strong><small>Proposals require ≥${MIN_SAMPLE} mature 7-day observations. Approval creates a candidate model only.</small></div><div data-cal-sources></div></section></div>`;
    parent.prepend(host);
    host.querySelector('[data-cal-refresh]')?.addEventListener('click',()=>load());
    host.addEventListener('click',onDecisionClick);
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
function proposalLabel(r,candidate){
  if(candidate?.candidate_weight!=null)return `<span class="cx-cal-weight approved"><b>${fmt(r.current_weight)}</b><i>→</i><strong>${fmt(candidate.candidate_weight)}</strong><small>CANDIDATE</small></span>`;
  if(r.proposed_weight!=null)return `<span class="cx-cal-weight"><b>${fmt(r.current_weight)}</b><i>→</i><strong>${fmt(r.proposed_weight)}</strong><small>${esc(String(r.recommendation||'proposal').toUpperCase())}</small></span>`;
  return `<span class="cx-cal-weight pending"><b>${fmt(r.current_weight)}</b><i>→</i><strong>—</strong><small>WAIT</small></span>`;
}
function governanceActions(r,candidate){
  if(candidate?.candidate_weight!=null)return `<div class="cx-cal-governance"><button type="button" data-cal-decision="revoked" data-source="${esc(r.source_label)}">Revoke candidate</button><small>Production unchanged</small></div>`;
  const eligible=maturity(r,'7d')>=MIN_SAMPLE&&r.proposed_weight!=null;
  if(!eligible)return `<div class="cx-cal-governance locked"><span>${maturity(r,'7d')}/${MIN_SAMPLE} mature</span><small>Promotion locked</small></div>`;
  return `<div class="cx-cal-governance"><button type="button" class="approve" data-cal-decision="approved_candidate" data-source="${esc(r.source_label)}">Approve candidate</button><button type="button" data-cal-decision="rejected" data-source="${esc(r.source_label)}">Reject</button></div>`;
}
function sourceRows(rows,candidates=[]){
  if(!rows.length)return '<div class="cx-cal-empty">Source/creator calibration will populate as shadow snapshots mature.</div>';
  const candidateMap=new Map((candidates||[]).map(x=>[key(x.source_label),x]));
  const sorted=[...rows].sort((a,b)=>maturity(b,'7d')-maturity(a,'7d')||num(b.snapshots)-num(a.snapshots)).slice(0,24);
  return `<div class="cx-cal-sources">${sorted.map(r=>{const n=maturity(r,'7d'),state=sampleState(n),candidate=candidateMap.get(key(r.source_label));return `<article class="cx-cal-source ${state}${candidate?.candidate_weight!=null?' candidate':''}"><div class="cx-cal-source-main"><strong>${esc(r.source_label)}</strong><small>${esc(r.source_type)} · ${r.snapshots} snapshots · ${n} mature 7d · confidence ${esc(r.proposal_confidence||'pending')}</small>${proposalLabel(r,candidate)}</div><div class="cx-cal-source-outcomes"><span><b>${pct(r.avg_market_change_7d_pct)}</b><small>7d price</small></span><span><b>${fmt(r.avg_transactions_7d)}</b><small>7d tx</small></span><span><b>${r.historical_predictive_pct==null?'—':`${fmt(r.historical_predictive_pct)}%`}</b><small>historic predictive</small></span></div>${governanceActions(r,candidate)}</article>`}).join('')}</div>`;
}
function candidateModel(metrics,candidates=[]){
  const approved=(candidates||[]).filter(x=>x.candidate_weight!=null).length;
  if(!approved)return '<div class="cx-cal-empty">Candidate model inactive. No source weights have been approved into candidate status yet.</div>';
  const m=(metrics||[])[0];
  if(!m)return `<div class="cx-cal-empty">${approved} candidate weight${approved===1?' is':'s are'} approved, but no mature 7-day comparison cohort exists yet.</div>`;
  const lift=num(m.separation_lift_7d),state=lift>0?'good':lift<0?'bad':'neutral';
  return `<div class="cx-cal-model-grid"><div class="cx-cal-model-card"><span>Candidate affected</span><strong>${esc(m.candidate_affected_snapshots)}</strong><small>of ${esc(m.matured_7d)} mature 7d snapshots</small></div><div class="cx-cal-model-card"><span>Current separation</span><strong>${pct(m.current_separation_7d)}</strong><small>high-catalyst minus nonpositive cohort</small></div><div class="cx-cal-model-card"><span>Candidate separation</span><strong>${pct(m.candidate_separation_7d)}</strong><small>same outcome cohort, candidate weights</small></div><div class="cx-cal-model-card ${state}"><span>Separation lift</span><strong>${pct(m.separation_lift_7d)}</strong><small>${lift>0?'candidate separating outcomes better':lift<0?'candidate separating outcomes worse':'no measured lift yet'}</small></div></div>`;
}
async function decide(source,decision){
  if(deciding||!source||!decision)return;
  if(decision==='approved_candidate'&&!window.confirm(`Approve ${source}'s proposed weight into the candidate model? Production Scout will remain unchanged.`))return;
  if(decision==='revoked'&&!window.confirm(`Revoke ${source} from the candidate model?`))return;
  deciding=true;const host=ensure();if(host)host.querySelector('[data-cal-status]').textContent=`Recording ${decision.replace(/_/g,' ')} for ${source}…`;
  try{await rest('rpc/review_catalyst_weight_proposal',{method:'POST',body:{p_source_label:source,p_decision:decision,p_note:null}});await load(true)}catch(error){if(host)host.querySelector('[data-cal-status]').textContent=`Decision failed: ${error?.message||error}`}finally{deciding=false}
}
function onDecisionClick(event){const b=event.target.closest?.('[data-cal-decision]');if(!b)return;void decide(b.dataset.source,b.dataset.calDecision)}
async function load(force=false){
  const host=ensure();if(!host||loading)return;loading=true;host.querySelector('[data-cal-status]').textContent='Reading shadow outcomes and governance state…';
  try{
    const options=force?{method:'POST',body:{},force:true}:{method:'POST',body:{}};
    const payload=await rest('rpc/get_catalyst_calibration',options);
    const bands=payload?.bands||[],proposals=payload?.proposals||[],candidates=payload?.candidates||[],shots=payload?.shots||[],candidateMetrics=payload?.candidateMetrics||[];
    const total=shots.length,future=shots.filter(x=>x.future_release).length,mature7=bands.reduce((s,x)=>s+maturity(x,'7d'),0),ready=proposals.filter(x=>x.proposed_weight!=null&&maturity(x,'7d')>=MIN_SAMPLE).length,approved=candidates.filter(x=>x.candidate_weight!=null).length;
    host.querySelector('[data-cal-status]').textContent=total?`${total} shadow snapshot${total===1?'':'s'} · ${mature7} mature through 7d · ${approved} approved candidate weight${approved===1?'':'s'}`:'Collection is armed; no snapshots have been recorded yet.';
    host.querySelector('[data-cal-metrics]').innerHTML=[metric('Snapshots',String(total),`${future} future-thesis only`,total?'good':'neutral'),metric('7d mature',String(mature7),'primary calibration window',mature7>=MIN_SAMPLE?'good':mature7?'warn':'neutral'),metric('Promotion ready',String(ready),`proposal + ≥${MIN_SAMPLE} mature 7d`,ready?'good':'neutral'),metric('Candidate weights',String(approved),'approved shadow model only',approved?'warn':'neutral')].join('');
    host.querySelector('[data-cal-candidate-model]').innerHTML=candidateModel(candidateMetrics,candidates);
    host.querySelector('[data-cal-bands]').innerHTML=bandRows(bands);
    host.querySelector('[data-cal-sources]').innerHTML=sourceRows(proposals,candidates);
  }catch(error){host.querySelector('[data-cal-status]').textContent=`Calibration data unavailable: ${error?.message||error}`}
  finally{loading=false}
}

document.addEventListener('collectish:admin-modules-ready',()=>{ensure();if(document.body.classList.contains('cx-admin-singles-active'))void load()});
document.addEventListener('collectish:admin-section-change',e=>{if(e.detail?.section==='singles')void load()});
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='admin')setTimeout(()=>{ensure();if(document.body.classList.contains('cx-admin-singles-active'))void load()},120)});

window.CollectishCatalystCalibration={load,render:ensure};
