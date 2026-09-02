import {rest} from '../../core/rest.js';

let rows=[];let loading=null;let loadedAt=0;const TTL=60*1000;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=v=>Number.isFinite(Number(v))?`$${Number(v).toFixed(2)}`:'—';
const pct=v=>Number.isFinite(Number(v))?`${Number(v).toFixed(0)}%`:'—';
const pretty=s=>String(s||'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
const tcgUrl=r=>r?.product_id?`https://www.tcgplayer.com/product/${encodeURIComponent(r.product_id)}?Printing=${encodeURIComponent(r.printing||'Normal')}&Condition=${encodeURIComponent(r.condition||'Near Mint')}&Language=${encodeURIComponent(r.language||'English')}&page=1`:'';

function render(){
  document.querySelector('.cx-scout-flash-buy')?.remove();
  const host=document.getElementById('cxScout');if(!host||!rows.length)return;
  const top=rows.filter(r=>Number(r.flash_buy_score||0)>=25).slice(0,8);if(!top.length)return;
  const panel=document.createElement('section');panel.className='cx-v5-section cx-scout-flash-buy';panel.style.cssText='margin:.7rem 0 1rem';
  const cards=top.map(r=>{
    const stale=r.stale_seller_suspected?'<b>Possible stale seller</b>':`<b>${esc(pretty(r.persistence_state))}</b>`;
    const buylist=Number(r.immediate_buylist_roi_pct)>0?` · CK exit +${pct(r.immediate_buylist_roi_pct)}`:'';
    const market=Number.isFinite(Number(r.discount_to_market_pct))?` · ${pct(r.discount_to_market_pct)} below market`:'';
    return `<div class="cx-v5-stat"><span>FLASH BUY ${Math.round(Number(r.flash_buy_score||0))} · ${esc(r.promoted_grade||'—')}/${Math.round(Number(r.promoted_score||0))}</span><strong>${esc(r.product_name)} · ${money(r.official_landed_low)}</strong><small>${stale}${market}${buylist} · ${esc(r.action_note||'Verify current listing.')} ${r.product_id?`<a href="${esc(tcgUrl(r))}" target="_blank" rel="noopener">Open TCG listing ↗</a>`:''}</small></div>`;
  }).join('');
  panel.innerHTML=`<div class="cx-section-title">Flash buys <span class="cx-intel-context">live underpriced listings, independent of normal Scout grade</span></div><div class="cx-v5-grid">${cards}</div><small class="cx-sub">Flash Buy is intentionally separate from Scout ranking. A one-off or stale-seller listing can be actionable even when it is too transient to support the card's normal grade. Direct-only gaps are sanity-capped; implausible buylist quotes are ignored.</small>`;
  const ia=host.querySelector('#cxScoutIa'),toolbar=host.querySelector('.cx-scout-toolbar');const anchor=toolbar||ia;
  if(anchor?.parentNode)anchor.insertAdjacentElement('afterend',panel);else host.prepend(panel);
}
async function load(force=false){if(loading)return loading;if(!force&&loadedAt&&Date.now()-loadedAt<TTL){render();return rows}loading=rest('scout_flash_buy_opportunities?select=*&order=flash_buy_score.desc&limit=24').then(x=>{rows=Array.isArray(x)?x:[];loadedAt=Date.now();render();return rows}).catch(()=>[]).finally(()=>loading=null);return loading}
document.addEventListener('collectish:scout-structure-ready',()=>void load());
document.addEventListener('collectish:scout-rendered',render);
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='scout')setTimeout(()=>void load(),100)});
export {load as loadFlashBuys};
