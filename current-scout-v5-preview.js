// Collectish Scout v5 shadow score preview — evaluation only, does not replace production grade.
(() => {
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const n=(v,d=1)=>v==null?'—':Number(v).toFixed(d);
  const money=v=>v==null?'—':Number(v).toLocaleString(undefined,{style:'currency',currency:'USD'});
  let seq=0,bound=false;
  const cache=new Map();
  function sku(){return document.querySelector('#cxParityCards .cx-scout-card.selected')?.dataset?.sku||document.querySelector('#cxParityCards .cx-scout-card')?.dataset?.sku||''}
  async function get(id){
    if(cache.has(id))return cache.get(id);
    const rows=await rest(`scout_v5_shadow?select=sku_id,v4_score,v5_score,v5_grade,structural_points,direct_execution_points,buylist_backing_points,liquidity_points,confirmation_points,execution_confidence_factor,cheapest_buy,cheapest_source,buylist_backed,buylist_spread,buylist_roi_pct,source_verify,confidence_label,computed_at&sku_id=eq.${encodeURIComponent(id)}&limit=1`);
    const row=rows?.[0]||null;cache.set(id,row);return row;
  }
  function render(r){
    if(!r)return `<div class="cx-v5-preview"><div class="cx-v5-head"><b>Scout v5 preview</b><span>Not scored yet</span></div></div>`;
    const delta=Number(r.v5_score)-Number(r.v4_score),exec=Number(r.direct_execution_points||0)+Number(r.buylist_backing_points||0);
    const state=r.source_verify?'VERIFY SOURCE':r.buylist_backed?'BUYLIST BACKED':r.confidence_label==='market_confirmed'?'MARKET CONFIRMED':'MARKET MIXED';
    return `<div class="cx-v5-preview" data-v5-sku="${esc(r.sku_id)}">
      <div class="cx-v5-head"><div><b>Scout v5 preview</b><small>Execution-aware shadow score — production grade unchanged</small></div><div class="cx-v5-score"><span>${esc(r.v5_grade)}</span><strong>${r.v5_score}</strong><small>${delta>=0?'+':''}${delta} vs v4</small></div></div>
      <div class="cx-v5-components">
        <div><span>Thesis</span><b>${n(r.structural_points)}/70</b></div>
        <div><span>Execution</span><b>${n(exec)}/20</b></div>
        <div><span>Liquidity</span><b>${n(r.liquidity_points)}/5</b></div>
        <div><span>Confirmation</span><b>${n(r.confirmation_points)}/5</b></div>
      </div>
      <div class="cx-v5-state ${r.source_verify?'verify':r.buylist_backed?'backed':''}"><b>${state}</b>${r.cheapest_source?`<span>Cheapest US quote: ${esc(r.cheapest_source)} ${money(r.cheapest_buy)}</span>`:''}${r.buylist_backed?`<span>CK spread ${money(r.buylist_spread)} · ${n(r.buylist_roi_pct)}% gross</span>`:''}${Number(r.execution_confidence_factor)<1?`<span>Execution confidence ×${n(r.execution_confidence_factor,2)}</span>`:''}</div>
    </div>`;
  }
  async function refresh(){
    const host=document.getElementById('cxParityDetail');if(!host||!host.closest('#cxScout.active')||host.querySelector('.cx-empty'))return;
    const id=sku();if(!id)return;
    let box=host.querySelector('.cx-v5-preview');if(box?.dataset?.v5Sku===id)return;
    const my=++seq;
    try{
      const r=await get(id);if(my!==seq)return;
      const wrap=document.createElement('div');wrap.innerHTML=render(r);const next=wrap.firstElementChild;next.dataset.v5Sku=id;
      box=host.querySelector('.cx-v5-preview');
      if(box)box.replaceWith(next);else{
        const vendor=host.querySelector('.cx-vendor-pricing'),links=host.querySelector('.cx-scout-external-links');
        if(vendor)host.insertBefore(next,vendor);else if(links)host.insertBefore(next,links);else host.appendChild(next);
      }
    }catch(e){console.warn('Scout v5 preview failed',e)}
  }
  const style=document.createElement('style');style.textContent=`
    .cx-v5-preview{margin-top:14px;padding:12px;border:1px solid var(--cx-line);border-radius:13px;background:var(--cx-bg)}
    .cx-v5-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.cx-v5-head>div:first-child small{display:block;color:var(--cx-muted);font-size:9px;margin-top:2px}.cx-v5-score{display:grid;grid-template-columns:auto auto;column-gap:5px;align-items:center;text-align:right}.cx-v5-score span{font-size:18px;font-weight:950}.cx-v5-score strong{font-size:20px}.cx-v5-score small{grid-column:1/-1;color:var(--cx-muted);font-size:9px}
    .cx-v5-components{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:9px}.cx-v5-components>div{padding:7px;border:1px solid var(--cx-line);border-radius:9px;background:var(--cx-card)}.cx-v5-components span{display:block;font-size:9px;color:var(--cx-muted)}.cx-v5-components b{display:block;font-size:12px;margin-top:2px}
    .cx-v5-state{display:flex;gap:8px 12px;flex-wrap:wrap;margin-top:8px;font-size:9px;color:var(--cx-muted)}.cx-v5-state>b{color:var(--cx-text)}.cx-v5-state.backed>b{color:#16713a}.cx-v5-state.verify>b{color:#8a4c00}
    @media(max-width:520px){.cx-v5-components{grid-template-columns:1fr 1fr}}
  `;document.head.appendChild(style);
  function install(){if(bound)return;bound=true;const attach=()=>{const host=document.getElementById('cxParityDetail');if(!host)return false;new MutationObserver(()=>setTimeout(refresh,40)).observe(host,{childList:true,subtree:true});document.getElementById('cxParityCards')?.addEventListener('click',()=>setTimeout(refresh,80),true);setTimeout(refresh,120);return true};if(attach())return;const mo=new MutationObserver(()=>{if(attach())mo.disconnect()});mo.observe(document.body,{childList:true,subtree:true})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();