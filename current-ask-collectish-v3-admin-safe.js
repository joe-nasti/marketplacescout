// Ask Collectish V3 — startup-safe Admin diagnostics.
// Runs only after the user navigates to Admin. No startup RPCs or observers.
(() => {
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  async function rpc(name,body={}){return window.rest(`rpc/${name}`,{method:'POST',body})}
  let loading=false;
  async function render(){
    if(loading)return;
    const host=document.getElementById('cxAdmin');if(!host||!host.classList.contains('active'))return;
    let card=host.querySelector('.cx-v3-safe-diagnostics');
    if(!card){const grid=host.querySelector('.cx-grid')||host;card=document.createElement('div');card.className='cx-card cx-span-12 cx-v3-safe-diagnostics';card.innerHTML='<div class="cx-section-title">Ask Collectish V3 · operations diagnostics</div><div class="cx-empty">Loading…</div>';grid.append(card)}
    loading=true;
    try{
      const [d,cfg]=await Promise.all([rpc('ask_collectish_v3_diagnostics_summary'),rpc('ask_collectish_get_model_config')]);
      const intents=Object.entries(d?.intent_counts||{}).sort((a,b)=>Number(b[1])-Number(a[1])).map(([k,v])=>`${k} ${v}`).join(' · ')||'—';
      card.innerHTML=`<div class="cx-section-title">Ask Collectish V3 · operations diagnostics</div><div class="cx-detail-list"><div class="cx-detail-stat"><span>Fast model</span><strong>${esc(cfg?.fast_model||'—')}</strong></div><div class="cx-detail-stat"><span>Reasoning model</span><strong>${esc(cfg?.reasoning_model||'—')}</strong></div><div class="cx-detail-stat"><span>Daily conversations</span><strong>${Number(d?.daily_conversations||0).toLocaleString()}</strong></div><div class="cx-detail-stat"><span>Requests today</span><strong>${Number(d?.requests_today||0).toLocaleString()}</strong></div><div class="cx-detail-stat"><span>AI tokens</span><strong>${Number(d?.total_tokens||0).toLocaleString()}</strong></div><div class="cx-detail-stat"><span>Approx AI cost</span><strong>$${Number(d?.approx_cost_usd||0).toFixed(4)}</strong></div><div class="cx-detail-stat"><span>External calls initiated</span><strong>${Number(d?.external_calls||0).toLocaleString()}</strong></div><div class="cx-detail-stat"><span>Investigates</span><strong>${Number(d?.investigate_usage||0)}</strong></div><div class="cx-detail-stat"><span>Purchase lists</span><strong>${Number(d?.purchase_lists_generated||0)}</strong></div><div class="cx-detail-stat"><span>Errors</span><strong>${Number(d?.errors||0)}</strong></div><div class="cx-detail-stat"><span>Avg response</span><strong>${d?.avg_latency_ms==null?'—':(Number(d.avg_latency_ms)/1000).toFixed(1)+'s'}</strong></div></div><div class="cx-v3-diag-line"><b>Recommendation intents:</b> ${esc(intents)}</div><div class="cx-v3-diag-line"><b>Daily external budget:</b> ${Number(cfg?.max_daily_external_requests||250).toLocaleString()} · explicit Investigate auto-refresh ≤ ${Number(cfg?.max_single_confirmless_requests??3)}</div>`;
    }catch(e){const empty=card.querySelector('.cx-empty');if(empty)empty.textContent=e?.message||String(e)}
    finally{loading=false}
  }
  document.addEventListener('click',e=>{const b=e.target?.closest?.('[data-cx-page="admin"]');if(b)setTimeout(render,220)},true);
  window.CollectishAskV3Safe={...(window.CollectishAskV3Safe||{}),renderAdminDiagnostics:render};
})();
