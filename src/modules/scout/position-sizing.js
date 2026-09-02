import store from '../../state/store.js';
import { rest } from '../../core/rest.js';
import { uiEvidenceMarker } from '../../core/ui-primitives.js';

let rows=[];
let loading=null;
let loadedAt=0;
const CACHE_MS=5*60*1000;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=v=>v==null?'—':`$${Number(v).toFixed(2)}`;
const days=v=>v==null?'—':`${Number(v).toFixed(0)}d`;
const scoutRows=()=>store.get().scout?.rows||[];

function bySku(){return new Map(rows.map(r=>[String(r.sku_id),r]))}
function matchScout(row){if(!row)return null;const sku=String(row.sku_id||''),pid=String(row.product_id||'');return rows.find(x=>(sku&&String(x.sku_id||'')===sku)||(pid&&String(x.product_id||'')===pid))||null}
function sizingMarker(){return uiEvidenceMarker('inferred','Modeled position capacity. This does not mean this many copies are available at the displayed buy reference or that they will exit at Direct Low.')}
function inlineText(r){if(!r)return'';return r.suggested_additional_qty>0?`SIZE +${r.suggested_additional_qty} ${sizingMarker()} · ${money(r.suggested_capital)} ref · ~${days(r.expected_days_to_exit)}`:`OWN ${Number(r.existing_qty||0).toFixed(0)} · sized`}
function decorateExecutionPanels(){
  const map=bySku();
  document.querySelectorAll('[data-quick-turn-sku],[data-action-sku]').forEach(el=>{
    el.querySelector('.cx-position-inline')?.remove();
    const sku=el.dataset.quickTurnSku||el.dataset.actionSku;const r=map.get(String(sku||''));if(!r)return;
    const target=el.querySelector('span:last-child')||el;const s=document.createElement('small');s.className='cx-position-inline';s.innerHTML=`Position: ${inlineText(r)}`;target.appendChild(s);
  });
}
function decorateScoutList(){
  const scoutMap=new Map(scoutRows().map(r=>[String(r.sku_id),r]));
  document.querySelectorAll('#cxParityCards .cx-scout-card').forEach(card=>{
    card.querySelector('.cx-position-badge')?.remove();const base=scoutMap.get(String(card.dataset.sku)),r=matchScout(base);if(!r||Number(r.suggested_additional_qty||0)<3)return;
    const top=card.querySelector('.cx-scout-card-top');if(!top)return;const b=document.createElement('span');b.className='cx-v5-badge cx-position-badge';b.innerHTML=`SIZE +${esc(r.suggested_additional_qty)} ${sizingMarker()}`;b.title=`Modeled additional position · ${money(r.suggested_capital)} reference capital · modeled ${days(r.expected_days_to_exit)} exit`;top.appendChild(b);
  });
}
function stat(label,value,sub=''){return `<div class="cx-v5-stat"><span>${esc(label)}</span><strong>${value}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`}
function decorateScoutDetail(sku){
  const h=document.getElementById('cxParityDetail');if(!h||!sku)return;h.querySelector('.cx-position-sizing')?.remove();
  const base=scoutRows().find(x=>String(x.sku_id)===String(sku)),r=matchScout(base);if(!r)return;
  const buy=Number(r.suggested_additional_qty||0),owned=Number(r.existing_qty||0),target=Number(r.target_total_qty||0);
  const section=document.createElement('section');section.className='cx-v5-section cx-position-sizing';
  section.innerHTML=`<div class="cx-section-title">Position sizing <span class="cx-signal-stage ${buy>=5?'leading':'confirming'}">${esc(r.sizing_class||'SIZE')}</span></div><div class="cx-v5-grid">${stat('Modeled add',buy>0?`+${buy} copies ${sizingMarker()}`:'No additional buy',buy>0?`${money(r.suggested_capital)} reference capital`:'current position already sized')}${stat('Current / model cap',`${owned.toFixed(0)} / ${target} copies`,`${r.target_days||'—'} target days of exposure`)}${stat('Modeled exit',`~${days(r.expected_days_to_exit)} ${sizingMarker()}`,`${Number(r.estimated_capture_per_day||0).toFixed(2)} seller-capture/day proxy`)}${stat('Trade hurdle',`${Number(r.direct_roi_pct||0).toFixed(1)}% ROI ${sizingMarker()}`,`${Number(r.target_roi_pct||0).toFixed(1)}% target · +${Number(r.margin_cushion_pct||0).toFixed(1)} pts cushion`)}</div>`;
  const action=h.querySelector('.cx-actionable-detail'),liq=h.querySelector('.cx-liquidity-section');if(action)action.insertAdjacentElement('afterend',section);else if(liq)liq.insertAdjacentElement('afterend',section);else h.appendChild(section);
}
function decorate(){decorateExecutionPanels();decorateScoutList();decorateScoutDetail(store.get().scout?.selectedSku)}
function decorateSoon(){for(const ms of [0,120,400])setTimeout(decorate,ms)}
async function load({force=false}={}){
  if(loading)return loading;
  if(!force&&loadedAt&&Date.now()-loadedAt<CACHE_MS){decorateSoon();return rows}
  loading=rest('rpc/scout_position_sizing',{method:'POST',body:{p_limit:150}}).then(data=>{rows=Array.isArray(data)?data:[];loadedAt=Date.now();store.update('positionSizing',{rows,loadedAt,error:null});document.dispatchEvent(new CustomEvent('collectish:position-sizing-changed',{detail:{count:rows.length}}));return rows}).catch(e=>{rows=[];store.update('positionSizing',{rows:[],loadedAt:Date.now(),error:String(e?.message||e)});return rows}).finally(()=>{loading=null;decorateSoon()});
  return loading;
}
document.addEventListener('collectish:scout-list-rendered',()=>{if(rows.length)decorateSoon();else void load()});
document.addEventListener('collectish:scout-detail-rendered',e=>{if(rows.length){decorateScoutDetail(e.detail?.sku);setTimeout(()=>decorateScoutDetail(e.detail?.sku),120)}});
document.addEventListener('collectish:actionable-emerging-changed',()=>{loadedAt=0;void load({force:true})});
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='scout'||e.detail?.page==='signals')setTimeout(decorateSoon,100)});
export {load as loadPositionSizing};
