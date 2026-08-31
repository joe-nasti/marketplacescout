import {rest} from '../../core/rest.js';

let loading=false,deciding=false;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const num=v=>Number.isFinite(Number(v))?Number(v):0;
const pct=v=>v==null||!Number.isFinite(Number(v))?'—':`${Number(v)>=0?'+':''}${Number(v).toFixed(1)}%`;

function ensure(){
  const parent=document.querySelector('#cxCatalystCalibration .cx-cal-candidate-model')?.parentElement||document.getElementById('cxCatalystCalibration');
  if(!parent)return null;
  let host=document.getElementById('cxCatalystProductionPromotion');
  if(!host){
    host=document.createElement('section');host.id='cxCatalystProductionPromotion';host.className='cx-cal-production';
    host.innerHTML=`<div class="cx-cal-section-head"><strong>Production promotion gate</strong><small>Candidate model must pass every safety gate before production review is available. Production scoring is not changed by this screen.</small></div><div data-production-gate></div>`;
    const anchor=parent.querySelector('.cx-cal-candidate-model');
    if(anchor)anchor.insertAdjacentElement('afterend',host);else parent.appendChild(host);
    host.addEventListener('click',onClick);
  }
  return host;
}
function gate(label,pass,detail){return `<div class="cx-prod-gate ${pass?'pass':'fail'}"><span>${pass?'✓':'○'}</span><div><strong>${esc(label)}</strong><small>${esc(detail)}</small></div></div>`}
function renderGate(row,state){
  const host=ensure();if(!host)return;
  const box=host.querySelector('[data-production-gate]');
  if(!row){box.innerHTML='<div class="cx-cal-empty">Production promotion is inactive until at least one approved candidate weight produces an active candidate backtest.</div>';return}
  const gates=[
    gate('7d affected sample',Boolean(row.gate_sample_7d),`${row.affected_matured_7d||0}/30 mature affected observations`),
    gate('30d affected sample',Boolean(row.gate_sample_30d),`${row.affected_matured_30d||0}/10 mature affected observations`),
    gate('7d separation lift',Boolean(row.gate_lift_7d),`${pct(row.separation_lift_7d)} · requires ≥ +2.0 pts`),
    gate('30d persistence',Boolean(row.gate_lift_30d),`${pct(row.separation_lift_30d)} · cannot degrade`),
    gate('False-positive safety',Boolean(row.gate_false_positives),`${pct(row.current_false_positive_pct_7d)} current → ${pct(row.candidate_false_positive_pct_7d)} candidate`),
    gate('Downside cohort safety',Boolean(row.gate_downside),`${pct(row.current_low_avg_7d)} current → ${pct(row.candidate_low_avg_7d)} candidate`),
    gate('Source diversity',Boolean(row.gate_source_diversity),`${row.approved_candidate_sources||0}/3 approved candidate sources`),
    gate('Grade-crossing safety',Boolean(row.gate_grade_crossings),`${row.promoted_to_ab_matured_7d||0} C-or-lower → A/B crossings · ${pct(row.promoted_to_ab_avg_7d)} avg 7d`)
  ].join('');
  const approved=Boolean(state?.approved_for_production),eligible=Boolean(row.eligible_for_production_review);
  let actions='';
  if(approved)actions=`<div class="cx-prod-actions approved"><strong>APPROVED FOR PRODUCTION</strong><small>Governance approval recorded. Production scorer still requires explicit model deployment.</small><button type="button" data-production-decision="revoked">Revoke approval</button></div>`;
  else if(eligible)actions=`<div class="cx-prod-actions eligible"><strong>ELIGIBLE FOR REVIEW</strong><small>All safety gates pass. This records approval only; it does not deploy weights into Scout.</small><button type="button" class="approve" data-production-decision="approved_for_production">Approve for production</button><button type="button" data-production-decision="rejected">Reject</button></div>`;
  else actions=`<div class="cx-prod-actions locked"><strong>NOT ELIGIBLE</strong><small>Production promotion remains locked until every gate passes.</small></div>`;
  box.innerHTML=`<div class="cx-prod-summary"><div><span>7d separation</span><strong>${pct(row.current_separation_7d)} → ${pct(row.candidate_separation_7d)}</strong></div><div><span>30d separation</span><strong>${pct(row.current_separation_30d)} → ${pct(row.candidate_separation_30d)}</strong></div><div><span>Grade changes</span><strong>${row.grade_changed_snapshots||0}</strong></div><div><span>Status</span><strong>${approved?'Approved':eligible?'Eligible':'Locked'}</strong></div></div><div class="cx-prod-gates">${gates}</div>${actions}`;
}
async function decide(decision){
  if(deciding||!decision)return;
  const copy=decision==='approved_for_production'?'Approve this candidate model for production review? This records governance approval but does not deploy it into Scout.':decision==='revoked'?'Revoke the production approval for this candidate model?':'Reject this candidate model for production promotion?';
  if(!window.confirm(copy))return;
  deciding=true;
  try{await rest('rpc/review_catalyst_candidate_for_production',{method:'POST',body:{p_decision:decision,p_note:null}});await load(true)}catch(error){document.dispatchEvent(new CustomEvent('collectish:toast',{detail:{message:`Production review failed: ${error?.message||error}`}}))}finally{deciding=false}
}
function onClick(event){const b=event.target.closest?.('[data-production-decision]');if(b)void decide(b.dataset.productionDecision)}
async function load(force=false){
  const host=ensure();if(!host||loading)return;loading=true;
  try{
    const options=force?{force:true}:{};
    const [gateRows,stateRows]=await Promise.all([
      rest('market_intel_catalyst_candidate_promotion_gate?select=*',options),
      rest('market_intel_catalyst_production_promotion_state?select=*&order=decided_at.desc&limit=1',options)
    ]);
    renderGate(gateRows?.[0]||null,stateRows?.[0]||null);
  }catch(error){host.querySelector('[data-production-gate]').innerHTML=`<div class="cx-cal-empty">Production promotion gate unavailable: ${esc(error?.message||error)}</div>`}finally{loading=false}
}

document.addEventListener('collectish:admin-modules-ready',()=>{ensure();if(document.body.classList.contains('cx-admin-singles-active'))void load()});
document.addEventListener('collectish:admin-section-change',e=>{if(e.detail?.section==='singles')void load()});
document.addEventListener('collectish:catalyst-shadow-recorded',()=>{if(document.body.classList.contains('cx-admin-singles-active'))void load(true)});

window.CollectishCatalystProductionPromotion={load,render:ensure};
