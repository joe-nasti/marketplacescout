import store from '../../state/store.js';
import { rest } from '../../core/rest.js';

let rows=[];
let loading=null;
let loadedAt=0;
let error='';
const CACHE_MS=5*60*1000;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=v=>v==null?'—':`$${Number(v).toFixed(2)}`;
const host=()=>document.getElementById('cxSignals');
const ready=()=>host()?.dataset.cxLazyReady==='1';
const emerging=()=>rows.filter(r=>Number(r.dynamic_sources||0)>0).slice(0,8);
const broad=()=>rows.filter(r=>Number(r.dynamic_sources||0)===0).slice(0,8);
function shared(){const intel=store.get().intel||{},data=Array.isArray(intel.crossSourceRows)?intel.crossSourceRows:[],at=Number(intel.crossSourceLoadedAt||0);return{data,at}}
function saveShared(data,at=Date.now()){store.update('intel',{crossSourceRows:data,crossSourceLoadedAt:at})}

function evidenceLine(r){
  const bits=[];
  if(r.competitive_decks!=null)bits.push(`${r.competitive_formats||'60-card'} ${r.competitive_decks} decks${r.competitive_top8!=null?` · ${r.competitive_top8} Top 8`:''}`);
  if(r.edhrec_rank!=null)bits.push(`EDHREC #${r.edhrec_rank}${r.edh_rank_improvement_pct!=null?` · ${Number(r.edh_rank_improvement_pct)>=0?'+':''}${Number(r.edh_rank_improvement_pct).toFixed(0)}% rank move`:''}`);
  if(r.cedh_decks!=null)bits.push(`cEDH ${r.cedh_decks} lists · ${r.cedh_share_pct??'—'}% structured-list share`);
  if(r.intel_items!=null)bits.push(`${r.intel_items} article/social signal${Number(r.intel_items)===1?'':'s'} · ${r.intel_sources||1} source${Number(r.intel_sources||1)===1?'':'s'}`);
  return bits.join(' · ');
}
function label(r){
  if(r.watch_class==='cross_source_breakout'||r.watch_class==='corroborated_breakout')return'EMERGING MULTI-SOURCE';
  if(Number(r.evidence_sources||0)>=3)return'HIGH-CONVICTION WATCH';
  return'CORROBORATED SETUP';
}
function rowHtml(r){
  const cls=Number(r.dynamic_sources||0)>0?'leading':'confirming';
  const market=`${r.set_name||'Scout printing'} · ${r.printing||'printing'} · Market ${money(r.market_price)} · Direct ${money(r.direct_low)} · ${r.direct_available??'—'} Direct qty · Scout ${r.opportunity_score??'—'}`;
  return `<div class="cx-detail-stat cx-scout-deep-link" data-open-scout="1" data-sku="${esc(r.sku_id||'')}" data-product="${esc(r.product_id||'')}" data-card="${esc(r.card_name)}" role="button" tabindex="0" title="Open in Scout"><span><strong>${esc(r.card_name)}</strong><small>${esc(evidenceLine(r))}</small><small>${esc(market)}</small></span><span><strong><span class="cx-signal-stage ${cls}">${esc(label(r))}</span> <span class="cx-signal-stage confirming">CORROBORATION ${esc(r.corroboration_score)}</span></strong><small>${esc(`${r.evidence_sources} independent evidence families${Number(r.dynamic_sources||0)>0?` · ${r.dynamic_sources} changing/new`:''}`)}</small><small>${esc(r.watch_reason||'Multiple sources align with the selected Scout setup.')}</small></span></div>`;
}
function section(title,sub,data){return `<div class="cx-section-title">${esc(title)}</div><p class="cx-sub">${esc(sub)}</p><div class="cx-detail-list">${data.length?data.map(rowHtml).join(''):'<div class="cx-empty">Nothing qualifies yet.</div>'}</div>`}
function render(){
  const h=host();if(!h||!ready())return;
  let panel=document.getElementById('cxCrossSourceIntel');
  if(!panel){panel=document.createElement('section');panel.id='cxCrossSourceIntel';panel.className='cx-card';panel.hidden=h.dataset.signalsView!=='scan';const comp=document.getElementById('cxCompetitiveIntel'),layout=h.querySelector('.cx-signals-layout');if(comp)comp.insertAdjacentElement('beforebegin',panel);else if(layout)layout.insertAdjacentElement('beforebegin',panel);else h.appendChild(panel)}
  if(loading){panel.innerHTML=`<div class="cx-section-title">High-conviction watches</div><p class="cx-sub">Cross-source corroboration across competitive play, Commander demand, community intelligence and Scout market setup.</p><div class="cx-empty">Loading cross-source watches…</div>`;return}
  if(error){panel.innerHTML=`<div class="cx-section-title">High-conviction watches</div><p class="cx-sub">Cross-source corroboration is context only and does not change the Scout grade.</p><div class="cx-empty">Unavailable: ${esc(error)}</div>`;return}
  const e=emerging(),b=broad();
  panel.innerHTML=`<div class="cx-section-title">High-conviction watches</div><p class="cx-sub">Independent evidence families are combined without double-counting cEDH as 60-card competitive. Scout supply/price is the market setup—not another evidence vote. Corroboration does not change the Scout grade.</p>${section('Emerging corroborated watches','At least two independent evidence families align, and at least one source is showing a changing/new signal.',e)}${section('Broadly corroborated setups','Established demand confirmed by multiple independent sources where the selected Scout printing remains worth evaluating.',b)}`;
}
async function load({force=false}={}){
  if(loading)return loading;
  const cached=shared();
  if(!force&&cached.data.length&&Date.now()-cached.at<CACHE_MS){rows=cached.data;loadedAt=cached.at;render();return rows}
  if(!force&&loadedAt&&Date.now()-loadedAt<CACHE_MS){render();return rows}
  error='';
  loading=rest('rpc/cross_source_market_watches',{method:'POST',body:{p_limit:80}}).then(data=>{rows=Array.isArray(data)?data:[];loadedAt=Date.now();saveShared(rows,loadedAt);document.dispatchEvent(new CustomEvent('collectish:cross-source-changed',{detail:{count:rows.length,rows,loadedAt}}));return rows}).catch(e=>{rows=[];error=String(e?.message||e||'Request failed');return rows}).finally(()=>{loading=null;render()});
  render();return loading;
}
function openScout(el){document.dispatchEvent(new CustomEvent('collectish:open-scout-card',{detail:{sku_id:el.dataset.sku||null,product_id:el.dataset.product||null,card_name:el.dataset.card||null}}))}
document.addEventListener('click',e=>{const el=e.target.closest?.('#cxCrossSourceIntel [data-open-scout="1"]');if(!el||e.target.closest('a,button,input,select,textarea'))return;e.preventDefault();openScout(el)},true);
document.addEventListener('keydown',e=>{if(e.key!=='Enter'&&e.key!==' ')return;const el=e.target.closest?.('#cxCrossSourceIntel [data-open-scout="1"]');if(!el)return;e.preventDefault();openScout(el)},true);
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals'&&ready())queueMicrotask(()=>load().catch(()=>{}))});
document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='signals')queueMicrotask(()=>load().catch(()=>{}))});
document.addEventListener('collectish:intel-changed',()=>{loadedAt=0;if(ready())void load({force:true})});
document.addEventListener('collectish:competitive-changed',()=>{loadedAt=0;if(ready())void load({force:true})});
document.addEventListener('collectish:commander-intel-changed',()=>{loadedAt=0;if(ready())void load({force:true})});
if(ready())queueMicrotask(()=>load().catch(()=>{}));

export {load as loadCrossSourceWatches};
