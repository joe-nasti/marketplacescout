import store from '../../state/store.js';
import { rest } from '../../core/rest.js';

let bySku=new Map();
let loading=null;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pretty=s=>String(s||'').replaceAll('_',' ').replace(/\b\w/g,m=>m.toUpperCase());
const money=v=>v==null?'—':`$${Number(v).toFixed(2)}`;
const lifecycleLabel=s=>({fresh_catalyst:'Fresh catalyst',still_unpriced_24h:'Still unpriced 24h+',still_unpriced_72h:'Still unpriced 72h+',still_unpriced_7d:'Still unpriced 7d+',starting_to_react:'Starting to react',market_caught_up:'Market caught up'})[String(s||'')]||pretty(s||'watching');

async function load(){
  if(loading)return loading;
  loading=rest('market_intel_scout_synergy_lifecycle?select=sku_id,target_card_name,source_card_name,source_name,source_url,relationship_type,conviction,summary,synergy_priority_score,lifecycle_priority_score,synergy_lifecycle_state,convergence_state,catalyst_age_hours,synergy_printing_rank,scout_grade,scout_score,cheapest_buy,cheapest_source,direct_low,direct_net_profit,avg_daily_qty_sold,direct_available,direct_listings,expected_market_reaction_score,expected_reaction_confidence,market_response_score,market_response_status,unpriced_catalyst_gap_score,unpriced_catalyst_gap_state,convergence_score,latest_horizon,risk_flags&order=lifecycle_priority_score.desc&limit=1000')
    .then(rows=>{
      bySku=new Map();
      for(const r of rows||[]){const k=String(r.sku_id||'');if(!k||bySku.has(k))continue;bySku.set(k,r)}
      decorateList();decorateDetail(store.get().scout?.selectedSku||null);
    }).catch(()=>{}).finally(()=>{loading=null});
  return loading;
}

function decorateList(){
  document.querySelectorAll('#cxParityCards .cx-scout-card').forEach(card=>{
    card.querySelector('.cx-synergy-mini')?.remove();
    const r=bySku.get(String(card.dataset.sku||''));if(!r)return;
    const top=card.querySelector('.cx-scout-card-top');if(!top)return;
    const badge=document.createElement('span');
    const state=String(r.synergy_lifecycle_state||'fresh_catalyst');
    badge.className=`cx-intel-mini cx-synergy-mini ${state==='market_caught_up'?'cx-urgency-standard':'cx-urgency-elevated'}`;
    badge.textContent=`↗ ${lifecycleLabel(state)} · ${r.lifecycle_priority_score} · gap ${r.unpriced_catalyst_gap_score??'—'}`;
    badge.title=`${r.target_card_name} is recommended because of ${r.source_card_name}. ${lifecycleLabel(state)}; ${pretty(r.convergence_state||'single_source')}. Scout grade ${r.scout_grade||'—'} is unchanged.`;
    top.appendChild(badge);
  });
}

function decorateDetail(sku){
  const host=document.getElementById('cxParityDetail');if(!host||!sku)return;
  host.querySelector('.cx-synergy-detail')?.remove();
  const r=bySku.get(String(sku));if(!r)return;
  const section=document.createElement('section');section.className='cx-v5-section cx-synergy-detail';
  const risks=Array.isArray(r.risk_flags)?r.risk_flags:[];
  const age=Math.max(0,Number(r.catalyst_age_hours||0));
  const ageLabel=age<24?`${Math.round(age)}h old`:`${(age/24).toFixed(age<72?1:0)}d old`;
  section.innerHTML=`<div class="cx-section-title">Unpriced synergy <span class="cx-intel-context">time-aware discovery priority · Scout grade unchanged</span></div>
    <div class="cx-v5-component"><strong>${esc(r.target_card_name)} ← ${esc(r.source_card_name)} · ${esc(lifecycleLabel(r.synergy_lifecycle_state))}</strong>
      <small>Lifecycle priority ${esc(r.lifecycle_priority_score)} · base synergy ${esc(r.synergy_priority_score)} · ${esc(ageLabel)} · ${esc(pretty(r.convergence_state||'single_source'))} (${esc(r.convergence_score??0)})</small>
      <small>${esc(r.source_name||'Creator')} · conviction ${Math.round(Number(r.conviction||0)*100)} · ${esc(pretty(r.relationship_type))}</small>
      <small>Expected reaction ${esc(r.expected_market_reaction_score??'—')} · Market ${esc(r.market_response_score??'—')} · Gap ${esc(r.unpriced_catalyst_gap_score??'—')} · ${esc(pretty(r.unpriced_catalyst_gap_state||'watching'))}</small>
      <small>Scout ${esc(r.scout_grade||'—')} / ${esc(r.scout_score??'—')} · buy ${esc(money(r.cheapest_buy))} ${r.cheapest_source?`(${esc(r.cheapest_source)})`:''} · Direct ${esc(money(r.direct_low))} · est. profit ${esc(money(r.direct_net_profit))}</small>
      <small>Direct supply ${esc(r.direct_available??'—')} · listings ${esc(r.direct_listings??'—')} · velocity ${esc(r.avg_daily_qty_sold??'—')}/d · calibration ${esc(pretty(r.expected_reaction_confidence||'unknown'))}${r.latest_horizon?` · observed through ${esc(r.latest_horizon)}`:''}</small>
      ${r.summary?`<small>${esc(r.summary)}</small>`:''}${risks.length?`<small>Risks: ${esc(risks.map(pretty).join(', '))}</small>`:''}
    </div>`;
  const anchor=host.querySelector('.cx-intel-detail')||host.querySelector('.cx-v5-components')||host.firstElementChild;
  if(anchor?.parentNode)anchor.parentNode.insertBefore(section,anchor.nextSibling);else host.appendChild(section);
}

document.addEventListener('collectish:scout-list-rendered',()=>bySku.size?decorateList():load());
document.addEventListener('collectish:scout-detail-rendered',e=>bySku.size?decorateDetail(e.detail?.sku):load());
document.addEventListener('collectish:intel-changed',()=>{bySku.clear();load()});
document.addEventListener('collectish:ready',()=>load());

load();
