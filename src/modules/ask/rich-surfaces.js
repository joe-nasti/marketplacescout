// Rich response surfaces for Ask Collectish.
// Progressive enhancement: existing markdown remains the source-of-truth fallback.
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

  function openScout(productId){
    if(productId)window.AskCollectish?.applyUiActions?.([{type:'open_card',product_id:String(productId)}]);
  }

  function ask(text){window.AskCollectish?.send?.(text)}

  function makeActionBar(row){
    const bar=document.createElement('div');bar.className='cx-ask-surface-actions';
    if(row?.product_id)bar.append(action('Open in Scout',()=>openScout(row.product_id),'primary'));
    bar.append(action('Explain risks',()=>ask('What are the biggest risks for this opportunity?')));
    return bar;
  }

  function opportunityCard(row){
    const box=document.createElement('article');box.className='cx-ask-surface cx-ask-opportunity-card';
    box.innerHTML=`<div class="cx-ask-surface-media"><img loading="lazy" decoding="async" src="${esc(tcgImage(row.product_id))}" alt=""></div><div class="cx-ask-surface-copy"><div class="cx-ask-surface-kicker">Scout opportunity</div><div class="cx-ask-surface-title"><strong>${esc(row.product_name||'Unknown card')}</strong><span class="cx-ask-grade">${esc(row.promoted_grade||'—')}</span></div><div class="cx-ask-surface-metrics"><span><small>Scout</small><b>${row.promoted_score??'—'}</b></span><span><small>Market</small><b>${money(row.sku_market_price)}</b></span><span><small>Direct qty</small><b>${row.direct_available??'—'}</b></span></div><div class="cx-ask-surface-note">${esc(row.set_name||'')} ${row.edhrec_rank!=null?`· EDHREC ${Number(row.edhrec_rank).toLocaleString()}`:''}</div></div>`;
    box.querySelector('img')?.addEventListener('error',e=>e.currentTarget.closest('.cx-ask-surface-media')?.remove(),{once:true});
    box.append(makeActionBar(row));
    return box;
  }

  function opportunityCarousel(rows){
    const wrap=document.createElement('section');wrap.className='cx-ask-surface cx-ask-opportunity-carousel';
    wrap.innerHTML='<div class="cx-ask-surface-heading"><strong>Scout opportunities</strong><span>Swipe to compare</span></div>';
    const track=document.createElement('div');track.className='cx-ask-surface-track';
    for(const row of rows.slice(0,8)){
      const card=document.createElement('button');card.type='button';card.className='cx-ask-mini-opportunity';card.onclick=()=>openScout(row.product_id);
      card.innerHTML=`<img loading="lazy" decoding="async" src="${esc(tcgImage(row.product_id))}" alt=""><span class="cx-ask-mini-copy"><span class="cx-ask-mini-title">${esc(row.product_name||'Unknown card')}</span><span class="cx-ask-mini-meta"><b>${esc(row.promoted_grade||'—')} ${row.promoted_score??'—'}</b> · ${money(row.sku_market_price)}</span><span class="cx-ask-mini-note">Direct ${row.direct_available??'—'}${row.edhrec_rank!=null?` · EDHREC ${Number(row.edhrec_rank).toLocaleString()}`:''}</span></span>`;
      card.querySelector('img')?.addEventListener('error',e=>e.currentTarget.remove(),{once:true});track.append(card);
    }
    wrap.append(track);
    const actions=document.createElement('div');actions.className='cx-ask-surface-actions';actions.append(action('Open Scout',()=>window.CollectishShell?.switchPage?.('scout'),'primary'),action('Compare top picks',()=>ask('Compare the top Scout opportunities you just showed me.')));wrap.append(actions);
    return wrap;
  }

  function comparisonSurface(){
    const box=document.createElement('section');box.className='cx-ask-surface cx-ask-comparison-surface';
    box.innerHTML='<div class="cx-ask-surface-heading"><strong>Comparison mode</strong><span>Keep the answer concise; inspect details only when needed.</span></div>';
    const actions=document.createElement('div');actions.className='cx-ask-surface-actions';actions.append(action('Rank best → worst',()=>ask('Rank these from best to worst and give me the deciding factor for each.'),'primary'),action('Show downside',()=>ask('Compare only the downside risks and liquidity concerns.')));box.append(actions);return box;
  }

  function attach(el,surface){
    const msg=el.closest('.cx-ask-msg');if(!msg||msg.querySelector(':scope > .cx-ask-rich-surfaces'))return;
    const host=document.createElement('div');host.className='cx-ask-rich-surfaces';host.append(surface);msg.append(host);
    requestAnimationFrame(()=>host.scrollIntoView({block:'nearest'}));
  }

  async function enhance(ev){
    const {role,element}=ev.detail||{};if(role!=='assistant'||!element||element.closest('.cx-ask-thinking'))return;
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
