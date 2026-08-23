// Typed response surfaces returned by ask-collectish-ui.
// This runs before the heuristic rich-surface enhancer; the latter remains fallback-only.
(() => {
  const money=n=>n==null?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const tcgImage=id=>id?`https://tcgplayer-cdn.tcgplayer.com/product/${encodeURIComponent(id)}_in_1000x1000.jpg`:'';
  const ask=text=>window.AskCollectish?.send?.(text);
  const act=a=>{
    if(!a)return;
    if(a.type==='ask'&&a.prompt)return ask(a.prompt);
    if(['open_card','open_syp_item','open_order','navigate','apply_filters','apply_sort'].includes(a.type))window.AskCollectish?.applyUiActions?.([a]);
  };
  function button(a){const b=document.createElement('button');b.type='button';b.className=`cx-ask-surface-action ${a?.primary?'is-primary':'is-secondary'}`;b.textContent=a?.label||'Open';b.onclick=()=>act(a);return b}
  function actions(surface){const list=(surface?.actions||[]).slice(0,2);if(!list.length)return null;const bar=document.createElement('div');bar.className='cx-ask-surface-actions';list.forEach(a=>bar.append(button(a)));return bar}
  function scoutShape(r={}){return {...r,promoted_grade:r.promoted_grade??r.grade,promoted_score:r.promoted_score??r.score,sku_market_price:r.sku_market_price??r.market_price}}

  function opportunityCard(surface){
    const r=scoutShape(surface.item);const el=document.createElement('article');el.className='cx-ask-surface cx-ask-opportunity-card';
    el.innerHTML=`<div class="cx-ask-surface-media"><img loading="lazy" decoding="async" src="${esc(tcgImage(r.product_id))}" alt=""></div><div class="cx-ask-surface-copy"><div class="cx-ask-surface-kicker">${esc(surface.title||'Scout opportunity')}</div><div class="cx-ask-surface-title"><strong>${esc(r.product_name||'Unknown card')}</strong><span class="cx-ask-grade">${esc(r.promoted_grade||'—')}</span></div><div class="cx-ask-surface-metrics"><span><small>Scout</small><b>${r.promoted_score??'—'}</b></span><span><small>Market</small><b>${money(r.sku_market_price)}</b></span><span><small>Direct qty</small><b>${r.direct_available??'—'}</b></span></div><div class="cx-ask-surface-note">${esc(r.set_name||'')}${r.edhrec_rank!=null?` · EDHREC ${Number(r.edhrec_rank).toLocaleString()}`:''}</div></div>`;
    el.querySelector('img')?.addEventListener('error',e=>e.currentTarget.closest('.cx-ask-surface-media')?.remove(),{once:true});const bar=actions(surface);if(bar)el.append(bar);return el;
  }

  function carousel(surface){
    const el=document.createElement('section');el.className='cx-ask-surface cx-ask-opportunity-carousel';
    el.innerHTML=`<div class="cx-ask-surface-heading"><strong>${esc(surface.title||'Scout opportunities')}</strong><span>${esc(surface.coverage_note||'Swipe to compare')}</span></div>`;
    const track=document.createElement('div');track.className='cx-ask-surface-track';
    for(const raw of (surface.items||[]).slice(0,8)){
      const r=scoutShape(raw),card=document.createElement('button');card.type='button';card.className='cx-ask-mini-opportunity';card.onclick=()=>r.product_id&&window.AskCollectish?.applyUiActions?.([{type:'open_card',product_id:String(r.product_id)}]);
      card.innerHTML=`<img loading="lazy" decoding="async" src="${esc(tcgImage(r.product_id))}" alt=""><span class="cx-ask-mini-copy"><span class="cx-ask-mini-title">${esc(r.product_name||'Unknown card')}</span><span class="cx-ask-mini-meta"><b>${esc(r.promoted_grade||'—')} ${r.promoted_score??'—'}</b> · ${money(r.sku_market_price)}</span><span class="cx-ask-mini-note">Direct ${r.direct_available??'—'}${r.edhrec_rank!=null?` · EDHREC ${Number(r.edhrec_rank).toLocaleString()}`:''}</span></span>`;
      card.querySelector('img')?.addEventListener('error',e=>e.currentTarget.remove(),{once:true});track.append(card);
    }
    el.append(track);const bar=actions(surface);if(bar)el.append(bar);return el;
  }

  function entity(surface){
    const i=surface.item||{},domain=String(surface.domain||'');let title=i.product_name||i.name||i.order_number||i.sku_id||surface.title||'Result',detail='';
    if(domain==='syp')detail=[i.condition,i.printing,i.language,i.current_max_quantity!=null?`max ${i.current_max_quantity}`:null,i.market_price!=null?`Market ${money(i.market_price)}`:null].filter(Boolean).join(' · ');
    else if(domain==='seller')detail=[i.order_date?new Date(i.order_date).toLocaleDateString():null,i.fulfillment,i.gross!=null?`Gross ${money(i.gross)}`:null,i.net!=null?`Net ${money(i.net)}`:null].filter(Boolean).join(' · ');
    else detail=[i.quantity!=null?`Qty ${i.quantity}`:null,i.scout_grade?`Scout ${i.scout_grade} ${i.scout_score??''}`:null,i.days_held!=null?`${i.days_held} days held`:null].filter(Boolean).join(' · ');
    const el=document.createElement('section');el.className='cx-ask-surface cx-ask-comparison-surface';el.innerHTML=`<div class="cx-ask-surface-heading"><strong>${esc(surface.title||title)}</strong><span>${esc(detail)}</span></div>`;
    if(surface.title&&title!==surface.title){const row=document.createElement('div');row.className='cx-ai-result-list';row.innerHTML=`<button type="button"><strong>${esc(title)}</strong><span>${esc(detail)}</span></button>`;el.append(row)}const bar=actions(surface);if(bar)el.append(bar);return el;
  }

  function resultList(surface){
    const el=document.createElement('section');el.className='cx-ask-surface cx-ask-comparison-surface';el.innerHTML=`<div class="cx-ask-surface-heading"><strong>${esc(surface.title||'Results')}</strong><span>${esc(surface.coverage_note||'')}</span></div>`;
    const list=document.createElement('div');list.className='cx-ai-result-list';
    for(const i of (surface.items||[]).slice(0,8)){const b=document.createElement('button');b.type='button';if(surface.domain==='syp'){b.innerHTML=`<strong>${esc(i.product_name||i.sku_id||'SYP item')}</strong><span>${esc([i.condition,i.printing,i.language].filter(Boolean).join(' · '))}</span>`;b.onclick=()=>i.sku_id&&act({type:'open_syp_item',sku_id:String(i.sku_id)})}else if(surface.domain==='seller'){b.innerHTML=`<strong>${esc(i.order_number?`Order ${i.order_number}`:i.product_name||'Seller result')}</strong><span>${esc(i.net!=null?`Net ${money(i.net)}`:'')}</span>`;b.onclick=()=>i.order_number&&act({type:'open_order',order_id:String(i.order_number)})}else b.innerHTML=`<strong>${esc(i.product_name||i.sku_id||'Inventory item')}</strong><span>${esc(i.quantity!=null?`Qty ${i.quantity}`:'')}</span>`;list.append(b)}
    el.append(list);return el;
  }

  function render(surface){if(surface?.type==='opportunity_card'&&surface.item)return opportunityCard(surface);if(surface?.type==='opportunity_carousel')return carousel(surface);if(surface?.type==='entity_card')return entity(surface);if(surface?.type==='result_list')return resultList(surface);return null}
  function onMessage(ev){const {role,element}=ev.detail||{};if(role!=='assistant'||!element||/Thinking with Collectish data/i.test(element.textContent||''))return;const queued=window.__CollectishAskSurfaceQueue?.shift?.();if(!queued?.surfaces?.length)return;const msg=element.closest('.cx-ask-msg');if(!msg||msg.querySelector(':scope > .cx-ask-rich-surfaces'))return;const host=document.createElement('div');host.className='cx-ask-rich-surfaces';for(const surface of queued.surfaces){const node=render(surface);if(node)host.append(node)}if(!host.children.length)return;msg.append(host);requestAnimationFrame(()=>host.scrollIntoView({block:'nearest'}))}
  document.addEventListener('collectish:ask-message-rendered',onMessage);
})();
