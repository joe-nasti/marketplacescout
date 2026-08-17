// Ask Collectish V1 — Scout-grounded AI assistant UI.
(() => {
  const cfg=window.COLLECTISH_CONFIG;
  const ENDPOINT=`${String(cfg?.supabaseUrl||'').replace(/\/$/,'')}/functions/v1/ask-collectish`;
  const CONV_KEY='askCollectishConversationId';
  let panel=null,messages=null,input=null,statusEl=null,contextEl=null,conversationId=localStorage.getItem(CONV_KEY)||null,busy=false,healthChecked=false;
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));

  function session(){try{return JSON.parse(localStorage.getItem('collectishSession')||'null')}catch{return null}}
  async function accessToken(){
    // A tiny existing REST read runs modern-core's token refresh path before we read localStorage.
    try{await window.rest?.('scout_opportunities_v5?select=sku_id&limit=1')}catch{}
    return session()?.token||null;
  }
  async function api(body){
    const token=await accessToken();if(!token)throw new Error('Sign in required');
    const r=await fetch(ENDPOINT,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const text=await r.text();let d;try{d=text?JSON.parse(text):{}}catch{d={error:text||`HTTP ${r.status}`}}
    if(!r.ok)throw new Error(d?.error||`Ask Collectish HTTP ${r.status}`);return d;
  }
  function currentContext(){
    const active=document.querySelector('.cx-page.active')?.id||'';
    const out={screen:active==='cxScout'?'scout':active.replace(/^cx/,'').toLowerCase()||'unknown'};
    if(active!=='cxScout')return out;
    const card=document.querySelector('#cxParityCards .cx-scout-card.selected');
    const sku=card?.dataset?.sku||null;
    const name=card?.querySelector('.cx-scout-card-body>strong')?.textContent?.trim()||document.querySelector('#cxParityDetail .cx-v5-title .cx-section-title')?.textContent?.trim()||null;
    const href=document.querySelector('#cxParityDetail a[href*="tcgplayer.com/product/"]')?.getAttribute('href')||'';
    const product=(/\/product\/(\d+)/.exec(href)||[])[1]||null;
    return {...out,sku_id:sku,product_id:product,product_name_hint:name};
  }
  async function resolvedContext(){
    const c=currentContext();if(c.screen!=='scout'||c.product_id||!c.sku_id)return c;
    try{const rows=await rest(`scout_opportunities_v5?select=product_id,product_name&sku_id=eq.${encodeURIComponent(c.sku_id)}&limit=1`);if(rows?.[0])return {...c,product_id:rows[0].product_id,product_name_hint:rows[0].product_name||c.product_name_hint}}catch{}
    return c;
  }
  function setStatus(text,kind=''){if(!statusEl)return;statusEl.textContent=text;statusEl.dataset.kind=kind}
  function syncContext(){if(!contextEl)return;const c=currentContext();contextEl.textContent=c.screen==='scout'&&c.product_name_hint?`Scout · ${c.product_name_hint}`:'Scout search mode';contextEl.title=c.sku_id?`SKU ${c.sku_id}`:'No card attached'}
  function bubble(role,text,meta=''){
    if(!messages)return null;const wrap=document.createElement('div');wrap.className=`cx-ask-msg cx-ask-${role}`;
    const body=document.createElement('div');body.className='cx-ask-msg-body';body.textContent=text;wrap.append(body);
    if(meta){const small=document.createElement('small');small.textContent=meta;wrap.append(small)}messages.append(wrap);messages.scrollTop=messages.scrollHeight;return wrap;
  }
  function thinking(){const b=bubble('assistant','Thinking with Scout data…');b?.classList.add('cx-ask-thinking');return b}
  function starter(text){const b=document.createElement('button');b.type='button';b.className='cx-ask-starter';b.textContent=text;b.onclick=()=>send(text);return b}
  function starters(){
    const h=document.getElementById('cxAskStarters');if(!h)return;h.innerHTML='';const c=currentContext();
    const arr=c.screen==='scout'&&c.sku_id?['Why this score?','Would you buy this?','What are the biggest risks?','What changed?']:['Find the best Scout opportunities today','Find cards under $20 with improving demand and low Direct supply','Show strong signals with Scout scores below 70','What changed today?'];
    arr.forEach(x=>h.append(starter(x)));
  }
  async function health(){
    if(healthChecked)return;healthChecked=true;setStatus('Checking AI…');
    try{const d=await api({action:'health'});setStatus(d.ok?`${d.model||'AI'} online`:'AI unavailable',d.ok?'ok':'bad');if(!d.ok)bubble('system',d.error||'OpenAI health check failed.')}catch(e){setStatus('AI unavailable','bad');bubble('system',e.message||String(e))}
  }
  function build(){
    if(panel)return;
    const root=document.createElement('div');root.id='cxAskCollectish';root.className='cx-ask-root';root.hidden=true;
    root.innerHTML=`<div class="cx-ask-backdrop" data-ask-close></div><section class="cx-ask-panel" role="dialog" aria-modal="true" aria-label="Ask Collectish"><header class="cx-ask-head"><div class="cx-ask-brand"><span class="cx-ask-mark">✦</span><div><strong>Ask Collectish</strong><small>Scout data assistant</small></div></div><div class="cx-ask-head-actions"><button type="button" class="cx-ask-new" title="New conversation">New</button><button type="button" class="cx-ask-close" aria-label="Close Ask Collectish">×</button></div></header><div class="cx-ask-context-row"><span id="cxAskContext"></span><span id="cxAskStatus" class="cx-ask-status">Not checked</span></div><div id="cxAskStarters" class="cx-ask-starters"></div><div id="cxAskMessages" class="cx-ask-messages"><div class="cx-ask-welcome"><strong>Ask about Scout.</strong><span>I’ll use Collectish data and tell you when evidence is missing or stale.</span></div></div><div class="cx-ask-investigate-row"><button type="button" id="cxAskInvestigate" class="cx-ask-investigate">Investigate current card</button><span id="cxAskInvestigateState"></span></div><form id="cxAskForm" class="cx-ask-compose"><textarea id="cxAskInput" rows="1" placeholder="Ask about Scout…" autocomplete="off"></textarea><button type="submit" aria-label="Send">↑</button></form></section>`;
    document.body.append(root);panel=root;messages=root.querySelector('#cxAskMessages');input=root.querySelector('#cxAskInput');statusEl=root.querySelector('#cxAskStatus');contextEl=root.querySelector('#cxAskContext');
    root.querySelectorAll('[data-ask-close],.cx-ask-close').forEach(x=>x.addEventListener('click',close));
    root.querySelector('.cx-ask-new').addEventListener('click',()=>{conversationId=null;localStorage.removeItem(CONV_KEY);messages.innerHTML='<div class="cx-ask-welcome"><strong>New Scout conversation.</strong><span>Current screen context will be attached automatically.</span></div>';starters()});
    root.querySelector('#cxAskForm').addEventListener('submit',e=>{e.preventDefault();send(input.value)});
    input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send(input.value)}});
    input.addEventListener('input',()=>{input.style.height='auto';input.style.height=`${Math.min(input.scrollHeight,110)}px`});
    root.querySelector('#cxAskInvestigate').addEventListener('click',investigate);
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden)close()});
  }
  async function open(prefill=''){
    build();syncContext();starters();panel.hidden=false;document.body.classList.add('cx-ask-lock');
    const c=currentContext();panel.classList.toggle('cx-ask-has-card',Boolean(c.screen==='scout'&&c.sku_id));
    if(prefill){input.value=prefill;input.focus()}else setTimeout(()=>input.focus(),80);
    health();
  }
  function close(){if(!panel)return;panel.hidden=true;document.body.classList.remove('cx-ask-lock')}
  async function send(raw){
    const text=String(raw||'').trim();if(!text||busy)return;busy=true;input.value='';input.style.height='auto';bubble('user',text);const wait=thinking();setStatus('Using Scout tools…');
    try{
      const context=await resolvedContext();const d=await api({action:'chat',message:text,conversation_id:conversationId,context});
      wait?.remove();conversationId=d.conversation_id||conversationId;if(conversationId)localStorage.setItem(CONV_KEY,conversationId);
      const used=(d.tools||[]).filter(x=>x.ok).map(x=>x.name.replace(':auto_context','')).join(', ');bubble('assistant',d.response||'No response.',used?`Grounded with: ${used}`:'Grounded in attached Scout context');setStatus(`${d.model||'AI'} · ${d.usage?.total_tokens||0} tokens`,'ok');
    }catch(e){wait?.remove();bubble('system',e.message||String(e));setStatus('Request failed','bad')}finally{busy=false}
  }
  async function investigate(){
    if(busy)return;const state=panel?.querySelector('#cxAskInvestigateState'),btn=panel?.querySelector('#cxAskInvestigate');const context=await resolvedContext();
    if(!context.product_id){if(state)state.textContent='Open a Scout card first.';return}busy=true;btn.disabled=true;if(state)state.textContent='Queueing deeper sales check…';
    try{
      const d=await api({action:'investigate',context});if(!d.job_id)throw new Error('Investigate did not return a job');if(state)state.textContent='Queued · waiting for cloud worker';bubble('system','Investigate queued. I’ll re-analyze when the deeper sales cache is refreshed.');
      for(let i=0;i<50;i++){await sleep(7000);const rows=await rest(`collector_jobs?select=status,progress_json,error_message&job_id=eq.${encodeURIComponent(d.job_id)}&limit=1`),j=rows?.[0];if(!j)continue;if(state)state.textContent=j.progress_json?.detail||j.status;if(j.status==='completed'){busy=false;btn.disabled=false;await send('Re-analyze this card using the newly refreshed Investigate sales data.');return}if(j.status==='failed'){throw new Error(j.error_message||'Investigate failed')}}
      if(state)state.textContent='Still queued; results will be available shortly.';
    }catch(e){if(state)state.textContent=e.message||String(e);bubble('system',`Investigate: ${e.message||e}`)}finally{busy=false;btn.disabled=false}
  }
  function floating(){if(document.getElementById('cxAskFab'))return;const b=document.createElement('button');b.id='cxAskFab';b.type='button';b.className='cx-ask-fab';b.innerHTML='<span>✦</span><b>Ask</b>';b.setAttribute('aria-label','Ask Collectish');b.onclick=()=>open();document.body.append(b)}
  function decorateScout(){
    const d=document.getElementById('cxParityDetail');if(!d||d.querySelector('.cx-ask-inline'))return;
    const title=d.querySelector('.cx-v5-title')||d.querySelector('.cx-section-title');if(!title)return;
    const b=document.createElement('button');b.type='button';b.className='cx-ask-inline';b.innerHTML='<span>✦</span> Ask Collectish';b.onclick=()=>open();
    const badges=d.querySelector('.cx-v5-badges');if(badges)badges.after(b);else title.after(b);
  }
  async function diagnostics(){
    const h=document.getElementById('cxAdmin');if(!h||h.querySelector('.cx-ask-diagnostics'))return;
    const grid=h.querySelector('.cx-grid')||h;const card=document.createElement('div');card.className='cx-card cx-span-12 cx-ask-diagnostics';card.innerHTML='<div class="cx-section-title">Ask Collectish · AI diagnostics</div><div class="cx-empty">Loading AI diagnostics…</div>';grid.append(card);
    try{const d=await api({action:'diagnostics'});card.innerHTML=`<div class="cx-section-title">Ask Collectish · AI diagnostics</div><div class="cx-detail-list"><div class="cx-detail-stat"><span>Model</span><strong>${esc(d.model||'—')}</strong></div><div class="cx-detail-stat"><span>Requests today</span><strong>${Number(d.requests_today||0).toLocaleString()}</strong></div><div class="cx-detail-stat"><span>Tokens today</span><strong>${Number(d.total_tokens||0).toLocaleString()}</strong></div><div class="cx-detail-stat"><span>Approx. cost</span><strong>$${Number(d.approx_cost_usd||0).toFixed(4)}</strong></div><div class="cx-detail-stat"><span>Tool failures</span><strong>${Number(d.tool_failures||0)}</strong></div><div class="cx-detail-stat"><span>Avg latency</span><strong>${d.avg_latency_ms==null?'—':`${(Number(d.avg_latency_ms)/1000).toFixed(1)}s`}</strong></div></div>`}catch(e){card.innerHTML=`<div class="cx-section-title">Ask Collectish · AI diagnostics</div><div class="cx-empty">${esc(e.message||e)}</div>`}
  }
  function install(){floating();build();decorateScout();new MutationObserver(()=>decorateScout()).observe(document.getElementById('cxScout')||document.body,{childList:true,subtree:true});document.addEventListener('click',e=>{if(e.target.closest('[data-cx-page="admin"]'))setTimeout(diagnostics,120)},true)}
  document.addEventListener('collectish:ready',install);if(document.getElementById('collectishUxShell'))install();
  window.AskCollectish={open,send};
})();
