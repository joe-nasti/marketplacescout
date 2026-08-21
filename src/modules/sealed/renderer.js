import store from '../../state/store.js';
import { loadResource } from '../../state/resources.js';
import { rest } from '../../core/rest.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
const pct=n=>n==null||!Number.isFinite(Number(n))?'—':`${Number(n).toFixed(1)}%`;
const human=s=>String(s||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
const age=d=>{if(!d)return'—';const ms=Math.max(0,Date.now()-new Date(d).getTime()),m=Math.round(ms/6e4);if(m<60)return m<=1?'just now':`${m}m ago`;const h=Math.round(m/60);return h<24?`${h}h ago`:`${Math.round(h/24)}d ago`};
const slug=s=>String(s||'').normalize('NFKD').replace(/[’']/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase();
const score=r=>r?.scout_sealed_score==null?null:Number(r.scout_sealed_score);
const grade=r=>r?.scout_sealed_grade||'—';
const acquisition=r=>r?.sealed_acquisition_price==null?null:Number(r.sealed_acquisition_price);
const marketSpread=r=>r?.market_spread==null?null:Number(r.market_spread);
const buylistBacked=r=>{const buy=Number(r?.cardkingdom_buylist_ev),acq=acquisition(r);return Number.isFinite(buy)&&buy>0&&Number.isFinite(acq)&&acq>0&&buy>acq};
const xval=(r,k)=>Number(r?.quantity||0)*Number(r?.[k]||0);
const setMap=()=>new Map(Object.entries(store.get().sealed?.setTypes||{}));
let detailSeq=0;

function languageMeta(r){const s=r?.score_components||{};return{lang:s.sealed_language||'English',mode:s.language_pricing_mode||'',exact:Number(s.exact_language_coverage_pct||0),fallback:Number(s.english_fallback_coverage_pct||0),penalty:Number(s.language_confidence_penalty||0),raw:s.language_raw_score==null?null:Number(s.language_raw_score)}}
function languageClass(r){const m=languageMeta(r);if(m.mode==='english_equivalent_fallback'||m.fallback>0)return'fallback';if(m.lang.toLowerCase()!=='english'&&m.exact>0)return'nonenglish_exact';return'english_exact'}
function languageBadge(r){const m=languageMeta(r);if(m.lang==='English')return'';const short=m.lang==='Japanese'?'JP':m.lang.slice(0,2).toUpperCase();return `<span class="cx-sealed-badge cx-sealed-lang-badge risk">${short} · ${m.fallback>0?'fallback':'exact'}</span>`}
function languageNote(r){const m=languageMeta(r);if(m.lang==='English')return'';return `<div class="cx-sealed-language-note"><strong>${esc(m.lang)} sealed product</strong><span>${m.fallback>0?`Component EV uses English-equivalent pricing where exact ${esc(m.lang)} pricing is unavailable.`:`Component EV uses exact ${esc(m.lang)} pricing where available.`}</span><small>Exact ${esc(m.lang)} coverage ${m.exact.toFixed(0)}% · English fallback ${m.fallback.toFixed(0)}%${m.penalty?` · confidence −${m.penalty.toFixed(0)} pts`:''}${m.raw!=null?` · raw score ${m.raw.toFixed(1)}`:''}</small></div>`}
function badges(r){const out=[];if(r.lifecycle_status==='scout_sealed')out.push('<span class="cx-sealed-badge direct">SCOUT READY</span>');if(buylistBacked(r))out.push('<span class="cx-sealed-badge buylist">BUYLIST BACKED</span>');if(r.blocker)out.push(`<span class="cx-sealed-badge risk">${esc(human(r.blocker))}</span>`);else if(r.lifecycle_status==='ev_ready')out.push('<span class="cx-sealed-badge syp">EV READY</span>');out.push(languageBadge(r));return out.join('')}
function metric(label,value,sub='',cls=''){return `<div class="cx-sealed-metric ${cls}"><span>${esc(label)}</span><b>${value}</b>${sub?`<small>${esc(sub)}</small>`:''}</div>`}
function stat(label,value,sub='',url=''){const body=`<span>${esc(label)}</span><strong>${value}</strong>${sub?`<small>${esc(sub)}</small>`:''}`;return `<div class="cx-sealed-stat">${url?`<a class="cx-source-anchor" href="${esc(url)}" target="_blank" rel="noopener">${body}</a>`:body}</div>`}
function sortRows(a,b){const as=score(a),bs=score(b);if(as!=null&&bs!=null)return bs-as;if(as!=null)return-1;if(bs!=null)return 1;return Number(b.tcg_market_ev||0)-Number(a.tcg_market_ev||0)}
function selectedRow(){const s=store.get().sealed||{};return (s.rows||[]).find(r=>String(r.sealed_uuid)===String(s.selectedId))||null}

async function loadIndex(force=false){
  const [rows,catalog]=await Promise.all([
    loadResource('sealed.rows',()=>rest('sealed_ev_current?select=*&order=scout_sealed_score.desc.nullslast,release_date.desc,product_name.asc&limit=5000'),{force,ttl:60000}),
    loadResource('sealed.setTypes',()=>rest('magic_set_catalog?select=code,set_type&digital=eq.false'),{force,ttl:15*60*1000})
  ]);
  const types=Object.fromEntries((catalog||[]).map(x=>[String(x.code||'').toUpperCase(),x.set_type]));
  const current=store.get().sealed||{};
  const sorted=(rows||[]).slice().sort(sortRows);
  store.update('sealed',{rows:sorted,setTypes:types,selectedId:current.selectedId||sorted[0]?.sealed_uuid||null,loadedAt:Date.now()});
  return sorted;
}

function filteredRows(){
  const s=store.get().sealed||{},f=s.filters||{},types=setMap();
  return (s.rows||[]).filter(r=>{
    const st=types.get(String(r.set_code||'').toUpperCase())||'',hay=`${r.product_name||''} ${r.set_code||''} ${r.category||''} ${r.subtype||''} ${st}`.toLowerCase();
    if(f.query&&!hay.includes(String(f.query).toLowerCase()))return false;
    if(f.setType&&st!==f.setType)return false;
    if(f.buylistBacked&&!buylistBacked(r))return false;
    if(f.status==='graded'&&score(r)==null)return false;
    if(f.status==='scout'&&r.lifecycle_status!=='scout_sealed')return false;
    if(f.status==='evready'&&!['ev_ready','scout_sealed'].includes(r.lifecycle_status))return false;
    if(f.status==='blocked'&&!r.blocker)return false;
    const cls=languageClass(r),lang=f.language||'all';
    if(lang==='exclude_fallback'&&cls==='fallback')return false;
    if(['english_exact','nonenglish_exact','fallback'].includes(lang)&&cls!==lang)return false;
    return true;
  }).sort(sortRows);
}

function renderShell(){
  const h=document.getElementById('cxSealed');if(!h)return;
  const s=store.get().sealed||{},rows=s.rows||[],f=s.filters||{},types=[...new Set(rows.map(r=>s.setTypes?.[String(r.set_code||'').toUpperCase()]).filter(Boolean))].sort();
  const assessed=rows.length,graded=rows.filter(r=>score(r)!=null).length,sets=new Set(rows.map(r=>r.set_code).filter(Boolean)).size,last=rows.reduce((m,r)=>!m||new Date(r.refreshed_at)>new Date(m)?r.refreshed_at:m,null);
  h.innerHTML=`<div class="cx-page-head"><div><h2>Scout Sealed</h2><p>Generalized sealed opportunities across enabled sets.</p><small class="cx-sub">${assessed} assessed · ${graded} graded · ${sets} enabled sets · refreshed ${esc(age(last))}</small></div><button class="cx-refresh" id="cxSealedRefresh">Refresh</button></div><div class="cx-sealed-toolbar cx-sealed-toolbar-compact"><input id="cxSealedSearch" value="${esc(f.query||'')}" placeholder="Search sealed products…"><select id="cxSealedFilter" class="cx-sealed-filter-internal"><option value="">All assessed products</option><option value="graded">Graded only</option><option value="scout">Scout Sealed only</option><option value="evready">EV ready</option><option value="blocked">Blocked / pending</option></select><div class="cx-sealed-chip-bar"><select id="cxSealedSetType" class="cx-sealed-filter-chip"><option value="">All Types</option>${types.map(x=>`<option value="${esc(x)}">${esc(human(x))}</option>`).join('')}</select><select id="cxSealedLanguagePricing" class="cx-sealed-filter-chip"><option value="all">Language</option><option value="exclude_fallback">Exclude fallback pricing</option><option value="english_exact">English / exact-default only</option><option value="nonenglish_exact">Non-English exact-language only</option><option value="fallback">English fallback only</option></select><button type="button" id="cxSealedBuylistBacked" class="cx-sealed-filter-toggle ${f.buylistBacked?'active':''}" aria-pressed="${f.buylistBacked?'true':'false'}"><span aria-hidden="true">⚡</span><span>Buylist Backed</span></button></div><small id="cxSealedLanguageFilterCount" class="cx-sealed-filter-internal"></small></div><div class="cx-sealed-layout"><section><div id="cxSealedRows" class="cx-sealed-list"></div></section><aside id="cxSealedDetail" class="cx-card cx-sealed-detail"></aside></div>`;
  h.querySelector('#cxSealedFilter').value=f.status||'';h.querySelector('#cxSealedSetType').value=f.setType||'';h.querySelector('#cxSealedLanguagePricing').value=f.language||'all';
  h.querySelector('#cxSealedSearch').addEventListener('input',e=>updateFilters({query:e.target.value}));
  h.querySelector('#cxSealedFilter').addEventListener('change',e=>updateFilters({status:e.target.value}));
  h.querySelector('#cxSealedSetType').addEventListener('change',e=>updateFilters({setType:e.target.value}));
  h.querySelector('#cxSealedLanguagePricing').addEventListener('change',e=>updateFilters({language:e.target.value}));
  h.querySelector('#cxSealedBuylistBacked').addEventListener('click',()=>updateFilters({buylistBacked:!Boolean(store.get().sealed?.filters?.buylistBacked)}));
  h.querySelector('#cxSealedRefresh').addEventListener('click',()=>load(true));
  h.querySelector('#cxSealedRows').addEventListener('click',e=>{const b=e.target.closest('[data-deck]');if(b)selectProduct(b.dataset.deck)});
  renderRows();
}

function updateFilters(patch){
  const s=store.get().sealed||{},filters={...(s.filters||{}),...patch};store.update('sealed',{filters});
  const buylist=document.getElementById('cxSealedBuylistBacked');if(buylist){buylist.setAttribute('aria-pressed',filters.buylistBacked?'true':'false');buylist.classList.toggle('active',Boolean(filters.buylistBacked))}
  renderRows();
}
function selectProduct(id){store.update('sealed',{selectedId:id});renderRows();renderDetail(selectedRow()).catch(()=>{})}

function renderRows(){
  const h=document.getElementById('cxSealedRows');if(!h)return;
  const visible=filteredRows(),s=store.get().sealed||{},types=setMap();
  if(!visible.some(r=>String(r.sealed_uuid)===String(s.selectedId)))store.update('sealed',{selectedId:visible[0]?.sealed_uuid||null});
  const selected=String(store.get().sealed?.selectedId||'');
  const count=document.getElementById('cxSealedLanguageFilterCount');if(count){const hidden=(s.rows||[]).length-visible.length;count.textContent=(s.filters?.language||'all')==='all'?'':`${visible.length} shown · ${hidden} hidden`}
  if(!visible.length){h.innerHTML='<div class="cx-empty">No sealed products match these filters.</div>';renderDetail(null);return}
  h.innerHTML=visible.map(r=>{const a=acquisition(r),sc=score(r),type=types.get(String(r.set_code||'').toUpperCase());return `<button type="button" class="cx-sealed-row ${String(r.sealed_uuid)===selected?'selected':''}" data-deck="${esc(r.sealed_uuid)}"><div class="cx-sealed-name"><strong>${esc(r.product_name)}</strong><small>${esc(r.set_code||'')} · ${esc(type?human(type):human(r.subtype||r.category||''))} · ${esc(r.release_date||'')}</small><div class="cx-sealed-badges">${sc==null?'':`<span class="cx-sealed-badge direct">${esc(grade(r))} · ${sc.toFixed(1)}</span>`}${badges(r)}</div></div>${metric('Sealed buy',money(a),human(r.lifecycle_status))}${metric('Market EV',money(r.tcg_market_ev),`${pct(r.market_coverage_pct)} coverage`)}${metric('CK buylist',money(r.cardkingdom_buylist_ev),'cash floor','cx-sealed-hide-mobile')}${metric('Market spread',marketSpread(r)==null?'—':money(marketSpread(r)),r.market_roi_pct==null?'':`${Number(r.market_roi_pct)>=0?'+':''}${Number(r.market_roi_pct).toFixed(1)}%`,marketSpread(r)==null?'cx-sealed-pending':marketSpread(r)>=0?'cx-sealed-positive':'cx-sealed-negative')}</button>`}).join('');
  renderDetail(selectedRow()).catch(()=>{});
  document.dispatchEvent(new CustomEvent('collectish:sealed-rendered',{detail:{visible:visible.length,selectedId:selected}}));
}

function sourceUrls(c){const n=slug(c?.card_name),set=String(c?.set_code||'').toLowerCase(),cn=encodeURIComponent(c?.collector_number||'');return{tcg:c?.product_id?`https://www.tcgplayer.com/product/${encodeURIComponent(c.product_id)}?Printing=${String(c.finish||'').toLowerCase()==='foil'?'Foil':'Normal'}&Condition=Near+Mint&Language=English&page=1`:'',direct:c?.product_id?`https://www.tcgplayer.com/product/${encodeURIComponent(c.product_id)}?Printing=${String(c.finish||'').toLowerCase()==='foil'?'Foil':'Normal'}&Condition=Near+Mint&Language=English&direct=true&page=1`:'',scry:set&&cn?`https://scryfall.com/card/${encodeURIComponent(set)}/${cn}`:'',ck:c?.card_name?`https://www.cardkingdom.com/catalog/search?search=header&filter%5Bname%5D=${encodeURIComponent(c.card_name)}&filter%5Btab%5D=mtg_card`:'',ckBuy:c?.card_name?`https://www.cardkingdom.com/purchasing/mtg_singles?search=header&filter%5Bname%5D=${encodeURIComponent(c.card_name)}`:'',mana:n?(set&&cn?`https://manapool.com/card/${encodeURIComponent(set)}/${cn}/${n}`:`https://manapool.com/card/${n}`):'',mkm:c?.card_name?`https://www.cardmarket.com/en/Magic/Cards/${n}`:''}}
function anchor(value,url){return url&&value!=='—'?`<a class="cx-source-anchor" href="${esc(url)}" target="_blank" rel="noopener">${value}</a>`:value}
function totals(cards){const ks=['tcg_low','tcg_low_with_shipping','tcg_market','cardkingdom_retail','manapool_retail','cardmarket_retail','cardkingdom_buylist','tcg_direct_net'];return Object.fromEntries(ks.map(k=>[k,cards.reduce((n,c)=>n+xval(c,k),0)]))}
function bestClasses(c){const retail=[c.tcg_low,c.tcg_low_with_shipping,c.cardkingdom_retail,c.manapool_retail,c.cardmarket_retail].map(Number).filter(x=>x>0),exit=[c.cardkingdom_buylist,c.tcg_direct_net].map(Number).filter(x=>x>0);return{retail:retail.length?Math.min(...retail):null,exit:exit.length?Math.max(...exit):null}}
function cell(value,url,cls=''){return `<td class="${cls}">${anchor(money(value),url)}</td>`}
function econTable(cards){
  if(!cards.length)return'<div class="cx-empty">No deterministic card components for this product.</div>';
  const t=totals(cards);
  return `<div class="cx-econ-legend"><span class="retail">RETAIL / ACQUIRE</span><span class="reference">TCGM = MARKET REF</span><span class="exit">EXIT / SELL</span></div><div class="cx-sealed-econ-wrap" data-no-detail-swipe><table class="cx-sealed-econ"><thead><tr><th class="sticky-name">Card</th><th>Qty</th><th>Finish</th><th>TCGL</th><th>L+S</th><th>TCGM</th><th>CKR</th><th>MP</th><th>MKM</th><th>CKBL</th><th>TCGD</th></tr></thead><tbody>${cards.map(c=>{const u=sourceUrls(c),b=bestClasses(c),rc=v=>Number(v)>0&&Math.abs(Number(v)-b.retail)<.005?'cx-econ-best-retail':'',xc=v=>Number(v)>0&&Math.abs(Number(v)-b.exit)<.005?'exit cx-econ-best-exit':'exit';return `<tr><td class="sticky-name">${anchor(`<strong>${esc(c.card_name)}</strong><small>${esc(c.set_code||'')} #${esc(c.collector_number||'—')}<span class="cx-econ-mobile-meta"> · ×${Number(c.quantity||0).toLocaleString()} · ${esc(human(c.finish||''))}</span></small>`,u.scry)}</td><td>${Number(c.quantity||0).toLocaleString()}</td><td>${esc(human(c.finish||''))}</td>${cell(c.tcg_low,u.tcg,rc(c.tcg_low))}${cell(c.tcg_low_with_shipping,u.tcg,rc(c.tcg_low_with_shipping))}${cell(c.tcg_market,u.tcg)}${cell(c.cardkingdom_retail,u.ck,rc(c.cardkingdom_retail))}${cell(c.manapool_retail,u.mana,rc(c.manapool_retail))}${cell(c.cardmarket_retail,u.mkm,rc(c.cardmarket_retail))}${cell(c.cardkingdom_buylist,u.ckBuy,xc(c.cardkingdom_buylist))}${cell(c.tcg_direct_net,u.direct,xc(c.tcg_direct_net))}</tr>`}).join('')}</tbody><tfoot><tr><th class="sticky-name">Totals</th><th></th><th></th><th>${money(t.tcg_low)}</th><th>${money(t.tcg_low_with_shipping)}</th><th>${money(t.tcg_market)}</th><th>${money(t.cardkingdom_retail)}</th><th>${money(t.manapool_retail)}</th><th>${money(t.cardmarket_retail)}</th><th class="exit">${money(t.cardkingdom_buylist)}</th><th class="exit">${money(t.tcg_direct_net)}</th></tr></tfoot></table></div><div class="cx-sealed-econ-note">Prices are per card; totals multiply each price by quantity. TCGD is modeled Direct net from exact-SKU Direct Low × 80%.</div>`}

async function loadDetailData(r){
  return loadResource(`sealed.detail:${r.sealed_uuid}`,async()=>{
    const [cards,price,contents]=await Promise.all([
      rest('rpc/get_sealed_component_economics',{method:'POST',body:{p_sealed_uuid:r.sealed_uuid}}).catch(()=>[]),
      rest(`sealed_product_price_current?select=product_id,market_price,low_price,low_with_shipping,total_listings,captured_at&source=eq.tcgplayer_public&sealed_uuid=eq.${encodeURIComponent(r.sealed_uuid)}&limit=1`).catch(()=>[]),
      rest(`mtgjson_sealed_products?select=source_updated_at&uuid=eq.${encodeURIComponent(r.sealed_uuid)}&limit=1`).catch(()=>[])
    ]);
    return{cards:cards||[],price:(price||[])[0]||null,contents:(contents||[])[0]||null};
  },{ttl:5*60*1000});
}

async function renderDetail(r){
  const h=document.getElementById('cxSealedDetail');if(!h)return;const seq=++detailSeq;
  if(!r){h.innerHTML='<div class="cx-empty">Select a sealed product.</div>';return}
  h.innerHTML=`<div class="cx-sealed-detail-skeleton" aria-hidden="true"><div class="cx-skeleton-line wide"></div><div class="cx-skeleton-line"></div><div class="cx-skeleton-grid">${'<span></span>'.repeat(4)}</div><div class="cx-skeleton-table"></div></div>`;
  try{
    const d=await loadDetailData(r);if(seq!==detailSeq)return;
    const s=store.get().sealed||{},type=s.setTypes?.[String(r.set_code||'').toUpperCase()],sc=score(r),a=acquisition(r),sealedUrl=d.price?.product_id?`https://www.tcgplayer.com/product/${encodeURIComponent(d.price.product_id)}?page=1`:'';
    const priceDates=[d.price?.captured_at,...d.cards.flatMap(c=>[c.direct_observed_at,c.vendor_observed_on?`${c.vendor_observed_on}T12:00:00Z`:null])].filter(Boolean).map(x=>new Date(x).getTime()).filter(Number.isFinite),pricesAt=priceDates.length?new Date(Math.max(...priceDates)).toISOString():null;
    h.innerHTML=`<h3>${sealedUrl?`<a class="cx-source-anchor" href="${esc(sealedUrl)}" target="_blank" rel="noopener">${esc(r.product_name)}</a>`:esc(r.product_name)}</h3><span class="cx-sub">${esc(r.set_code||'')} · ${esc(type?human(type):human(r.subtype||r.category||''))} · ${esc(r.release_date||'')}</span><div class="cx-sealed-badges">${sc==null?'':`<span class="cx-sealed-badge direct">Scout ${esc(grade(r))} · ${sc.toFixed(1)}/100</span>`}${badges(r)}</div>${languageNote(r)}<div class="cx-sealed-freshness"><span><b>Prices synced</b> ${age(pricesAt)}</span><span><b>Contents synced</b> ${age(d.contents?.source_updated_at)}</span></div><div class="cx-sealed-grid">${stat('Sealed acquisition',money(a),d.price?.captured_at?`TCG observed ${age(d.price.captured_at)}`:'current pipeline value',sealedUrl)}${stat('TCG Market EV',money(r.tcg_market_ev),`${pct(r.market_coverage_pct)} coverage`)}${stat('CK buylist floor',money(r.cardkingdom_buylist_ev),r.buylist_roi_pct==null?'':`${Number(r.buylist_roi_pct)>=0?'+':''}${Number(r.buylist_roi_pct).toFixed(1)}% ROI`)}${stat('Market spread',marketSpread(r)==null?'—':money(marketSpread(r)),r.market_roi_pct==null?'':`${Number(r.market_roi_pct)>=0?'+':''}${Number(r.market_roi_pct).toFixed(1)}% ROI`)}</div>${r.blocker?`<div class="cx-sealed-summary"><strong>Current blocker:</strong> ${esc(human(r.blocker))}.</div>`:''}<div class="cx-section-title cx-sealed-econ-title">Component economics</div>${econTable(d.cards)}`;
    store.update('sealed',{detail:{id:r.sealed_uuid,cards:d.cards,price:d.price,contents:d.contents}});
    document.dispatchEvent(new CustomEvent('collectish:sealed-detail-rendered',{detail:{id:r.sealed_uuid,row:r,data:d}}));
  }catch(error){if(seq===detailSeq)h.innerHTML=`<div class="cx-empty">${esc(error.message||error)}</div>`}
}

export async function load(force=false){
  const h=document.getElementById('cxSealed');if(!h)return;
  h.innerHTML='<div class="cx-page-head"><div><h2>Scout Sealed</h2><p>Loading sealed model…</p></div></div><div class="cx-sealed-page-skeleton" aria-hidden="true"><div class="cx-skeleton-toolbar"></div><div class="cx-skeleton-layout"><div class="cx-skeleton-list">'+Array.from({length:6},()=>'<div class="cx-skeleton-card"><span class="cx-skeleton-art"></span><span class="cx-skeleton-copy"></span></div>').join('')+'</div><div class="cx-skeleton-table"></div></div></div>';
  try{await loadIndex(force);renderShell()}
  catch(error){h.innerHTML=`<div class="cx-page-head"><div><h2>Scout Sealed</h2><p>Could not load the sealed model.</p></div><button class="cx-refresh" id="cxSealedRetry">Retry</button></div><div class="cx-card"><div class="cx-empty">${esc(error.message||error)}</div></div>`;h.querySelector('#cxSealedRetry')?.addEventListener('click',()=>load(true))}
}

let installed=false;
export async function install(){
  if(installed)return;
  installed=true;
  await load(false);
}

window.CollectishSealed={install,load,select:selectProduct,render:renderRows};
