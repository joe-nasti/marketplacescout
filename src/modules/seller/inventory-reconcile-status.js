import { rest } from '../../core/rest.js';
import { registerComponent } from '../../core/lifecycle.js';

let active=false,timer=null;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=t=>t?new Date(t).toLocaleString():'—';
const age=t=>{if(!t)return 'never';const ms=Math.max(0,Date.now()-new Date(t).getTime()),m=Math.floor(ms/60000);return m<1?'just now':m<60?`${m}m ago`:`${Math.floor(m/60)}h ${m%60}m ago`};

function ensure(host){let el=host.querySelector('#cxInventorySmartMonitor');if(el)return el;el=document.createElement('section');el.id='cxInventorySmartMonitor';el.className='cx-card';el.style.marginTop='12px';const progress=host.querySelector('#cxInventoryProgress');if(progress)progress.after(el);else host.prepend(el);return el}
async function render(){
  if(!active)return;const host=document.getElementById('cxInventory');if(!host)return;const el=ensure(host);
  try{
    const [s,e]=await Promise.all([
      rest('store_inventory_reconcile_state?select=*&limit=1'),
      rest('store_inventory_change_events?select=detected_at,change_type,source,product_id,old_quantity,new_quantity,old_price,new_price,metadata&order=detected_at.desc&limit=8')
    ]);
    const x=s?.[0]||{},d=x.detail||{},batch=Array.isArray(d.lastPriorityBatch)?d.lastPriorityBatch:[];
    el.innerHTML=`<div class="cx-section-title">Smart inventory monitor</div><div class="cx-inventory-progress-meta"><span>Last check <b>${esc(age(x.last_targeted_check_at||x.updated_at))}</b></span><span>Sales observed <b>${Number(d.salesObserved||0).toLocaleString()}</b></span><span>Sale checks <b>${Number(d.productsChecked||0).toLocaleString()}</b></span><span>Priority sweep <b>${Number(d.sweepProductsChecked||0).toLocaleString()}</b></span><span>Coverage added <b>${Number(d.coverageAdded||0).toLocaleString()}</b></span><span>Changes found <b>${Number(d.changesDetected||0).toLocaleString()}</b></span><span>Full audit <b>${d.fullAuditDue?'Due':'Current'}</b></span></div>${x.last_error?`<div class="cx-inventory-error">${esc(x.last_error)}</div>`:''}${batch.length?`<details><summary>Latest priority batch</summary><div class="cx-inventory-progress-details">${batch.map(r=>`<span>Product <b>${esc(r.productId)}</b> · priority ${Number(r.score||0)}${Array.isArray(r.reasons)&&r.reasons.length?` · ${esc(r.reasons.join(', '))}`:''}</span>`).join('')}</div></details>`:''}<details><summary>Recent detected changes</summary><div class="cx-inventory-progress-details">${(e||[]).length?(e||[]).map(r=>`<span>${esc(fmt(r.detected_at))} · <b>${esc(r.change_type)}</b> · product ${esc(r.product_id||'—')}${r.old_quantity!=null||r.new_quantity!=null?` · qty ${esc(r.old_quantity)} → ${esc(r.new_quantity)}`:''}${r.old_price!=null||r.new_price!=null?` · price ${esc(r.old_price)} → ${esc(r.new_price)}`:''}</span>`).join(''):'<span>No changes detected yet.</span>'}</div></details>`;
  }catch(e){el.innerHTML=`<div class="cx-section-title">Smart inventory monitor</div><div class="cx-empty">${esc(e?.message||e)}</div>`}
}
function start(){if(active)return;active=true;render();timer=setInterval(render,15000)}
function stop(){active=false;clearInterval(timer);timer=null}
registerComponent('inventory-reconcile-status',{onPage(page){if(page==='inventory')start();else stop()}});
