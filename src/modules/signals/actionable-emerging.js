import store from '../../state/store.js';
import { rest } from '../../core/rest.js';

let rows=[];
let loading=null;
let loadedAt=0;
let error='';
const CACHE_MS=5*60*1000;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=v=>v==null?'—':`$${Number(v).toFixed(2)}`;
const pct=v=>v==null?'—':`${Number(v).toFixed(1)}%`;
const signalHost=()=>document.getElementById('cxSignals');
const signalsReady=()=>signalHost()?.dataset.cxLazyReady==='1';
const scoutRows=()=>store.get().scout?.rows||[];

function classLabel(r){return r.action_class==='action_now'?'ACTION NOW':r.action_class==='emerging_quick_turn'?'EMERGING QUICK TURN':'LIQUID SIGNAL WATCH'}
function classCss(r){return r.action_class==='action_now'?'leading':r.action_class==='emerging_quick_turn'?'confirming':'unclassified'}
function rowHtml(r){
  const trade=`Buy ${money(r.cheapest_buy)} · Direct net ${money(r.direct_net_est)} · profit ${money(r.direct_net_profit)}`;
  const margin=`ROI ${pct(r.direct_roi_pct)} · target ${pct(r.target_roi_pct)} · cushion +${pct(r.margin_cushion_pct)}`;
  const evidence=`${r.primary_signal||'Emerging signal'}${Number(r.signal_families||0)>1?` · ${r.signal_families} changing evidence families`:''}`;
  const market=`${r.liquidity_label} ${r.liquidity_score}/100 · Scout ${r.base_scout_score} → execution ${r.adjusted_scout_score}`;
  return `<button type="button" class="cx-detail-stat cx-scout-deep-link" data-action-sku="${esc(r.sku_id)}" data-action-product="${esc(r.product_id)}" data-action-card="${esc(r.card_name)}"><span><strong>${esc(r.card_name)}</strong><small>${esc(`${r.set_name||'Unknown set'} · ${r.printing||'printing unknown'}`)}</small><small>${esc(evidence)}</small></span><span><strong><span class="cx-signal-stage ${classCss(r)}">${esc(classLabel(r))}</span> <span class="cx-signal-stage confirming">ACTION ${esc(r.actionability_score)}</span></strong><small>${esc(market)}</small><small>${esc(`${trade} · ${margin}`)}</small></span></button>`;
}
function renderSignals(){
  if(!signalsReady())return;
  let panel=document.getElementById('cxActionableEmerging');
  if(!panel){
    panel=document.createElement('section');panel.id='cxActionableEmerging';panel.className='cx-card';panel.hidden=signalHost()?.dataset.signalsView!=='scan';
    const cross=document.getElementById('cxCrossSourceIntel'),comp=document.getElementById('cxCompetitiveIntel'),layout=signalHost()?.querySelector('.cx-signals-layout');
    if(cross)cross.insertAdjacentElement('beforebegin',panel);else if(comp)comp.insertAdjacentElement('beforebegin',panel);else if(layout)layout.insertAdjacentElement('beforebegin',panel);else signalHost()?.appendChild(panel);
  }
  if(loading){panel.innerHTML='<div class="cx-section-title">Actionable emerging opportunities</div><p class="cx-sub">Changing demand signals that also clear a liquidity-adjusted buying hurdle.</p><div class="cx-empty">Loading actionable opportunities…</div>';return}
  if(error){panel.innerHTML=`<div class="cx-section-title">Actionable emerging opportunities</div><div class="cx-empty">Unavailable: ${esc(error)}</div>`;return}
  const shown=rows.slice(0,8);
  panel.innerHTML=`<div class="cx-page-head"><div><div class="cx-section-title">Actionable emerging opportunities</div><p class="cx-sub">Something is changing, the selected printing is liquid, and estimated Direct ROI clears the margin target appropriate for that liquidity. This is the bridge from Signals to what may be worth buying now.</p></div><button type="button" class="cx-refresh" id="cxActionableRefresh">Refresh</button></div><div class="cx-detail-list">${shown.length?shown.map(rowHtml).join(''):'<div class="cx-empty">No emerging signal currently overlaps a liquid trade that clears its target margin.</div>'}</div>`;
  document.getElementById('cxActionableRefresh')?.addEventListener('click',()=>load({force:true}));
}
function matchAction(row){
  if(!row)return null;const sku=String(row.sku_id||''),pid=String(row.product_id||''),name=String(row.product_name||'').toLowerCase();
  return rows.find(x=>(sku&&String(x.sku_id||'')===sku)||(pid&&String(x.product_id||'')===pid)||String(x.card_name||'').toLowerCase()===name)||null;
}
function decorateScoutList(){
  const map=new Map(scoutRows().map(r=>[String(r.sku_id),r]));
  document.querySelectorAll('#cxParityCards .cx-scout-card').forEach(card=>{
    card.querySelector('.cx-actionable-badge')?.remove();const r=map.get(String(card.dataset.sku)),a=matchAction(r);if(!a)return;
    const top=card.querySelector('.cx-scout-card-top');if(!top)return;const b=document.createElement('span');b.className='cx-v5-badge cx-actionable-badge';b.textContent=a.action_class==='action_now'?`ACTION ${a.actionability_score}`:`EMERGING ${a.actionability_score}`;b.title=`${classLabel(a)} · ${a.primary_signal||'changing signal'} · ${a.liquidity_label} · ROI ${pct(a.direct_roi_pct)} vs ${pct(a.target_roi_pct)} target`;top.appendChild(b);
  });
}
function stat(label,value,sub=''){return `<div class="cx-v5-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`}
function decorateScoutDetail(sku){
  const h=document.getElementById('cxParityDetail');if(!h||!sku)return;h.querySelector('.cx-actionable-detail')?.remove();const r=scoutRows().find(x=>String(x.sku_id)===String(sku)),a=matchAction(r);if(!a)return;
  const section=document.createElement('section');section.className='cx-v5-section cx-actionable-detail';
  section.innerHTML=`<div class="cx-section-title">Actionable emerging <span class="cx-signal-stage ${classCss(a)}">${esc(classLabel(a))}</span></div><div class="cx-v5-grid">${stat('Actionability',`${a.actionability_score}/100`,a.primary_signal||'changing signal')}${stat('Changing sources',`${a.signal_families}`,a.signal_labels||'')}${stat('Liquidity',`${a.liquidity_label} · ${a.liquidity_score}/100`)}${stat('Margin clearance',`${pct(a.direct_roi_pct)} ROI`,`${pct(a.target_roi_pct)} target · +${pct(a.margin_cushion_pct)} cushion`)}</div><small class="cx-sub">${esc(a.action_reason||'Emerging demand and executable trade conditions currently overlap.')}</small>`;
  const liq=h.querySelector('.cx-liquidity-section'),intel=h.querySelector('.cx-intelligence-detail');if(liq)liq.insertAdjacentElement('afterend',section);else if(intel)intel.insertAdjacentElement('beforebegin',section);else h.appendChild(section);
}
function openScout(el){document.dispatchEvent(new CustomEvent('collectish:open-scout-card',{detail:{sku_id:el.dataset.actionSku||null,product_id:el.dataset.actionProduct||null,card_name:el.dataset.actionCard||null}}))}
document.addEventListener('click',e=>{const el=e.target.closest?.('#cxActionableEmerging [data-action-sku]');if(!el||e.target.closest('a,input,select,textarea'))return;e.preventDefault();openScout(el)},true);
async function load({force=false}={}){
  if(loading)return loading;
  if(!force&&loadedAt&&Date.now()-loadedAt<CACHE_MS){renderSignals();decorateScoutList();decorateScoutDetail(store.get().scout?.selectedSku);return rows}
  error='';
  loading=rest('rpc/actionable_emerging_opportunities',{method:'POST',body:{p_limit:80}}).then(data=>{rows=Array.isArray(data)?data:[];loadedAt=Date.now();store.update('actionableEmerging',{rows,loadedAt,error:null});document.dispatchEvent(new CustomEvent('collectish:actionable-emerging-changed',{detail:{count:rows.length}}));return rows}).catch(e=>{rows=[];error=String(e?.message||e||'Request failed');store.update('actionableEmerging',{rows:[],error,loadedAt:Date.now()});return rows}).finally(()=>{loading=null;renderSignals();decorateScoutList();decorateScoutDetail(store.get().scout?.selectedSku)});
  renderSignals();return loading;
}
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals'&&signalsReady())setTimeout(()=>void load().catch(()=>{}),500);if(e.detail?.page==='scout')setTimeout(()=>{decorateScoutList();decorateScoutDetail(store.get().scout?.selectedSku);void load()},1200)});
document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='signals')setTimeout(()=>void load().catch(()=>{}),500)});
document.addEventListener('collectish:scout-list-rendered',()=>{if(rows.length)decorateScoutList();else void load()});
document.addEventListener('collectish:scout-detail-rendered',e=>{if(rows.length)decorateScoutDetail(e.detail?.sku);else void load()});
document.addEventListener('collectish:intel-changed',()=>{loadedAt=0;if(signalsReady())void load({force:true})});
document.addEventListener('collectish:competitive-changed',()=>{loadedAt=0;if(signalsReady())void load({force:true})});
document.addEventListener('collectish:commander-intel-changed',()=>{loadedAt=0;if(signalsReady())void load({force:true})});
export {load as loadActionableEmerging};
