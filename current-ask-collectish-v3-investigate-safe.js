// Ask Collectish V3 — startup-safe Investigate bridge.
// Intentionally: no MutationObserver, no fetch monkeypatch, no startup RPC, no DOM scan loop.
(() => {
  const cfg=window.COLLECTISH_CONFIG;
  if(!cfg?.supabaseUrl)return;
  const ENDPOINT=`${String(cfg.supabaseUrl).replace(/\/$/,'')}/functions/v1/ask-collectish`;
  let busy=false;
  const session=()=>{try{return JSON.parse(localStorage.getItem('collectishSession')||'null')}catch{return null}};
  const active=()=>String(document.querySelector('.cx-page.active')?.id||'').replace(/^cx/,'').toLowerCase();
  function context(){
    const screen=active()||'unknown';
    if(screen!=='scout')return {screen};
    const card=document.querySelector('#cxParityCards .cx-scout-card.selected');
    const sku=card?.dataset?.sku||null;
    const href=document.querySelector('#cxParityDetail a[href*="tcgplayer.com/product/"]')?.getAttribute('href')||'';
    const product=(/\/product\/(\d+)/.exec(href)||[])[1]||null;
    const name=card?.querySelector('.cx-scout-card-body>strong')?.textContent?.trim()||null;
    return {screen,sku_id:sku,product_id:product,product_name_hint:name};
  }
  function add(role,text,meta=''){
    const h=document.getElementById('cxAskMessages');if(!h)return null;
    const w=document.createElement('div');w.className=`cx-ask-msg cx-ask-${role}`;
    const b=document.createElement('div');b.className='cx-ask-msg-body';b.textContent=text;w.append(b);
    if(meta){const s=document.createElement('small');s.textContent=meta;w.append(s)}
    h.append(w);h.scrollTop=h.scrollHeight;return w;
  }
  async function api(body){
    const token=session()?.token;if(!token)throw Error('Sign in required');
    const r=await fetch(ENDPOINT,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const t=await r.text();let d;try{d=t?JSON.parse(t):{}}catch{d={error:t}}
    if(!r.ok)throw Error(d?.error||`Ask Collectish HTTP ${r.status}`);return d;
  }
  async function investigate(){
    if(busy)return;
    let c=context();
    if(!c.product_id&&c.sku_id){
      try{const rows=await window.rest(`scout_opportunities_v5?select=product_id,product_name&sku_id=eq.${encodeURIComponent(c.sku_id)}&limit=1`);if(rows?.[0])c={...c,product_id:String(rows[0].product_id||''),product_name_hint:rows[0].product_name||c.product_name_hint}}catch{}
    }
    if(!c.product_id){add('system','Open a Scout card first, then Investigate.');return}
    busy=true;
    const state=document.getElementById('cxAskInvestigateState');if(state)state.textContent='Investigating…';
    const wait=add('assistant','Investigating current card across Scout, sales, supply, SYP, Seller, vendors, inventory and reprint metadata…');wait?.classList.add('cx-ask-thinking');
    try{
      const d=await api({action:'investigate',context:c});
      wait?.remove();
      add('assistant',d.analysis||'Investigation complete.',`${d.model||'reasoning model'} · ${d.usage?.total_tokens||0} tokens`);
      const q=d.snapshot?.data_quality;
      if(q)add('system',`Data quality: Scout ${q.scout_fresh?'fresh':'stale'} · sales ${q.sales_available?(q.sales_fresh?'fresh':'stale'):'missing'} · inventory ${q.inventory_available?'available':'missing'}`);
      if(d.queued_refresh)add('system','A bounded missing/stale-data refresh was queued. This analysis uses the pre-refresh snapshot until it lands.');
      if(state)state.textContent='V3 investigation complete';
    }catch(e){wait?.remove();add('system',e?.message||String(e));if(state)state.textContent='Investigate failed'}
    finally{busy=false}
  }
  // Capture-phase override only for the existing V2 Investigate button.
  document.addEventListener('click',e=>{
    const b=e.target?.closest?.('#cxAskInvestigate');if(!b)return;
    e.preventDefault();e.stopImmediatePropagation();investigate();
  },true);
  window.CollectishAskV3Safe={...(window.CollectishAskV3Safe||{}),investigate,context};
})();
