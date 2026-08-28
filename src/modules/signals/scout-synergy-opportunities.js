import store from '../../state/store.js';
import { rest } from '../../core/rest.js';

let bySku=new Map();
let loading=null;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pretty=s=>String(s||'').replaceAll('_',' ').replace(/\b\w/g,m=>m.toUpperCase());
const money=v=>v==null?'—':`$${Number(v).toFixed(2)}`;

async function load(){
  if(loading)return loading;
  loading=rest('market_intel_scout_synergy_opportunities?select=sku_id,target_card_name,source_card_name,source_name,source_url,relationship_type,conviction,summary,synergy_priority_score,synergy_printing_rank,scout_grade,scout_score,cheapest_buy,cheapest_source,direct_low,direct_net_profit,avg_daily_qty_sold,direct_available,direct_listings,expected_market_reaction_score,expected_reaction_confidence,market_response_score,market_response_status,unpriced_catalyst_gap_score,unpriced_catalyst_gap_state,latest_horizon,risk_flags&order=synergy_priority_score.desc&limit=1000')
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
    badge.className='cx-intel-mini cx-synergy-mini cx-urgency-elevated';
    badge.textContent=`↗ Synergy ${r.synergy_priority_score} · gap ${r.unpriced_catalyst_gap_score??'—'}`;
    badge.title=`${r.target_card_name} is recommended because of ${r.source_card_name}. Scout grade ${r.scout_grade||'—'} is unchanged; this is discovery priority only.`;
    top.appendChild(badge);
  });
}

function decorateDetail(sku){
  const host=document.getElementById('cxParityDetail');if(!host||!sku)return;
  host.querySelector('.cx-synergy-detail')?.remove();
  const r=bySku.get(String(sku));if(!r)return;
  const section=document.createElement('section');section.className='cx-v5-section cx-synergy-detail';
  const risks=Array.isArray(r.risk_flags)?r.risk_flags:[];
  section.innerHTML=`<div class="cx-section-title">Unpriced synergy <span class="cx-intel-context">discovery priority only · Scout grade unchanged</span></div>
    <div class="cx-v5-component"><strong>${esc(r.target_card_name)} ← ${esc(r.source_card_name)} · priority ${esc(r.synergy_priority_score)}</strong>
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
