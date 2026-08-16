// Collectish Scout — bounded MTGJSON vendor pricing context.
// Vendor prices are contextual only; they do not modify Scout's base grade yet.
(() => {
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const money=n=>n==null||n===''?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
  const pct=n=>n==null||n===''?'—':`${Number(n)>0?'+':''}${Number(n).toFixed(1)}%`;
  const cache=new Map();
  let seq=0,installed=false;

  function currentSku(){return document.querySelector('#cxParityCards .cx-scout-card.selected')?.dataset?.sku||document.querySelector('#cxParityCards .cx-scout-card')?.dataset?.sku||''}
  function finishFor(v){return /etched/i.test(v||'')?'etched':/foil/i.test(v||'')?'foil':'normal'}
  function matchLabel(v){return v==='sku'?['Exact SKU','high']:v==='scryfall'?['Scryfall printing','high']:v==='product_set_collector'?['Product + set + collector','high']:v==='product_fallback'?['Product fallback','low']:['Unresolved','low']}

  async function scoutRow(sku){
    const rows=await rest(`scout_opportunities_24h?select=sku_id,product_id,product_name,set_code,collector_number,scryfall_id,printing,sku_market_price,direct_low&sku_id=eq.${encodeURIComponent(sku)}&limit=1`);
    return rows?.[0]||null;
  }
  async function resolveIdentity(r){
    if(!r)return {row:null,match:null};
    let x=await rest(`mtgjson_tcgplayer_skus?select=uuid,product_id,finish&sku_id=eq.${encodeURIComponent(r.sku_id)}&limit=1`);
    if(x?.[0])return {row:x[0],match:'sku'};
    if(r.scryfall_id){x=await rest(`mtgjson_cards?select=uuid& scryfall_id=eq.${encodeURIComponent(r.scryfall_id)}&limit=1`.replace('?select=uuid& ','?select=uuid&'));if(x?.[0])return {row:x[0],match:'scryfall'}}
    if(r.product_id&&r.set_code&&r.collector_number){
      x=await rest(`mtgjson_cards?select=uuid&tcgplayer_product_id=eq.${encodeURIComponent(r.product_id)}&set_code=eq.${encodeURIComponent(r.set_code)}&collector_number=eq.${encodeURIComponent(r.collector_number)}&language=eq.English&limit=1`);
      if(x?.[0])return {row:x[0],match:'product_set_collector'};
    }
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
  async function getVendor(sku){
    if(cache.has(sku))return cache.get(sku);
    const scout=await scoutRow(sku);if(!scout){cache.set(sku,null);return null}
    const id=await resolveIdentity(scout);
    if(!id.row?.uuid){const r={...scout,identity_match:null,mtgjson_uuid:null};cache.set(sku,r);return r}
    const finish=finishFor(id.row.finish||scout.printing);
    const priceRows=await rest(`mtgjson_vendor_prices?select=provider,price_type,finish,price,observed_on&uuid=eq.${encodeURIComponent(id.row.uuid)}&finish=eq.${encodeURIComponent(finish)}&order=observed_on.desc&limit=20`);
    const prices=collapsePrices(priceRows),market=Number(scout.sku_market_price||0);
    const r={...scout,...prices,identity_match:id.match,mtgjson_uuid:id.row.uuid,vendor_observed_on:prices.observed_on};
    if(market>0&&r.cardkingdom_retail!=null)r.ck_retail_discount_vs_market_pct=(market-r.cardkingdom_retail)/market*100;
    if(market>0&&r.manapool_retail!=null)r.manapool_discount_vs_market_pct=(market-r.manapool_retail)/market*100;
    if(market>0&&r.cardkingdom_buylist!=null)r.ck_buylist_to_market_pct=r.cardkingdom_buylist/market*100;
    cache.set(sku,r);return r;
  }

  function renderSection(r){
    if(!r?.mtgjson_uuid)return `<div class="cx-vendor-pricing"><div class="cx-section-title">Vendor pricing · MTGJSON</div><small class="cx-sub">No confident MTGJSON commerce identity yet for this printing.</small></div>`;
    const [match,confidence]=matchLabel(r.identity_match),cheap=[];
    if(r.cardkingdom_retail!=null)cheap.push(['Card Kingdom',Number(r.cardkingdom_retail)]);
    if(r.manapool_retail!=null)cheap.push(['Mana Pool',Number(r.manapool_retail)]);
    cheap.sort((a,b)=>a[1]-b[1]);const best=cheap[0],market=Number(r.sku_market_price||0),direct=Number(r.direct_low||0),bestSpread=best&&market>0?((market-best[1])/market)*100:null;
    return `<div class="cx-vendor-pricing"><div class="cx-vendor-head"><div><div class="cx-section-title">Vendor pricing · MTGJSON</div><small>${r.vendor_observed_on?`Observed ${esc(r.vendor_observed_on)}`:'Latest available'} • identity: <b>${esc(match)}</b></small></div><span class="cx-vendor-confidence cx-vendor-${confidence}">${confidence==='high'?'Matched':'Verify'}</span></div><div class="cx-vendor-grid"><div><span>Card Kingdom retail</span><strong>${money(r.cardkingdom_retail)}</strong><small>${r.ck_retail_discount_vs_market_pct!=null?`${pct(r.ck_retail_discount_vs_market_pct)} vs TCG Market`:''}</small></div><div><span>CK buylist</span><strong>${money(r.cardkingdom_buylist)}</strong><small>${r.ck_buylist_to_market_pct!=null?`${Number(r.ck_buylist_to_market_pct).toFixed(1)}% of Market`:''}</small></div><div><span>Mana Pool</span><strong>${money(r.manapool_retail)}</strong><small>${r.manapool_discount_vs_market_pct!=null?`${pct(r.manapool_discount_vs_market_pct)} vs TCG Market`:''}</small></div><div><span>Cardmarket</span><strong>${money(r.cardmarket_retail)}</strong><small>MTGJSON retail</small></div></div><div class="cx-vendor-context"><span>TCG Market <b>${money(market||null)}</b></span><span>Direct <b>${money(direct||null)}</b></span>${best?`<span>Lowest US comp <b>${esc(best[0])} ${money(best[1])}</b>${bestSpread!=null?` (${pct(bestSpread)} vs Market)`:''}</span>`:''}</div>${r.identity_match==='product_fallback'?'<small class="cx-vendor-warning">Product-only identity fallback — verify the exact printing before acting on this vendor price.</small>':''}</div>`;
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

  const style=document.createElement('style');style.textContent=`.cx-vendor-pricing{margin-top:16px;padding-top:14px;border-top:1px solid var(--cx-line)}.cx-vendor-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.cx-vendor-head small{color:var(--cx-muted)}.cx-vendor-confidence{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.04em;border-radius:999px;padding:5px 8px}.cx-vendor-high{background:#e8f7ee;color:#16713a}.cx-vendor-low{background:#fff3df;color:#8a4c00}.cx-vendor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}.cx-vendor-grid>div{border:1px solid var(--cx-line);border-radius:11px;padding:9px;background:var(--cx-bg)}.cx-vendor-grid span,.cx-vendor-grid small{display:block;color:var(--cx-muted);font-size:10px}.cx-vendor-grid strong{display:block;margin:2px 0;font-size:15px}.cx-vendor-context{display:flex;flex-wrap:wrap;gap:8px 14px;margin-top:9px;font-size:11px;color:var(--cx-muted)}.cx-vendor-context b{color:var(--cx-text)}.cx-vendor-warning{display:block;margin-top:8px;color:#8a4c00}@media(max-width:520px){.cx-vendor-grid{grid-template-columns:1fr 1fr}}`;document.head.appendChild(style);
  function install(){if(installed)return;installed=true;const attach=()=>{const host=document.getElementById('cxParityDetail');if(!host)return false;const mo=new MutationObserver(()=>setTimeout(refresh,30));mo.observe(host,{childList:true,subtree:true});document.getElementById('cxParityCards')?.addEventListener('click',()=>setTimeout(refresh,80),true);setTimeout(refresh,100);return true};if(attach())return;const mo=new MutationObserver(()=>{if(attach())mo.disconnect()});mo.observe(document.body,{childList:true,subtree:true})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
