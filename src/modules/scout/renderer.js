import store from '../../state/store.js';

// Collectish Scout v5 — promoted score and unified actionable card detail.
(() => {
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
  const num=n=>Number(n||0).toLocaleString();
  const pct=n=>n==null||!Number.isFinite(Number(n))?'—':`${Number(n).toFixed(0)}%`;
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number(n||0)));
  const initial=store.get().scout||{};
  let rows=initial.rows||[],visible=initial.visible||[],selected=null,loading=false,detailSeq=0,installed=false,computedAt=initial.computedAt||null;
  const sfCache=new Map();
  const sync=patch=>store.update('scout',patch);

  function score(r){return Number(r?.promoted_score??r?.v5_shadow_score??r?.opportunity_score??0)}
  function grade(r){return r?.promoted_grade||r?.v5_shadow_grade||(score(r)>=80?'A':score(r)>=70?'B':score(r)>=60?'C':score(r)>=50?'D':'F')}
  function imageUrl(c){return c?.image_uris?.normal||c?.image_uris?.large||c?.card_faces?.find(x=>x.image_uris)?.image_uris?.normal||''}
  function baseName(n=''){return String(n).replace(/\s*\([^)]*(foil|showcase|borderless|extended art|serialized|retro frame|etched|alternate art|halo foil|rainbow foil|surge foil|galaxy foil)[^)]*\)\s*/ig,' ').replace(/\s+/g,' ').trim()}
  function slug(s){return String(s||'').normalize('NFKD').replace(/[’']/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase()}
  function tcgUrl(r){return r?.product_id?`https://www.tcgplayer.com/product/${encodeURIComponent(r.product_id)}?Printing=${encodeURIComponent(r.printing||'Normal')}&Condition=${encodeURIComponent(r.condition||'Near Mint')}&Language=${encodeURIComponent(r.language||'English')}&direct=true&page=1`:''}
  function links(r,card){const q=encodeURIComponent(r.product_name||''),nameSlug=slug(r.product_name),set=String(r.set_code||'').toLowerCase(),collector=encodeURIComponent(r.collector_number||'');return {
    tcg:tcgUrl(r),
    ck:`https://www.cardkingdom.com/catalog/search?search=header&filter%5Bname%5D=${q}&filter%5Btab%5D=mtg_card`,
    ckBuy:`https://www.cardkingdom.com/purchasing/mtg_singles?search=header&filter%5Bname%5D=${q}`,
    mana:nameSlug?(set&&collector?`https://manapool.com/card/${encodeURIComponent(set)}/${collector}/${nameSlug}`:`https://manapool.com/card/${nameSlug}`):'',
    mkm:r.cardmarket_retail!=null&&nameSlug?`https://www.cardmarket.com/en/Magic/Cards/${nameSlug}`:'',
    edh:nameSlug?`https://edhrec.com/cards/${nameSlug}`:'',scry:card?.scryfall_uri||''};}
  function ext(url,label){return url?`<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`:''}

  async function scryfall(r){
    const k=`${r.scryfall_id||''}|${r.set_code||''}|${r.collector_number||''}|${r.product_name||''}`;if(sfCache.has(k))return sfCache.get(k);
    let c=null;try{
      if(r.scryfall_id){const x=await fetch(`https://api.scryfall.com/cards/${encodeURIComponent(r.scryfall_id)}`);if(x.ok)c=await x.json()}
      if(!c&&r.set_code&&r.collector_number){const x=await fetch(`https://api.scryfall.com/cards/${encodeURIComponent(String(r.set_code).toLowerCase())}/${encodeURIComponent(r.collector_number)}`);if(x.ok)c=await x.json()}
      if(!c&&r.product_name){const x=await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(baseName(r.product_name))}`);if(x.ok)c=await x.json()}
    }catch{}
    sfCache.set(k,c);return c;
  }

  function badges(r){const b=[];if(r.direct_backed)b.push('<span class="cx-v5-badge direct">DIRECT BACKED</span>');else if(r.near_direct_backed)b.push('<span class="cx-v5-badge near">DIRECT FLOOR ≥90%</span>');if(r.buylist_backed)b.push('<span class="cx-v5-badge backed">BUYLIST BACKED</span>');if(r.source_verify)b.push('<span class="cx-v5-badge verify">VERIFY SOURCE</span>');return b.join('')}
  function component(label,value,max,sub){return `<div class="cx-v5-component"><span>${esc(label)}</span><strong>${Number(value||0).toFixed(1)}<small>/${max}</small></strong><progress max="${max}" value="${clamp(value,0,max)}"></progress>${sub?`<em>${esc(sub)}</em>`:''}</div>`}
  function stat(label,value,sub=''){return `<div class="cx-v5-stat"><span>${esc(label)}</span><strong>${value}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`}

  async function fetchRows(){
    const x=await rest('scout_opportunities_v5?select=*&order=promoted_score.desc,observation_count.desc&limit=500');
    computedAt=x?.[0]?.v5_computed_at||x?.[0]?.computed_at||null;
    const next=x||[];
    sync({status:'ready',rows:next,computedAt,error:null});
    return next;
  }
  function skeleton(h){sync({status:'loading'});h.innerHTML='<div class="cx-page-head"><div><h2>Scout</h2><p>Finding the strongest buying and speculation opportunities…</p></div></div><div class="cx-empty">Loading Scout v5…</div>'}
  function renderShell(h){
    const sets=[...new Set(rows.map(x=>x.set_name).filter(Boolean))].sort();
    h.innerHTML=`<div class="cx-page-head"><div><h2>Scout</h2><p>Thesis + execution + exit floor + market confirmation.</p><small class="cx-sub">${computedAt?`v5 updated ${new Date(computedAt).toLocaleString()}`:'Current v5 rankings'}</small></div><button class="cx-refresh" id="cxScoutParityRefresh">Refresh</button></div><div class="cx-scout-toolbar"><input id="cxParitySearch" placeholder="Search all Magic cards…"><select id="cxParityGrade"><option value="">All grades</option>${['A','B','C','D','F'].map(x=>`<option>${x}</option>`).join('')}</select><select id="cxParitySet"><option value="">All sets</option>${sets.map(x=>`<option>${esc(x)}</option>`).join('')}</select></div><div class="cx-scout-layout"><section><div id="cxParityCards" class="cx-scout-cards"></div></section><aside id="cxParityDetail" class="cx-card cx-scout-detail"></aside></div>`;
    const apply=()=>{
      const q=document.getElementById('cxParitySearch').value.trim().toLowerCase(),g=document.getElementById('cxParityGrade').value,s=document.getElementById('cxParitySet').value;
      visible=rows.filter(r=>(!q||`${r.product_name} ${r.set_name} ${r.sku_id}`.toLowerCase().includes(q))&&(!g||grade(r)===g)&&(!s||r.set_name===s));
      if(!selected||!visible.includes(selected))selected=visible[0]||null;
      sync({visible,filters:{query:q,grade:g,set:s},selectedSku:selected?.sku_id||null});
      renderCards();renderDetail(selected,false);
    };
    document.getElementById('cxParitySearch').oninput=apply;document.getElementById('cxParityGrade').onchange=apply;document.getElementById('cxParitySet').onchange=apply;document.getElementById('cxScoutParityRefresh').onclick=()=>load({force:true});
    document.getElementById('cxParityCards').addEventListener('click',e=>{const b=e.target.closest('.cx-scout-card');if(!b)return;selected=visible.find(r=>String(r.sku_id)===b.dataset.sku)||null;sync({selectedSku:selected?.sku_id||null});document.querySelectorAll('#cxParityCards .cx-scout-card').forEach(x=>x.classList.toggle('selected',x===b));renderDetail(selected,true)},true);
    apply();
  }
  function renderCards(){
    const h=document.getElementById('cxParityCards');if(!h)return;
    if(!visible.length){h.innerHTML='<div class="cx-empty">No opportunities match these filters.</div>';document.dispatchEvent(new CustomEvent('collectish:scout-list-rendered',{detail:{count:0}}));return}
    h.innerHTML=visible.slice(0,120).map(r=>`<button type="button" class="cx-scout-card ${selected===r?'selected':''}" data-sku="${esc(r.sku_id)}"><div class="cx-scout-thumb" data-v5-thumb="${esc(r.sku_id)}"><div class="cx-scout-thumb-placeholder">${grade(r)}</div></div><div class="cx-scout-card-body"><div class="cx-scout-card-top"><span class="cx-grade cx-grade-${grade(r).toLowerCase()}">${grade(r)}</span><span class="cx-score-mini">Scout ${score(r)}/100</span></div><strong>${esc(r.product_name)}</strong><small>${esc(r.set_name)} • ${esc(r.printing)} • ${esc(r.condition)}</small><div class="cx-scout-card-metrics"><span>Low <b>${money(r.tcg_low)}</b></span><span>Market <b>${money(r.sku_market_price)}</b></span><span>Direct <b>${money(r.direct_low)}</b></span><span>CK BL <b>${money(r.ck_buylist)}</b></span></div>${badges(r)?`<div class="cx-v5-mini-badges">${badges(r)}</div>`:''}</div></button>`).join('');
    document.dispatchEvent(new CustomEvent('collectish:scout-list-rendered',{detail:{count:Math.min(visible.length,120)}}));
    visible.slice(0,32).forEach(async r=>{const c=await scryfall(r),u=imageUrl(c),slot=h.querySelector(`[data-v5-thumb="${CSS.escape(String(r.sku_id))}"]`);if(u&&slot)slot.innerHTML=`<img loading="lazy" src="${esc(u)}" alt="${esc(r.product_name)}">`});
  }
  function closeMobile(){const h=document.getElementById('cxParityDetail');h?.classList.remove('cx-mobile-detail-open');document.body.classList.remove('cx-scout-detail-lock')}

  async function renderDetail(r,openMobile){
    const h=document.getElementById('cxParityDetail');if(!h)return;
    if(!r){h.innerHTML='<div class="cx-empty">Select a card.</div>';document.dispatchEvent(new CustomEvent('collectish:scout-detail-rendered',{detail:{sku:null}}));return}
    const seq=++detailSeq;if(openMobile&&matchMedia('(max-width:980px)').matches){h.classList.add('cx-mobile-detail-open');document.body.classList.add('cx-scout-detail-lock')}
    h.innerHTML='<div class="cx-empty">Loading card detail…</div>';
    const card=await scryfall(r);if(seq!==detailSeq)return;
    const img=imageUrl(card),L=links(r,card),execution=Number(r.direct_execution_points||0)+Number(r.buylist_backing_points||0),exit=Number(r.exit_floor_points||0),directRoi=r.cheapest_buy>0&&r.direct_net_profit!=null?Number(r.direct_net_profit)/Number(r.cheapest_buy)*100:null,copiesPer=Number(r.direct_listings)>0?Number(r.direct_available||0)/Number(r.direct_listings):null,er=Number(r.edhrec_rank||card?.edhrec_rank||0);
    h.innerHTML=`<button type="button" class="cx-mobile-detail-close" aria-label="Close card details">×</button>${img?`<img class="cx-scout-hero" src="${esc(img)}" alt="${esc(r.product_name)}">`:''}<div class="cx-v5-title"><div><div class="cx-section-title">${esc(r.product_name)}</div><span class="cx-sub">${esc(r.set_name)} • #${esc(r.collector_number||'—')} • ${esc(r.printing)} • ${esc(r.condition)}</span></div><div class="cx-v5-grade"><span class="cx-grade cx-grade-${grade(r).toLowerCase()}">${grade(r)}</span><strong>${score(r)}<small>/100</small></strong></div></div><div class="cx-v5-badges">${badges(r)}</div><div class="cx-v5-components">${component('Thesis',r.thesis_points,70,'card quality')}${component('Execution',execution,20,'today’s trade')}${component('Exit / Floor',exit,5,'cash support')}${component('Confirmation',r.confirmation_points,5,'independent prices')}</div>
    <section class="cx-v5-section"><div class="cx-section-title">Best trade</div><div class="cx-v5-callout"><div><span>Best observed US buy</span><strong>${esc(r.cheapest_source||'—')} ${money(r.cheapest_buy)}</strong></div><div><span>TCG Direct Low</span><strong>${money(r.direct_low)}</strong></div><div><span>Est. Direct net</span><strong>${money(r.direct_net_est)}</strong></div><div><span>Est. Direct profit</span><strong>${money(r.direct_net_profit)}${directRoi!=null?` · ${directRoi.toFixed(1)}%`:''}</strong></div></div></section>
    <section class="cx-v5-section"><div class="cx-section-title">Cash floor</div><div class="cx-v5-grid">${stat('CK cash buylist',money(r.ck_buylist),r.buylist_backed?'above cheapest observed buy':'cash exit')}${stat('Buylist spread',money(r.buylist_spread),r.buylist_roi_pct!=null?`${Number(r.buylist_roi_pct).toFixed(1)}% vs cheapest buy`:'—')}${stat('Buylist / Market',r.sku_market_price>0&&r.ck_buylist>0?pct(Number(r.ck_buylist)/Number(r.sku_market_price)*100):'—')}${stat('Buylist / Direct',r.buylist_to_direct_pct!=null?pct(r.buylist_to_direct_pct):'—',r.direct_backed?'DIRECT BACKED':r.near_direct_backed?'near Direct floor':'')}</div></section>
    <section class="cx-v5-section"><div class="cx-section-title">Market pricing</div><div class="cx-v5-grid">${stat('TCG Market',money(r.sku_market_price),'index / reference')}${stat('TCG Low',money(r.tcg_low),'retail acquisition')}${stat('TCG Direct Low',money(r.direct_low),'premium Direct benchmark')}${stat('Card Kingdom',money(r.ck_retail),'US retail')}${stat('Mana Pool',money(r.manapool_retail),'US retail')}${stat('Cardmarket / MKM',money(r.cardmarket_retail),'international reference')}</div></section>
    <section class="cx-v5-section"><div class="cx-section-title">Demand & supply</div><div class="cx-v5-grid">${stat('Sales / day',Number(r.avg_daily_qty_sold||0).toFixed(1))}${stat('EDHREC rank',er?`#${num(er)}`:'—')}${stat('Direct copies',num(r.direct_available))}${stat('Direct listings',num(r.direct_listings))}${stat('Copies / Direct listing',copiesPer!=null?copiesPer.toFixed(1):'—')}${stat('Supply',esc(r.supply_type||'—'))}</div></section>
    <details class="cx-v5-details"><summary>Score details</summary><div class="cx-v5-grid">${stat('Legacy v4 score',num(r.v4_score??r.opportunity_score))}${stat('24h base',Number(r.base_score_24h||0).toFixed(1))}${stat('Demand adjustment',`${Number(r.demand_adjustment||0)>0?'+':''}${Number(r.demand_adjustment||0).toFixed(1)}`)}${stat('Trend adjustment',`${Number(r.trend_adjustment||0)>0?'+':''}${Number(r.trend_adjustment||0).toFixed(1)}`)}${stat('24h observations',num(r.observation_count))}${stat('Direct premium',r.sku_market_price>0&&r.direct_low>0?`${((Number(r.direct_low)/Number(r.sku_market_price)-1)*100).toFixed(0)}%`:'—')}</div></details>
    <div class="cx-v5-links">${ext(L.tcg,'TCGplayer')}${ext(L.ck,'Card Kingdom')}${ext(L.ckBuy,'CK buylist')}${ext(L.mana,'Mana Pool')}${ext(L.mkm,'Cardmarket')}${ext(L.edh,'EDHREC')}${ext(L.scry,'Scryfall')}</div>`;
    h.querySelector('.cx-mobile-detail-close')?.addEventListener('click',closeMobile);
    document.dispatchEvent(new CustomEvent('collectish:scout-detail-rendered',{detail:{sku:r.sku_id,productId:r.product_id}}));
  }

  async function load(){
    const h=document.getElementById('cxScout');if(!h||loading)return;
    loading=true;closeMobile();skeleton(h);
    try{
      rows=await fetchRows();selected=rows[0]||null;visible=rows;
      sync({rows,visible,selectedSku:selected?.sku_id||null,computedAt,status:'ready'});
      renderShell(h);h.dataset.scoutV5='promoted';
      document.dispatchEvent(new CustomEvent('collectish:scout-v5-ready',{detail:{count:rows.length,computedAt}}));
    }catch(e){sync({status:'error',error:String(e.message||e)});h.innerHTML=`<div class="cx-empty">${esc(e.message||e)}</div>`}
    finally{loading=false}
  }
  function install(){
    const h=document.getElementById('cxScout');if(!h)return false;
    if(!installed){installed=true;document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMobile()})}
    load();return true;
  }

  const style=document.createElement('style');style.textContent=`
  .cx-v5-title{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.cx-v5-grade{display:flex;align-items:center;gap:8px}.cx-v5-grade>strong{font-size:24px}.cx-v5-grade small{font-size:11px;color:var(--cx-muted)}.cx-v5-badges,.cx-v5-mini-badges{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}.cx-v5-badge{font-size:9px;font-weight:900;letter-spacing:.04em;border-radius:999px;padding:4px 7px;background:#edf1f6;color:var(--cx-muted)}.cx-v5-badge.backed{background:#e8f7ee;color:#16713a}.cx-v5-badge.direct{background:#16713a;color:#fff}.cx-v5-badge.near{background:#e6f1ff;color:#135a9c}.cx-v5-badge.verify{background:#fff3df;color:#8a4c00}.cx-v5-components{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}.cx-v5-component{border:1px solid var(--cx-line);border-radius:11px;padding:9px;background:var(--cx-bg)}.cx-v5-component span,.cx-v5-component em{display:block;font-size:10px;color:var(--cx-muted);font-style:normal}.cx-v5-component strong{display:block;font-size:19px}.cx-v5-component strong small{font-size:10px;color:var(--cx-muted)}.cx-v5-component progress{width:100%;height:6px}.cx-v5-section{margin-top:14px;padding-top:12px;border-top:1px solid var(--cx-line)}.cx-v5-callout{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:8px;padding:10px;border-radius:12px;background:#eef7f1;border:1px solid #c6e4d0}.cx-v5-callout span,.cx-v5-grid span{display:block;font-size:10px;color:var(--cx-muted)}.cx-v5-callout strong,.cx-v5-grid strong{display:block;margin-top:2px}.cx-v5-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:8px}.cx-v5-stat{border:1px solid var(--cx-line);border-radius:10px;padding:8px;background:var(--cx-bg)}.cx-v5-stat small{display:block;color:var(--cx-muted);font-size:9px;margin-top:2px}.cx-v5-details{margin-top:12px;border-top:1px solid var(--cx-line);padding-top:10px}.cx-v5-details summary{cursor:pointer;font-weight:800}.cx-v5-links{display:flex;gap:7px;flex-wrap:wrap;margin-top:14px}.cx-v5-links a{font-size:11px;font-weight:800;text-decoration:none;color:var(--cx-accent)}
  @media(max-width:520px){.cx-v5-components,.cx-v5-grid,.cx-v5-callout{grid-template-columns:1fr 1fr}.cx-v5-title{align-items:flex-start}}
  `;document.head.appendChild(style);

  if(!install())throw new Error('Scout renderer mounted without Scout host');
  window.CollectishScoutRenderer={load,renderDetail,renderCards};
})();