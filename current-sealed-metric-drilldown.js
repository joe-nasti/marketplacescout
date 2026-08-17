// Scout Sealed metric drilldowns — explain EV, score, and acquisition sources.
(() => {
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const money=n=>n==null||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
  const pct=n=>n==null||!Number.isFinite(Number(n))?'—':`${Number(n).toFixed(1)}%`;
  const selectedDeck=()=>document.querySelector('#cxSealedRows .cx-sealed-row.selected')?.dataset.deck||'';
  const close=()=>document.querySelector('.cx-sealed-drilldown')?.remove();
  const tcgLink=id=>id?`https://www.tcgplayer.com/product/${encodeURIComponent(id)}`:'';
  const ext=(url,label)=>url?`<a class="cx-sealed-drill-link" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`:'';
  function shell(title,sub=''){
    close();const d=document.createElement('section');d.className='cx-sealed-drilldown';d.innerHTML=`<div class="cx-sealed-drill-head"><div><strong>${esc(title)}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div><button type="button" class="cx-sealed-drill-close" aria-label="Close metric details">×</button></div><div class="cx-sealed-drill-body"><div class="cx-empty">Loading…</div></div>`;document.getElementById('cxSealedDetail')?.append(d);d.querySelector('.cx-sealed-drill-close').onclick=close;return d.querySelector('.cx-sealed-drill-body')
  }
  async function data(deckKey){
    const [ev,cards,decks]=await Promise.all([
      rest(`precon_ev_current?select=*&deck_key=eq.${encodeURIComponent(deckKey)}&limit=1`),
      rest(`precon_card_ev_current?select=*&deck_key=eq.${encodeURIComponent(deckKey)}`),
      rest(`mtgjson_decks?select=sealed_product_uuids&deck_key=eq.${encodeURIComponent(deckKey)}&limit=1`)
    ]);
    const parse=v=>{if(Array.isArray(v))return v.flatMap(parse);if(typeof v==='string'){try{const x=JSON.parse(v);if(x!==v)return parse(x)}catch{}return /^[0-9a-f-]{36}$/i.test(v)?[v]:[]}return []};
    const ids=parse(decks?.[0]?.sealed_product_uuids);let prices=[];if(ids.length)prices=await rest(`sealed_product_price_current?select=*&sealed_uuid=in.(${ids.map(encodeURIComponent).join(',')})`);
    return {ev:ev?.[0]||{},cards:cards||[],tcg:prices.find(x=>x.source==='tcgplayer_public')||null,ck:prices.find(x=>x.source==='cardkingdom_public')||null}
  }
  function cardBreakdown(body,cards,title,calc,total){
    const rows=cards.map(c=>({...c,v:Number(calc(c)||0)})).filter(c=>c.v>0).sort((a,b)=>b.v-a.v),sum=Number(total||rows.reduce((s,x)=>s+x.v,0));
    body.innerHTML=`<div class="cx-sealed-drill-summary"><strong>${money(sum)}</strong><span>${esc(title)}</span><small>${rows.length} contributing cards · tap a card to open TCGplayer</small></div><div class="cx-sealed-drill-cards">${rows.map((c,i)=>`<a href="${esc(tcgLink(c.product_id))}" target="_blank" rel="noopener"><span><b>${i+1}. ${esc(c.card_name)}${Number(c.quantity||1)>1?` ×${Number(c.quantity)}`:''}</b><small>${esc(c.direct_status||'')}</small></span><strong>${money(c.v)}</strong><em>${sum>0?pct(c.v/sum*100):'—'}</em></a>`).join('')}</div>`
  }
  function sourcePanel(body,label,x,kind){
    if(!x){body.innerHTML='<div class="cx-empty">No trusted source match is available.</div>';return}
    const url=kind==='tcg'?tcgLink(x.product_id):x.raw_json?.url||x.product_id;
    body.innerHTML=`<div class="cx-sealed-drill-summary"><strong>${money(kind==='tcg'?(x.low_with_shipping??x.low_price??x.market_price):x.market_price)}</strong><span>${esc(x.product_name||label)}</span><small>${kind==='tcg'?`TCG Market ${money(x.market_price)} · identity ${esc(x.raw_json?.matchConfidence||'—')}`:`Card Kingdom · ${esc((x.raw_json?.stock||'unknown').replaceAll('_',' '))} · reference only`}</small></div>${ext(url,kind==='tcg'?'Open exact TCGplayer product':'Open Card Kingdom product')}`
  }
  function scorePanel(body,label,ev){
    const c=ev.score_components||{},map={
      'Economics':['economics',40,'Rewards positive executable ROI. Direct and CK buylist are strongest; SYP potential is discounted.'],
      'Exit floor':['exit_floor',20,'Rewards CK cash buylist support versus the sealed acquisition price.'],
      'Execution':['execution',15,'Rewards value-weighted Direct coverage plus additional Direct+SYP coverage.'],
      'Data confidence':['confidence',10,'Rewards value-weighted Market and CK buylist pricing coverage.'],
      'Concentration':['concentration',10,'Rewards useful concentration while penalizing extreme dependence on only a few cards.'],
      'Bulk efficiency':['bulk_efficiency',5,'Penalizes decks whose EV is spread across many sub-$1 cards.']
    },m=map[label];if(!m){body.innerHTML='<div class="cx-empty">No score explanation available.</div>';return}
    const [k,max,desc]=m,v=c[k];body.innerHTML=`<div class="cx-sealed-drill-summary"><strong>${v==null?'—':`${Number(v).toFixed(1)} / ${max}`}</strong><span>${esc(label)}</span><small>${esc(desc)}</small></div><div class="cx-sealed-drill-facts"><div><span>Direct ROI</span><b>${pct(ev.direct_roi_pct)}</b></div><div><span>SYP ROI</span><b>${pct(ev.syp_roi_pct)}</b></div><div><span>CK buylist ROI</span><b>${pct(ev.buylist_roi_pct)}</b></div><div><span>Top 10 Market EV</span><b>${pct(ev.top10_market_pct)}</b></div><div><span>Direct value coverage</span><b>${pct(ev.direct_value_coverage_pct)}</b></div><div><span>Bulk cards &lt;$1</span><b>${Number(ev.bulk_cards_lt_1||0).toLocaleString()}</b></div></div>`
  }
  async function drill(stat){
    const label=stat.querySelector('span')?.textContent?.trim()||'',deckKey=selectedDeck();if(!deckKey)return;const body=shell(label,'Tap × to return to the deck');
    try{const {ev,cards,tcg,ck}=await data(deckKey);
      if(label==='TCG Market EV')return cardBreakdown(body,cards,'TCG Market EV',c=>Number(c.quantity||0)*Number(c.tcg_market||0),ev.tcg_market_ev);
      if(label==='Direct live net')return cardBreakdown(body,cards,'Direct live net EV',c=>Number(c.quantity||0)*Number(c.direct_net_current||0),ev.direct_live_net_ev);
      if(label==='SYP-adjusted net')return cardBreakdown(body,cards,'SYP-adjusted Direct net EV',c=>Number(c.quantity||0)*Number(c.direct_net_current??c.direct_net_syp_potential??0),ev.syp_adjusted_direct_net_ev);
      if(label==='CK buylist floor')return cardBreakdown(body,cards,'Card Kingdom cash buylist EV',c=>Number(c.quantity||0)*Number(c.cardkingdom_buylist||0),ev.cardkingdom_buylist_ev);
      if(label==='Sealed acquisition'||label==='TCG Low + shipping'||label==='TCG Market')return sourcePanel(body,label,tcg,'tcg');
      if(label==='Card Kingdom retail'||label==='CK status')return sourcePanel(body,label,ck,'ck');
      if(label==='Best backed spread'){body.innerHTML=`<div class="cx-sealed-drill-summary"><strong>${money(Math.max(Number(ev.direct_live_net_ev||0),Number(ev.syp_adjusted_direct_net_ev||0),Number(ev.cardkingdom_buylist_ev||0))-Number(ev.sealed_acquisition_price||0))}</strong><span>Best backed spread</span><small>Best of Direct live net, SYP-adjusted Direct net, or CK buylist minus sealed acquisition.</small></div><div class="cx-sealed-drill-facts"><div><span>Sealed buy</span><b>${money(ev.sealed_acquisition_price)}</b></div><div><span>Direct net</span><b>${money(ev.direct_live_net_ev)}</b></div><div><span>SYP-adjusted</span><b>${money(ev.syp_adjusted_direct_net_ev)}</b></div><div><span>CK buylist</span><b>${money(ev.cardkingdom_buylist_ev)}</b></div></div>`;return}
      if(['Economics','Exit floor','Execution','Data confidence','Concentration','Bulk efficiency'].includes(label))return scorePanel(body,label,ev);
      body.innerHTML='<div class="cx-empty">More detail is not available for this metric yet.</div>'
    }catch(e){body.innerHTML=`<div class="cx-empty">${esc(e.message||e)}</div>`}
  }
  document.addEventListener('click',e=>{const stat=e.target.closest('#cxSealedDetail .cx-sealed-stat');if(!stat||e.target.closest('.cx-sealed-drilldown'))return;drill(stat)},true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.querySelector('.cx-sealed-drilldown')){e.stopPropagation();close()}});
})();