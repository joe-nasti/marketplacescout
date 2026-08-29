import {rest} from '../../core/rest.js';

let rows=[];let loaded=false;let loading=null;
const bySku=()=>new Map(rows.map(r=>[String(r.sku_id),r]));
const pretty=s=>String(s||'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
const money=v=>Number.isFinite(Number(v))?`$${Number(v).toFixed(2)}`:'—';
function decorate(){
  const map=bySku();
  document.querySelectorAll('#cxParityCards .cx-scout-card[data-sku]').forEach(card=>{
    card.querySelector('.cx-price-audit-badge')?.remove();
    const r=map.get(String(card.dataset.sku));if(!r)return;
    const b=document.createElement('span');b.className='cx-price-audit-badge';
    const ok=r.actionability_status==='confirmed_current';
    b.textContent=ok?'Price current':`Actionability ${r.actionability_shadow_grade||r.promoted_grade}`;
    b.title=`${pretty(r.actionability_status)} · chosen ${money(r.cheapest_buy)} · reference ${money(r.actionability_reference_buy)}${r.recent_transient_low_detected?' · transient low seen in last 24h':''}. Official Scout grade unchanged.`;
    b.style.cssText='display:inline-flex;margin:.3rem .35rem 0 0;padding:.15rem .4rem;border:1px solid currentColor;border-radius:999px;font-size:.68rem;opacity:.78';
    (card.querySelector('.cx-card-meta,.cx-scout-card-meta,.cx-v5-badges')||card).appendChild(b);
  });
}
async function load(force=false){if(loading)return loading;if(loaded&&!force){decorate();return rows}loading=rest('scout_price_actionability_audit?select=sku_id,product_name,promoted_grade,promoted_score,cheapest_buy,cheapest_source,official_landed_low,official_observed_at,vendor_observed_on,vendor_age_days,recent_transient_low_detected,actionability_status,actionability_shadow_grade,actionability_reference_buy&promoted_grade=eq.A').then(x=>{rows=Array.isArray(x)?x:[];loaded=true;decorate();return rows}).catch(()=>[]).finally(()=>loading=null);return loading}
document.addEventListener('collectish:scout-structure-ready',()=>void load());
document.addEventListener('collectish:scout-rendered',decorate);
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='scout')setTimeout(decorate,80)});
document.addEventListener('collectish:ready',()=>void load());
export {load as loadPriceActionabilityAudit};
