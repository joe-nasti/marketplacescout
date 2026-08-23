// Rich response surfaces for Ask Collectish.
// Prefer server-provided typed surfaces; existing heuristics remain a compatibility fallback.
(() => {
  const money=n=>n==null?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const tcgImage=id=>id?`https://tcgplayer-cdn.tcgplayer.com/product/${encodeURIComponent(id)}_in_1000x1000.jpg`:'';
  const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));

  function latestUserPrompt(el){
    const msg=el.closest('.cx-ask-msg');
    let prev=msg?.previousElementSibling;
    while(prev&&!prev.classList.contains('cx-ask-user'))prev=prev.previousElementSibling;
    return prev?.querySelector('.cx-ask-msg-body')?.textContent?.trim()||'';
  }

  function selectedScoutContext(){
    const card=document.querySelector('#cxParityCards .cx-scout-card.selected');
    const sku=card?.dataset?.sku||null;
    const name=card?.querySelector('.cx-scout-card-body>strong')?.textContent?.trim()||document.querySelector('#cxParityDetail .cx-v5-title .cx-section-title')?.textContent?.trim()||null;
    const href=document.querySelector('#cxParityDetail a[href*="tcgplayer.com/product/"]')?.getAttribute('href')||'';
    const product=(/\/product\/(\d+)/.exec(href)||[])[1]||card?.dataset?.product||null;
    return {sku_id:sku,product_id:product,product_name:name};
  }

  async function scoutRow(context){
    if(!window.rest)return null;
    const where=context.sku_id?`sku_id=eq.${encodeURIComponent(context.sku_id)}`:context.product_id?`product_id=eq.${encodeURIComponent(context.product_id)}`:'';
    if(!where)return null;
    const rows=await window.rest(`scout_opportunities_v5?select=sku_id,product_id,product_name,promoted_grade,promoted_score,sku_market_price,direct_available,edhrec_rank,set_name,condition,printing,language&${where}&order=promoted_score.desc&limit=1`);
    return rows?.[0]||null;
  }

  async function topScoutRows(limit=6){
    if(!window.rest)return [];
    const rows=await window.rest(`scout_opportunities_v5?select=sku_id,product_id,product_name,promoted_grade,promoted_score,sku_market_price,direct_available,edhrec_rank,set_name&order=promoted_score.desc&limit=${clamp(limit,3,8)}`);
    return rows||[];
  }

  function action(label,handler,kind='secondary'){
    const b=document.createElement('button');
    b.type='button';b.className=`cx-ask-surface-action is-${kind}`;b.textContent=label;b.onclick=handler;
    return b;
  }

  function openScout(productId){if(productId)window.AskCollectish?.applyUiActions?.([{type:'open_card',product_id:String(productId)}])}
  function ask(text){window.AskCollectish?.send?.(text)}
  function runStructuredAction(a){
    if(!a)return;
    if(a.type==='ask'&&a.prompt)return ask(a.prompt);
    if(['open_card','open_syp_item','open_order','navigate','apply_filters','apply_sort'].includes(a.type))window.AskCollectish?.applyUiActions?.([a]);
  }

  function rowValue(row,...keys){for(const k of keys)if(row?.[k]!=null)return row[k];return null}
  function scoutShape(row){return {
    ...row,
    promoted_grade:rowValue(row,'promoted_grade','grade'),
    promoted_score:rowValue(row,'promoted_score','score'),
    sku_market_price:rowValue(row,'sku_market_price','market_price')
  }}

  function actionBarFromSurface(surface,row){
    const bar=document.createElement('div');bar.className='cx-ask-surface-actions';
    const list=Array.isArray(surface?.actions)?surface.actions:[];
    if(list.length){for(const a of list.slice(0,2))bar.append(action(a.label||'Open',()=>runStructuredAction(a),a.primary?'primary':'secondary'));return bar}
    if(row?.product_id)bar.append(action('Open in Scout',()=>openScout(row.product_id),'primary'));
    bar.append(action('Explain risks',()=>ask('What are the biggest risks for this opportunity?')));
    return bar;
  }

  function opportunityCard(row,surface={}){
    row=scoutShape(row||{});
    const box=document.createElement('article');box.className='cx-ask-surface cx-ask-opportunity-card';
    box.innerHTML=`<div class="cx-ask-surface-media"><img loading="lazy" decoding="async" src="${esc(tcgImage(row.product_id))}" alt=""></div><div class="cx-ask-surface-copy"><div class="cx-ask-surface-kicker">${esc(surface.title||'Scout opportunity')}</div><div class="cx-ask-surface-title"><strong>${esc(row.product_name||'Unknown card')}</strong><span class="cx-ask-grade">${esc(row.promoted_grade||'—')}</span></div><div class="cx-ask-surface-metrics"><span><small>Scout</small><b>${row.promoted_score??'—'}</b></span><span><small>Market</small><b>${money(row.sku_market_price)}</b></span><span><small>Direct qty</small><b>${row.direct_available??'—'}</b></span></div><div class="cx-ask-surface-note">${esc(row.set_name||'')} ${row.edhrec_rank!=null?`· EDHREC ${Number(row.edhrec_rank).toLocaleString()}`:''}</div></div>`;
    box.querySelector('img')?.addEventListener('error',e=>e.currentTarget.closest('.cx-ask-surface-media')?.remove(),{once:true});
    box.append(actionBarFromSurface(surface,row));
    return box;
  }

  function opportunityCarousel(rows,surface={}){
    const wrap=document.createElement('section');wrap.className='cx-ask-surface cx-ask-opportunity-carousel';
    wrap.innerHTML=`<div class="cx-ask-surface-heading"><strong>${esc(surface.title||'Scout opportunities')}</strong><span>${esc(surface.coverage_note||'Swipe to compare')}</span></div>`;
    const track=document.createElement('div');track.className='cx-ask-surface-track';
    for(const raw of rows.slice(0,8)){
      const row=scoutShape(raw);const card=document.createElement('button');card.type='button';card.className='cx-ask-mini-opportunity';card.onclick=()=>openScout(row.product_id);
      card.innerHTML=`<img loading="lazy" decoding="async" src="${esc(tcgImage(row.product_id))}" alt=""><span class="cx-ask-mini-copy"><span class="cx-ask-mini-title">${esc(row.product_name||'Unknown card')}</span><span class="cx-ask-mini-meta"><b>${esc(row.promoted_grade||'—')} ${row.promoted_score??'—'}</b> · ${money(row.sku_market_price)}</span><span class="cx-ask-mini-note">Direct ${row.direct_available??'—'}${row.edhrec_rank!=null?` · EDHREC ${Number(row.edhrec_rank).toLocaleString()}`:''}</span></span>`;
      card.querySelector('img')?.addEventListener('error',e=>e.currentTarget.remove(),{once:true});track.append(card);
    }
    wrap.append(track);
    const actions=document.createElement('div');actions.className='cx-ask-surface-actions';
    const provided=Array.isArray(surface.actions)?surface.actions:[];
    if(provided.length)for(const a of provided.slice(0,2))actions.append(action(a.label||'Open',()=>runStructuredAction(a),a.primary?'primary':'secondary'));
    else actions.append(action('Open Scout',()=>window.CollectishShell?.switchPage?.('scout'),'primary'),action('Compare top picks',()=>ask('Compare the top Scout opportunities you just showed me.')));
    wrap.append(actions);return wrap;
  }

  function comparisonSurface(){
    const box=document.createElement('section');box.className='cx-ask-surface cx-ask-comparison-surface';
    box.innerHTML='<div class="cx-ask-surface-heading"><strong>Comparison mode</strong><span>Keep the answer concise; inspect details only when needed.</span></div>';
    const actions=document.createElement('div');actions.className='cx-ask-surface-actions';actions.append(action('Rank best → worst',()=>ask('Rank these from best to worst and give me the deciding factor for each.'),'primary'),action('Show downside',()=>ask('Compare only the downside risks and liquidity concerns.')));box.append(actions);return box;
  }

  function entityCard(surface){
    const item=surface?.item||{},domain=String(surface?.domain||'').toLowerCase();
    const box=document.createElement('section');box.className='cx-ask-surface cx-ask-comparison-surface';
    let title=item.product_name||item.name||item.order_number||item.sku_id||surface.title||'Result';
    let detail='';
    if(domain==='syp')detail=[item.condition,item.printing,item.language,item.current_max_quantity!=null?`max ${item.current_max_quantity}`:null,item.market_price!=null?`Market ${money(item.market_price)}`:null].filter(Boolean).join(' · ');
    else if(domain==='seller')detail=[item.order_date?new Date(item.order_date).toLocaleDateString():null,item.fulfillment,item.gross!=null?`Gross ${money(item.gross)}`:null,item.net!=null?`Net ${money(item.net)}`:null].filter(Boolean).join(' · ');
    else if(domain==='inventory')detail=[item.quantity!=null?`Qty ${item.quantity}`:null,item.scout_grade?`Scout ${item.scout_grade} ${item.scout_score??''}`:null,item.days_held!=null?`${item.days_held} days held`:null].filter(Boolean).join(' · ');
    box.innerHTML=`<div class="cx-ask-surface-heading"><strong>${esc(surface.title||title)}</strong><span>${esc(detail)}</span></div>`;
    if(surface.title&&title!==surface.title){const row=document.createElement('div');row.className='cx-ai-result-list';row.innerHTML=`<button type="button"><strong>${esc(title)}</strong><span>${esc(detail)}</span></button>`;box.append(row)}
    if(surface.actions?.length)box.append(actionBarFromSurface(surface,item));
    return box;
  }

  function resultList(surface){
    const box=document.createElement('section');box.className='cx-ask-surface cx-ask-comparison-surface';
    box.innerHTML=`<div class="cx-ask-surface-heading"><strong>${esc(surface.title||'Results')}</strong><span>${esc(surface.coverage_note||'')}</span></div>`;
    const list=document.createElement('div');list.className='cx-ai-result-list';
    for(const item of (surface.items||[]).slice(0,8)){
      const b=document.createElement('button');b.type='button';const domain=surface.domain;
      if(domain==='syp'){b.innerHTML=`<strong>${esc(item.product_name||item.sku_id||'SYP item')}</strong><span>${esc([item.condition,item.printing,item.language,item.current_max_quantity!=null?`max ${item.current_max_quantity}`:null].filter(Boolean).join(' · '))}</span>`;b.onclick=()=>item.sku_id&&window.AskCollectish?.applyUiActions?.([{type:'open_syp_item',sku_id:String(item.sku_id)}])}
      else if(domain==='seller'){b.innerHTML=`<strong>${esc(item.order_number?`Order ${item.order_number}`:item.product_name||'Seller result')}</strong><span>${esc([item.order_date?new Date(item.order_date).toLocaleDateString():null,item.net!=null?`Net ${money(item.net)}`:null].filter(Boolean).join(' · '))}</span>`;b.onclick=()=>item.order_number&&window.AskCollectish?.applyUiActions?.([{type:'open_order',order_id:String(item.order_number)}])}
      else {b.innerHTML=`<strong>${esc(item.product_name||item.sku_id||'Inventory item')}</strong><span>${esc(item.quantity!=null?`Qty ${item.quantity}`:'')}</span>`}
      list.append(b);
    }
    box.append(list);return box;
  }

  function attach(el,surface){
    const msg=el.closest('.cx-ask-msg');if(!msg)return;
    let host=msg.querySelector(':scope > .cx-ask-rich-surfaces');
    if(!host){host=document.createElement('div');host.className='cx-ask-rich-surfaces';msg.append(host)}
    host.append(surface);requestAnimationFrame(()=>host.scrollIntoView({block:'nearest'}));
  }

  function renderStructured(el,surfaces){
    let rendered=0;
    for(const s of surfaces||[]){let node=null;
      if(s.type==='opportunity_card'&&s.item)node=opportunityCard(s.item,s);
      else if(s.type==='opportunity_carousel'&&Array.isArray(s.items))node=opportunityCarousel(s.items,s);
      else if(s.type==='entity_card')node=entityCard(s);
      else if(s.type==='result_list')node=resultList(s);
      if(node){attach(el,node);rendered++}
    }
    return rendered;
  }

  async function enhance(ev){
    const {role,element}=ev.detail||{};if(role!=='assistant'||!element)return;
    if(/Thinking with Collectish data/i.test(element.textContent||''))return;
    const queued=window.__CollectishAskSurfaceQueue?.shift?.();
    if(queued?.surfaces?.length&&renderStructured(element,queued.surfaces))return;
    const prompt=latestUserPrompt(element).toLowerCase();
    try{
      if(/best|top|opportunit|strong signal|what.*buy|power search/.test(prompt)){
        const rows=await topScoutRows(6);if(rows.length)attach(element,opportunityCarousel(rows));return;
      }
      if(/compare|versus|\bvs\b/.test(prompt)){attach(element,comparisonSurface());return}
      const context=selectedScoutContext();
      if(context.sku_id||context.product_id){const row=await scoutRow(context);if(row)attach(element,opportunityCard(row))}
    }catch(err){console.debug('[Ask rich surfaces]',err)}
  }

  document.addEventListener('collectish:ask-message-rendered',enhance);
})();
