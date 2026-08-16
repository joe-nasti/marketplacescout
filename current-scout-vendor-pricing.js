// Collectish Scout — bounded MTGJSON vendor pricing + actionable US sourcing.
// MKM/Cardmarket is display-only here and excluded from actionability calculations.
(() => {
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const money=n=>n==null||n===''?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
  const pct=n=>n==null||n===''?'—':`${Number(n)>0?'+':''}${Number(n).toFixed(1)}%`;
  const cache=new Map();
  let seq=0,installed=false;

  function currentSku(){return document.querySelector('#cxParityCards .cx-scout-card.selected')?.dataset?.sku||document.querySelector('#cxParityCards .cx-scout-card')?.dataset?.sku||''}
  function finishFor(v){return /etched/i.test(v||'')?'etched':/foil/i.test(v||'')?'foil':'normal'}
  function matchLabel(v){return v==='sku'?['Exact SKU','high']:v==='scryfall'?['Scryfall printing','high']:v==='product_set_collector'?['Product + set + collector','high']:v==='product_fallback'?['Product fallback','low']:['Unresolved','low']}
  function slug(s){return String(s||'').normalize('NFKD').replace(/[’']/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase()}
  function ext(url,label,cls=''){return url?`<a class="cx-vendor-link ${cls}" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`:''}

  async function scoutRow(sku){
    const rows=await rest(`scout_opportunities_24h?select=sku_id,product_id,product_name,set_code,collector_number,scryfall_id,printing,sku_market_price,tcg_low,low_with_shipping,direct_low&sku_id=eq.${encodeURIComponent(sku)}&limit=1`);
    return rows?.[0]||null;
  }
  async function resolveIdentity(r){
    if(!r)return {row:null,match:null};
    let x=await rest(`mtgjson_tcgplayer_skus?select=uuid,product_id,finish&sku_id=eq.${encodeURIComponent(r.sku_id)}&limit=1`);
    if(x?.[0])return {row:x[0],match:'sku'};
    if(r.scryfall_id){x=await rest(`mtgjson_cards?select=uuid&scryfall_id=eq.${encodeURIComponent(r.scryfall_id)}&limit=1`);if(x?.[0])return {row:x[0],match:'scryfall'}}
    if(r.product_id&&r.set_code&&r.collector_number){x=await rest(`mtgjson_cards?select=uuid&tcgplayer_product_id=eq.${encodeURIComponent(r.product_id)}&set_code=eq.${encodeURIComponent(r.set_code)}&collector_number=eq.${encodeURIComponent(r.collector_number)}&language=eq.English&limit=1`);if(x?.[0])return {row:x[0],match:'product_set_collector'}}
    if(r.product_id){x=await rest(`mtgjson_cards?select=uuid&tcgplayer_product_id=eq.${encodeURIComponent(r.product_id)}&language=eq.English&limit=1`);if(x?.[0])return {row:x[0],match:'product_fallback'}}
    return {row:null,match:null};
  }
  function collapsePrices(rows){
    const out={observed_on:null};
    for(const r of rows||[]){
      if(!out.observed_on||String(r.observed_on)>String(out.observed_on))out.observed_on=r.observed_on;
      const p=String(r.provider||'').toLowerCase(),t=String(r.price_type||'').toLowerCase();
      if(p==='cardkingdom'&&t==='retail')out.cardkingdom_retail=Number(r.price);
      if(p==='cardkingdom'&&t==='buylist')out.cardkingdom_buylist=Number(r.price);
      if(p==='manapool'&&t==='retail')out.manapool_retail=Number(r.price);
      if(p==='cardmarket'&&t==='retail')out.cardmarket_retail=Number(r.price);
      if(p==='tcgplayer'&&t==='retail')out.mtgjson_tcgplayer_retail=Number(r.price);
    }
    return out;
  }
  function linksFor(r){
    const name=r.product_name||r.card_name||'', q=encodeURIComponent(name), set=String(r.set_code||'').toLowerCase(), collector=encodeURIComponent(r.collector_number||''), nameSlug=slug(name);
    return {
      tcg:r.product_id?`https://www.tcgplayer.com/product/${encodeURIComponent(r.product_id)}`:'',
      ck:`https://www.cardkingdom.com/catalog/search?search=header&filter%5Bname%5D=${q}&filter%5Btab%5D=mtg_card`,
      ckBuy:`https://www.cardkingdom.com/purchasing/mtg_singles?search=header&filter%5Bname%5D=${q}`,
      mana:nameSlug?(set&&collector?`https://manapool.com/card/${encodeURIComponent(set)}/${collector}/${nameSlug}`:`https://manapool.com/card/${nameSlug}`):'',
      mkm:r.cardmarket_id?`https://www.cardmarket.com/en/Magic/Products?idProduct=${encodeURIComponent(r.cardmarket_id)}`:(nameSlug?`https://www.cardmarket.com/en/Magic/Cards/${nameSlug}`:'')
    };
  }
  function actionability(r){
    const sources=[];
    const tcgBuy=Number(r.low_with_shipping)>0?Number(r.low_with_shipping):(Number(r.tcg_low)>0?Number(r.tcg_low):null);
    if(tcgBuy) sources.push({name:Number(r.low_with_shipping)>0?'TCG Low + ship':'TCG Low',price:tcgBuy,key:'tcg'});
    if(Number(r.direct_low)>0)sources.push({name:'TCG Direct',price:Number(r.direct_low),key:'tcg'});
    if(Number(r.cardkingdom_retail)>0)sources.push({name:'Card Kingdom',price:Number(r.cardkingdom_retail),key:'ck'});
    if(Number(r.manapool_retail)>0)sources.push({name:'Mana Pool',price:Number(r.manapool_retail),key:'mana'});
    sources.sort((a,b)=>a.price-b.price);
    const cheapest=sources[0]||null,buylist=Number(r.cardkingdom_buylist)>0?Number(r.cardkingdom_buylist):null;
    if(!cheapest||!buylist)return {cheapest,buylist,backed:false};
    const spread=buylist-cheapest.price,roi=spread/cheapest.price*100;
    return {cheapest,buylist,spread,roi,backed:spread>0};
  }
  async function getVendor(sku){
    if(cache.has(sku))return cache.get(sku);
    const scout=await scoutRow(sku);if(!scout){cache.set(sku,null);return null}
    const id=await resolveIdentity(scout);
    if(!id.row?.uuid){const r={...scout,identity_match:null,mtgjson_uuid:null};cache.set(sku,r);return r}
    const [cardRows,priceRows]=await Promise.all([
      rest(`mtgjson_cards?select=name,set_code,collector_number,cardmarket_id,cardkingdom_id,cardkingdom_foil_id,cardkingdom_etched_id&uuid=eq.${encodeURIComponent(id.row.uuid)}&limit=1`),
      rest(`mtgjson_vendor_prices?select=provider,price_type,finish,price,observed_on&uuid=eq.${encodeURIComponent(id.row.uuid)}&finish=eq.${encodeURIComponent(finishFor(id.row.finish||scout.printing))}&order=observed_on.desc&limit=20`)
    ]);
    const prices=collapsePrices(priceRows),card=cardRows?.[0]||{},market=Number(scout.sku_market_price||0);
    const r={...scout,...card,...prices,card_name:card.name||scout.product_name,identity_match:id.match,mtgjson_uuid:id.row.uuid,vendor_observed_on:prices.observed_on};
    if(market>0&&r.cardkingdom_retail!=null)r.ck_retail_discount_vs_market_pct=(market-r.cardkingdom_retail)/market*100;
    if(market>0&&r.manapool_retail!=null)r.manapool_discount_vs_market_pct=(market-r.manapool_retail)/market*100;
    if(market>0&&r.cardkingdom_buylist!=null)r.ck_buylist_to_market_pct=r.cardkingdom_buylist/market*100;
    r.vendor_links=linksFor(r);r.action=actionability(r);cache.set(sku,r);return r;
  }

  function actionBlock(r){
    const a=r.action||{},L=r.vendor_links||{};
    if(a.backed)return `<div class="cx-vendor-action backed"><div><span class="cx-action-badge">BUYLIST BACKED</span><strong>Buy ${esc(a.cheapest.name)} ${money(a.cheapest.price)} → CK buylist ${money(a.buylist)}</strong><small>Gross spread ${money(a.spread)} · ${pct(a.roi)} before outbound shipping</small></div><div class="cx-action-links">${ext(L[a.cheapest.key],`Buy on ${a.cheapest.name}`)}${ext(L.ckBuy,'Open CK buylist')}</div></div>`;
    if(a.cheapest&&a.buylist)return `<div class="cx-vendor-action neutral"><div><span class="cx-action-badge">NO BUYLIST ARB</span><strong>Cheapest US buy ${esc(a.cheapest.name)} ${money(a.cheapest.price)}</strong><small>CK buylist ${money(a.buylist)} · ${money(a.buylist-a.cheapest.price)} vs cheapest buy</small></div></div>`;
    return `<div class="cx-vendor-action neutral"><div><span class="cx-action-badge">INSUFFICIENT EXIT DATA</span><small>Need both a US buy price and cash buylist to test buylist backing.</small></div></div>`;
  }
  function vendorCell(label,price,link,sub='',cls=''){return `<div class="${cls}"><span>${esc(label)}</span><strong>${money(price)}</strong>${sub?`<small>${sub}</small>`:''}${ext(link,`Open ${label}`)}</div>`}
  function renderSection(r){
    if(!r?.mtgjson_uuid)return `<div class="cx-vendor-pricing"><div class="cx-section-title">Vendor pricing · MTGJSON</div><small class="cx-sub">No confident MTGJSON commerce identity yet for this printing.</small></div>`;
    const [match,confidence]=matchLabel(r.identity_match),L=r.vendor_links||{},market=Number(r.sku_market_price||0);
    return `<div class="cx-vendor-pricing"><div class="cx-vendor-head"><div><div class="cx-section-title">Vendor pricing · MTGJSON</div><small>${r.vendor_observed_on?`Observed ${esc(r.vendor_observed_on)}`:'Latest available'} • identity: <b>${esc(match)}</b></small></div><span class="cx-vendor-confidence cx-vendor-${confidence}">${confidence==='high'?'Matched':'Verify'}</span></div>${actionBlock(r)}<div class="cx-vendor-grid">${vendorCell('TCG Market',market||null,L.tcg,'reference')}${vendorCell('TCG Low + ship',Number(r.low_with_shipping)>0?r.low_with_shipping:r.tcg_low,L.tcg,'US buy candidate')}${vendorCell('TCG Direct',r.direct_low,L.tcg,'US buy candidate')}${vendorCell('Card Kingdom retail',r.cardkingdom_retail,L.ck,r.ck_retail_discount_vs_market_pct!=null?`${pct(r.ck_retail_discount_vs_market_pct)} vs Market · US buy candidate`:'US buy candidate')}${vendorCell('CK cash buylist',r.cardkingdom_buylist,L.ckBuy,r.ck_buylist_to_market_pct!=null?`${Number(r.ck_buylist_to_market_pct).toFixed(1)}% of Market · exit`:'cash exit','cx-vendor-exit')}${vendorCell('Mana Pool',r.manapool_retail,L.mana,r.manapool_discount_vs_market_pct!=null?`${pct(r.manapool_discount_vs_market_pct)} vs Market · US buy candidate`:'US buy candidate')}${vendorCell('Cardmarket / MKM',r.cardmarket_retail,L.mkm,'International reference · excluded from actionability','cx-vendor-international')}</div>${r.identity_match==='product_fallback'?'<small class="cx-vendor-warning">Product-only identity fallback — verify the exact printing before acting on this vendor price.</small>':''}</div>`;
  }

  async function refresh(){
    const host=document.getElementById('cxParityDetail');if(!host||!host.closest('#cxScout.active')||host.querySelector('.cx-empty'))return;
    const sku=currentSku();if(!sku)return;let section=host.querySelector('.cx-vendor-pricing');
    if(section?.dataset?.vendorSku===String(sku)&&section.dataset.vendorLoaded==='1')return;
    const my=++seq;
    if(!section){section=document.createElement('div');section.className='cx-vendor-pricing';section.innerHTML='<div class="cx-section-title">Vendor pricing · MTGJSON</div><small>Loading vendor prices…</small>';const links=host.querySelector('.cx-scout-external-links');if(links)host.insertBefore(section,links);else host.appendChild(section)}
    section.dataset.vendorSku=String(sku);
    try{const r=await getVendor(String(sku));if(my!==seq)return;const wrap=document.createElement('div');wrap.innerHTML=renderSection(r);const next=wrap.firstElementChild;next.dataset.vendorSku=String(sku);next.dataset.vendorLoaded='1';section.replaceWith(next)}
    catch(e){if(my!==seq)return;section.dataset.vendorLoaded='1';section.innerHTML=`<div class="cx-section-title">Vendor pricing · MTGJSON</div><small>${esc(e.message||e)}</small>`}
  }

  const style=document.createElement('style');style.textContent=`
    .cx-vendor-pricing{margin-top:16px;padding-top:14px;border-top:1px solid var(--cx-line)}.cx-vendor-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.cx-vendor-head small{color:var(--cx-muted)}.cx-vendor-confidence{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.04em;border-radius:999px;padding:5px 8px}.cx-vendor-high{background:#e8f7ee;color:#16713a}.cx-vendor-low{background:#fff3df;color:#8a4c00}
    .cx-vendor-action{margin-top:10px;border:1px solid var(--cx-line);border-radius:12px;padding:10px;display:flex;justify-content:space-between;gap:10px;align-items:center}.cx-vendor-action.backed{background:#e8f7ee;border-color:#b7e1c6}.cx-vendor-action strong,.cx-vendor-action small{display:block}.cx-vendor-action small{margin-top:3px;color:var(--cx-muted)}.cx-action-badge{display:inline-block;font-size:10px;font-weight:900;letter-spacing:.04em;border-radius:999px;padding:4px 7px;margin-bottom:5px;background:#edf1f6;color:var(--cx-muted)}.cx-vendor-action.backed .cx-action-badge{background:#16713a;color:white}.cx-action-links{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
    .cx-vendor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}.cx-vendor-grid>div{border:1px solid var(--cx-line);border-radius:11px;padding:9px;background:var(--cx-bg)}.cx-vendor-grid span,.cx-vendor-grid small{display:block;color:var(--cx-muted);font-size:10px}.cx-vendor-grid strong{display:block;margin:2px 0;font-size:15px}.cx-vendor-grid .cx-vendor-exit{border-color:#b7e1c6}.cx-vendor-grid .cx-vendor-international{opacity:.72;border-style:dashed}.cx-vendor-link{display:inline-block;margin-top:5px;font-size:10px;font-weight:800;text-decoration:none;color:var(--cx-accent)}.cx-vendor-warning{display:block;margin-top:8px;color:#8a4c00}
    @media(max-width:520px){.cx-vendor-grid{grid-template-columns:1fr 1fr}.cx-vendor-action{align-items:flex-start;flex-direction:column}.cx-action-links{justify-content:flex-start}}
  `;document.head.appendChild(style);
  function install(){if(installed)return;installed=true;const attach=()=>{const host=document.getElementById('cxParityDetail');if(!host)return false;const mo=new MutationObserver(()=>setTimeout(refresh,30));mo.observe(host,{childList:true,subtree:true});document.getElementById('cxParityCards')?.addEventListener('click',()=>setTimeout(refresh,80),true);setTimeout(refresh,100);return true};if(attach())return;const mo=new MutationObserver(()=>{if(attach())mo.disconnect()});mo.observe(document.body,{childList:true,subtree:true})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
