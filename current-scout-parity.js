// Collectish Scout parity layer — card-first grades, artwork and score detail
(() => {
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const money=n=>n==null||n===''?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
  const num=n=>Number(n||0).toLocaleString();
  const cache=new Map();
  let data=[], selected=null, installed=false, rendering=false;

  function grade(score){
    score=Number(score||0);
    if(score>=90)return 'S';
    if(score>=80)return 'A';
    if(score>=70)return 'B';
    if(score>=60)return 'C';
    if(score>=50)return 'D';
    return 'F';
  }
  function imageUrl(card){
    return card?.image_uris?.normal||card?.image_uris?.large||card?.card_faces?.find(x=>x.image_uris)?.image_uris?.normal||'';
  }
  function cardCacheKey(r){return `${String(r.set_code||'').toLowerCase()}|${r.collector_number||''}|${r.product_name||''}`}
  async function scryfall(r){
    const key=cardCacheKey(r); if(cache.has(key))return cache.get(key);
    const stored=sessionStorage.getItem(`cxsf:${key}`); if(stored){try{const v=JSON.parse(stored);cache.set(key,v);return v}catch{}}
    let card=null;
    try{
      if(r.scryfall_id){
        const x=await fetch(`https://api.scryfall.com/cards/${encodeURIComponent(r.scryfall_id)}`); if(x.ok)card=await x.json();
      }
      if(!card&&r.set_code&&r.collector_number){
        const x=await fetch(`https://api.scryfall.com/cards/${encodeURIComponent(String(r.set_code).toLowerCase())}/${encodeURIComponent(r.collector_number)}`); if(x.ok)card=await x.json();
      }
      if(!card&&r.product_name){
        const clean=String(r.product_name).replace(/\s*\([^)]*(foil|showcase|borderless|extended art|serialized)[^)]*\)\s*/ig,' ').replace(/\s+/g,' ').trim();
        const x=await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(clean)}`); if(x.ok)card=await x.json();
      }
    }catch{}
    cache.set(key,card); try{if(card)sessionStorage.setItem(`cxsf:${key}`,JSON.stringify(card))}catch{}
    return card;
  }
  function components(r){
    const c=r.raw_json?.scoreComponents||{};
    return [
      ['Velocity',c.velocityPoints,35],
      ['Absolute scarcity',c.absoluteScarcityPoints,15],
      ['Direct concentration',c.directConcentrationPoints,15],
      ['Marketplace concentration',c.marketplaceConcentrationPoints,15],
      ['Direct premium',c.premiumPoints,20]
    ];
  }
  function thesis(r,card){
    const out=[];
    if(Number(r.direct_available||0)<=10)out.push('thin Direct inventory');
    if(Number(r.avg_daily_qty_sold||0)>=1)out.push(`${Number(r.avg_daily_qty_sold).toFixed(1)} sales/day`);
    if(Number(r.direct_low||0)>Number(r.sku_market_price||0)&&Number(r.sku_market_price||0)>0)out.push('Direct premium over Market');
    const er=Number(r.edhrec_rank||card?.edhrec_rank||0); if(er>0&&er<=5000)out.push(`strong Commander demand (#${num(er)} EDHREC)`);
    return out.length?out.join(' • '):'Review supply, velocity and price structure before buying.';
  }

  async function fetchRows(){
    const rows=await rest('marketplace_scan_rows?select=id,sku_id,product_id,product_name,collector_number,set_name,set_code,rarity,printing,condition,language,sales_rank,direct_low,sku_market_price,tcg_low,low_with_shipping,direct_listings,direct_available,avg_daily_qty_sold,opportunity_score,flag,supply_type,raw_json,scryfall_id,edhrec_rank,commander_demand_score,commander_enriched_at&order=id.desc&limit=4000');
    const latest=new Map();
    for(const r of rows||[]){const k=r.sku_id||r.product_id||r.id;if(!latest.has(k))latest.set(k,r)}
    return [...latest.values()].sort((a,b)=>Number(b.opportunity_score||0)-Number(a.opportunity_score||0)).slice(0,180);
  }

  function skeleton(host){
    host.innerHTML=`<div class="cx-page-head"><div><h2>Scout</h2><p>Card-first buying and speculation opportunities.</p></div><button class="cx-refresh" id="cxScoutParityRefresh">Refresh</button></div><div class="cx-empty">Loading Scout opportunities…</div>`;
  }
  function render(host){
    const sets=[...new Set(data.map(x=>x.set_name).filter(Boolean))].sort();
    host.innerHTML=`<div class="cx-page-head"><div><h2>Scout</h2><p>Card-first buying and speculation opportunities.</p></div><button class="cx-refresh" id="cxScoutParityRefresh">Refresh</button></div>
      <div class="cx-scout-toolbar"><input id="cxParitySearch" placeholder="Search cards, sets, SKUs…"><select id="cxParityGrade"><option value="">All grades</option>${['S','A','B','C','D','F'].map(x=>`<option>${x}</option>`).join('')}</select><select id="cxParitySet"><option value="">All sets</option>${sets.map(x=>`<option>${esc(x)}</option>`).join('')}</select></div>
      <div class="cx-scout-layout"><section><div id="cxParityCards" class="cx-scout-cards"></div></section><aside id="cxParityDetail" class="cx-card cx-scout-detail"></aside></div>`;
    const apply=()=>{
      const q=document.getElementById('cxParitySearch').value.trim().toLowerCase(),g=document.getElementById('cxParityGrade').value,s=document.getElementById('cxParitySet').value;
      const rows=data.filter(r=>(!q||`${r.product_name} ${r.set_name} ${r.sku_id}`.toLowerCase().includes(q))&&(!g||grade(r.opportunity_score)===g)&&(!s||r.set_name===s));
      renderCards(rows); if(!selected||!rows.includes(selected))selected=rows[0]||null; renderDetail(selected);
    };
    document.getElementById('cxParitySearch').oninput=apply; document.getElementById('cxParityGrade').onchange=apply; document.getElementById('cxParitySet').onchange=apply;
    document.getElementById('cxScoutParityRefresh').onclick=load; apply();
  }
  function renderCards(rows){
    const host=document.getElementById('cxParityCards'); if(!host)return;
    if(!rows.length){host.innerHTML='<div class="cx-empty">No opportunities match these filters.</div>';return}
    host.innerHTML=rows.slice(0,72).map((r,i)=>`<button class="cx-scout-card ${selected===r?'selected':''}" data-cx-parity="${i}" data-sku="${esc(r.sku_id||'')}"><div class="cx-scout-thumb" data-thumb="${esc(r.sku_id||'')}"><div class="cx-scout-thumb-placeholder">${grade(r.opportunity_score)}</div></div><div class="cx-scout-card-body"><div class="cx-scout-card-top"><span class="cx-grade cx-grade-${grade(r.opportunity_score).toLowerCase()}">${grade(r.opportunity_score)}</span><span class="cx-score-mini">${num(r.opportunity_score)}/100</span></div><strong>${esc(r.product_name)}</strong><small>${esc(r.set_name)} • ${esc(r.printing)} • ${esc(r.condition)}</small><div class="cx-scout-card-metrics"><span>Market <b>${money(r.sku_market_price)}</b></span><span>Direct <b>${money(r.direct_low)}</b></span><span>Qty <b>${num(r.direct_available)}</b></span><span>Sales/day <b>${Number(r.avg_daily_qty_sold||0).toFixed(1)}</b></span></div></div></button>`).join('');
    host.querySelectorAll('[data-cx-parity]').forEach(btn=>btn.onclick=()=>{selected=rows[Number(btn.dataset.cxParity)]||rows[0];renderCards(rows);renderDetail(selected)});
    rows.slice(0,24).forEach(async r=>{const c=await scryfall(r),u=imageUrl(c);if(!u)return;const slot=host.querySelector(`[data-thumb="${CSS.escape(String(r.sku_id||''))}"]`);if(slot)slot.innerHTML=`<img loading="lazy" src="${esc(u)}" alt="${esc(r.product_name)}">`});
  }
  async function renderDetail(r){
    const host=document.getElementById('cxParityDetail');if(!host)return;
    if(!r){host.innerHTML='<div class="cx-empty">Select a card.</div>';return}
    host.innerHTML='<div class="cx-empty">Loading card detail…</div>';
    const card=await scryfall(r), er=Number(r.edhrec_rank||card?.edhrec_rank||0), img=imageUrl(card), comps=components(r);
    const totalKnown=comps.some(([,v])=>Number.isFinite(Number(v)));
    host.innerHTML=`${img?`<img class="cx-scout-hero" src="${esc(img)}" alt="${esc(r.product_name)}">`:''}<div class="cx-detail-title"><div><div class="cx-section-title">${esc(r.product_name)}</div><span class="cx-sub">${esc(r.set_name)} • #${esc(r.collector_number||'—')} • ${esc(r.printing)} • ${esc(r.condition)}</span></div><span class="cx-grade cx-grade-${grade(r.opportunity_score).toLowerCase()}">${grade(r.opportunity_score)}</span></div><div class="cx-score">${num(r.opportunity_score)}<span>/100</span></div><div class="cx-thesis"><strong>Why Scout likes it</strong><br>${esc(thesis(r,card))}</div><div class="cx-detail-list"><div class="cx-detail-stat"><span>TCG Market</span><strong>${money(r.sku_market_price)}</strong></div><div class="cx-detail-stat"><span>Direct Low</span><strong>${money(r.direct_low)}</strong></div><div class="cx-detail-stat"><span>Direct qty</span><strong>${num(r.direct_available)}</strong></div><div class="cx-detail-stat"><span>Direct listings</span><strong>${num(r.direct_listings)}</strong></div><div class="cx-detail-stat"><span>Sales / day</span><strong>${Number(r.avg_daily_qty_sold||0).toFixed(1)}</strong></div><div class="cx-detail-stat"><span>Sales rank</span><strong>${num(r.sales_rank)}</strong></div><div class="cx-detail-stat"><span>EDHREC rank</span><strong>${er?`#${num(er)}`:'—'}</strong></div><div class="cx-detail-stat"><span>Supply</span><strong>${esc(r.supply_type||'—')}</strong></div></div>${totalKnown?`<div class="cx-score-breakdown"><div class="cx-section-title">Score breakdown</div>${comps.map(([n,v,max])=>`<div class="cx-score-row"><span>${esc(n)}</span><progress max="${max}" value="${Math.max(0,Number(v||0))}"></progress><b>${Number(v||0).toFixed(1)}/${max}</b></div>`).join('')}<small>Extension scoring: 35 velocity + 45 supply structure + 20 Direct premium.</small></div>`:''}${card?.scryfall_uri?`<a class="cx-scout-link" target="_blank" rel="noopener" href="${esc(card.scryfall_uri)}">Open card on Scryfall</a>`:''}`;
  }

  async function load(){
    const host=document.getElementById('cxScout'); if(!host||rendering)return; rendering=true; host.dataset.scoutParity='loading'; skeleton(host);
    try{data=await fetchRows();selected=data[0]||null;render(host);host.dataset.scoutParity='ready'}catch(e){host.innerHTML=`<div class="cx-page-head"><div><h2>Scout</h2><p>Card-first buying and speculation opportunities.</p></div></div><div class="cx-empty">${esc(e.message)}</div>`}finally{rendering=false}
  }
  function install(){
    const host=document.getElementById('cxScout'); if(!host)return false;
    if(!installed){installed=true;document.addEventListener('click',e=>{if(e.target.closest('[data-cx-page="scout"]'))setTimeout(load,80)},true)}
    load();return true;
  }
  const mo=new MutationObserver(()=>{const h=document.getElementById('cxScout');if(h&&h.classList.contains('active')&&h.dataset.scoutParity!=='ready'&&!rendering)setTimeout(install,0)});
  mo.observe(document.documentElement,{childList:true,subtree:true});
  if(!install())setTimeout(install,100);
})();