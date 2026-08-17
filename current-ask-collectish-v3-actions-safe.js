// Ask Collectish V3 — startup-safe contextual actions, confirmations and purchase-list inspection.
// No startup RPCs, no MutationObserver, no window.fetch override.
(() => {
  const cfg=window.COLLECTISH_CONFIG;if(!cfg?.supabaseUrl)return;
  const ENDPOINT=`${String(cfg.supabaseUrl).replace(/\/$/,'')}/functions/v1/ask-collectish`;
  const renderedConfirmations=new Set(),renderedLists=new Set();
  const session=()=>{try{return JSON.parse(localStorage.getItem('collectishSession')||'null')}catch{return null}};
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const money=n=>n==null?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
  const active=()=>String(document.querySelector('.cx-page.active')?.id||'').replace(/^cx/,'').toLowerCase();
  async function api(body){const t=session()?.token;if(!t)throw Error('Sign in required');const r=await fetch(ENDPOINT,{method:'POST',headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json'},body:JSON.stringify(body)});const z=await r.text();let d;try{d=z?JSON.parse(z):{}}catch{d={error:z}}if(!r.ok)throw Error(d?.error||`Ask Collectish HTTP ${r.status}`);return d}
  async function rpc(name,body={}){return window.rest(`rpc/${name}`,{method:'POST',body})}
  function messages(){return document.getElementById('cxAskMessages')}
  function add(role,text,meta=''){const h=messages();if(!h)return null;const w=document.createElement('div');w.className=`cx-ask-msg cx-ask-${role}`;const b=document.createElement('div');b.className='cx-ask-msg-body';b.textContent=text;w.append(b);if(meta){const s=document.createElement('small');s.textContent=meta;w.append(s)}h.append(w);h.scrollTop=h.scrollHeight;return w}
  function submit(text){const i=document.getElementById('cxAskInput'),f=document.getElementById('cxAskForm');if(!i||!f)return;i.value=text;f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))}
  function currentContext(){return window.CollectishAskV3Safe?.context?.()||{screen:active()||'unknown'}}

  function enhanceStarters(){
    const h=document.getElementById('cxAskStarters');if(!h)return;
    h.querySelectorAll('.cx-v3-safe-starter').forEach(x=>x.remove());
    const screen=active();const actions=[];
    if(screen==='scout'){
      actions.push(['Investigate',()=>window.CollectishAskV3Safe?.investigate?.()]);
      actions.push(['Build purchase list',()=>submit('Build and save a purchase list from current Scout opportunities. Ask me only for constraints that materially affect the allocation.')]);
      actions.push(['Add to watchlist',()=>submit("Add this exact current Scout card/SKU to my internal Collectish watchlist. If needed, create one named 'Watchlist'.")]);
    }else if(screen==='seller'){
      actions.push(['Restock?',()=>submit('Should I restock the current Seller product using Seller History, Scout, inventory coverage and acquisition opportunities?')]);
      actions.push(['Reprice?',()=>submit('Should I reprice the current Seller product? Keep any target internal to Collectish only.')]);
    }else if(screen==='syp'){
      actions.push(['Analyze opportunity',()=>submit('Analyze the current exact SYP SKU as an opportunity using stored market, Scout, Seller and vendor evidence.')]);
      actions.push(['Compare market',()=>submit('Compare the current exact SYP SKU with current stored market and vendor data.')]);
    }else if(screen==='inventory'){
      actions.push(['Sell / Hold',()=>submit('Give me a sell versus hold analysis for the current inventory position.')]);
      actions.push(['Reprice',()=>submit('Recommend an internal Collectish target price for this inventory position; do not modify external marketplaces.')]);
    }else if(screen==='admin'){
      actions.push(['Collectish Brief',()=>submit('Generate my Collectish Brief from currently synchronized data.')]);
      actions.push(['Latest purchase list',latestPurchaseList]);
    }
    for(const [label,fn] of actions){const b=document.createElement('button');b.type='button';b.className='cx-ask-starter cx-v3-safe-starter';b.textContent=label;b.onclick=fn;h.append(b)}
  }

  function confirmCard(c){
    if(!c?.confirmation_required||!c.confirmation_id||renderedConfirmations.has(c.confirmation_id))return;
    const h=messages();if(!h)return;renderedConfirmations.add(c.confirmation_id);
    const box=document.createElement('div');box.className='cx-v3-action-card';const req=Number(c.estimated_requests||0),cost=Number(c.estimated_cost_usd||0);
    box.innerHTML=`<div class="cx-v3-action-badge">${esc(c.action_class||'EXPENSIVE')}</div><strong>Confirmation required</strong><span>${esc(c.action_type)} · ${req.toLocaleString()} estimated external request${req===1?'':'s'}${cost?` · ~$${cost.toFixed(4)}`:''}</span><small>Scope: ${esc(JSON.stringify(c.scope||{}))}</small><div class="cx-v3-confirm-actions"><button type="button" data-confirm>Confirm & run</button><button type="button" data-dismiss>Not now</button></div>`;
    box.querySelector('[data-confirm]').onclick=async()=>{const b=box.querySelector('[data-confirm]');b.disabled=true;b.textContent='Running…';try{const d=await api({action:'confirm_action',confirmation_id:c.confirmation_id});b.textContent='Executed';box.classList.add('cx-v3-done');add('system',`Confirmed operation executed.${d.result?.request_count?` ${d.result.request_count} external request(s) queued.`:''}`)}catch(e){b.disabled=false;b.textContent='Confirm & run';add('system',e?.message||String(e))}};
    box.querySelector('[data-dismiss]').onclick=()=>box.remove();h.append(box);h.scrollTop=h.scrollHeight;
  }
  async function pendingConfirmations(){try{const a=await rpc('ask_collectish_pending_confirmations');for(const c of a||[])confirmCard(c)}catch{}}

  function purchaseCard(p){
    const l=p?.list||{},items=p?.items||[],s=l.summary||{};const h=messages();if(!h)return;
    const box=document.createElement('div');box.className='cx-v3-purchase-card';
    box.innerHTML=`<div class="cx-v3-purchase-head"><strong>${esc(l.name||'Purchase list')}</strong><span>Saved · ${esc(String(l.id||'').slice(0,8))}</span></div><div class="cx-v3-purchase-metrics"><span>Budget <b>${money(l.budget)}</b></span><span>Allocated <b>${money(s.allocated_cost)}</b></span><span>Positions <b>${Number(s.positions||items.length)}</b></span><span>Projected ROI <b>${s.projected_portfolio_roi_pct==null?'—':Number(s.projected_portfolio_roi_pct).toFixed(1)+'%'}</b></span></div><div class="cx-v3-projection-note">Projected returns use the evidence snapshot saved with this list; they are estimates, not transactional facts.</div><details><summary>Inspect ${items.length} recommendations</summary><div class="cx-v3-purchase-items"></div></details><div class="cx-v3-purchase-actions"><button>Explain allocation</button><button>Replace weak candidates</button><button>Reduce risk</button><button>Increase liquidity</button><button>Rebalance to budget</button></div>`;
    const list=box.querySelector('.cx-v3-purchase-items');for(const [i,x] of items.entries()){const r=document.createElement('div');r.className='cx-v3-purchase-row';r.innerHTML=`<b>${i+1}. ${esc(x.product_name||x.sku_id)}</b><span>${x.quantity} × ${money(x.unit_cost)} · ROI ${x.projected_roi_pct==null?'—':Number(x.projected_roi_pct).toFixed(1)+'%'} · Scout ${x.scout_score??'—'}</span><small>${esc(x.confidence||'unknown')} confidence · sold ${Number(x.historical_units_sold||0)} historically</small>`;list.append(r)}
    box.querySelectorAll('.cx-v3-purchase-actions button').forEach(b=>b.onclick=()=>submit(`${b.textContent} for purchase list ${l.id}. Keep deterministic backend constraints and explain what changes.`));h.append(box);h.scrollTop=h.scrollHeight;
  }
  async function showPurchaseList(id){if(!id||renderedLists.has(id))return;try{const p=await rpc('ask_collectish_get_purchase_list',{p_id:id});if(p?.available){renderedLists.add(id);purchaseCard(p)}}catch{}}
  async function latestPurchaseList(){try{const rows=await window.rest('ask_collectish_purchase_lists?select=id,name,created_at&status=eq.draft&order=created_at.desc&limit=1');if(rows?.[0])await showPurchaseList(rows[0].id);else add('system','No saved draft purchase lists yet.')}catch(e){add('system',e?.message||String(e))}}

  async function postTurnSync(){
    if(document.getElementById('cxAskCollectish')?.hidden)return;
    await pendingConfirmations();
    // Only surface a purchase card when the recent conversation appears purchase-oriented.
    const recent=[...document.querySelectorAll('#cxAskMessages .cx-ask-user .cx-ask-msg-body')].slice(-2).map(x=>x.textContent||'').join(' ').toLowerCase();
    if(/purchase list|portfolio|allocate|rebalance|budget/.test(recent))await latestPurchaseList();
  }

  // Event-driven only: enhance after Ask is explicitly opened.
  document.addEventListener('click',e=>{
    if(e.target?.closest?.('#cxAskFab,.cx-ask-inline'))setTimeout(()=>{enhanceStarters();pendingConfirmations()},120);
    const nav=e.target?.closest?.('[data-cx-page]');if(nav&&document.getElementById('cxAskCollectish')&&!document.getElementById('cxAskCollectish').hidden)setTimeout(enhanceStarters,180);
  },true);
  // After a user explicitly submits chat, reconcile V3 side effects without intercepting fetch.
  document.addEventListener('submit',e=>{if(e.target?.id!=='cxAskForm')return;setTimeout(postTurnSync,2500);setTimeout(postTurnSync,7000);setTimeout(postTurnSync,15000)},true);
  window.CollectishAskV3Safe={...(window.CollectishAskV3Safe||{}),enhanceStarters,pendingConfirmations,latestPurchaseList,currentContext};
})();
