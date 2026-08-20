import store from '../../state/store.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
const num=n=>Number(n||0).toLocaleString();
const spread=r=>{const low=Number(r?.tcg_low||r?.low_with_shipping||0),direct=Number(r?.direct_low||0);return low>0&&direct>0?direct/low:null};
const tier=x=>x==null?'flat':x>=1.5?'high':x>=1.2?'healthy':'flat';
const tierLabel=x=>x==null?'No spread':'high'===tier(x)?`⚡ ${x.toFixed(2)}x Direct Spread`:`${x.toFixed(2)}x Direct Spread`;
const tooltip=x=>x==null?'Direct spread unavailable for this SKU.':x>=1.5?'High Direct premium. This can indicate arbitrage or Direct cart-optimizer squeeze; verify seller depth before buying.':x>=1.2?'Healthy Direct premium. Margin is above marketplace low but not an extreme squeeze.':'Marketplace and Direct pricing are near parity.';
const tcgUrl=r=>r?.product_id?`https://www.tcgplayer.com/product/${encodeURIComponent(r.product_id)}?Printing=${encodeURIComponent(r.printing||'Normal')}&Condition=${encodeURIComponent(r.condition||'Near Mint')}&Language=${encodeURIComponent(r.language||'English')}&page=1`:'';
const directUrl=r=>{const u=tcgUrl(r);return u?`${u}&direct=true`:''};
const scryUrl=r=>r?.scryfall_id?`https://scryfall.com/card/${encodeURIComponent(r.scryfall_id)}`:(r?.set_code&&r?.collector_number?`https://scryfall.com/card/${encodeURIComponent(String(r.set_code).toLowerCase())}/${encodeURIComponent(r.collector_number)}`:'');

let installed=false;
let syncingUrl=false;

function params(){return new URL(location.href).searchParams}
function readFilters(){
  const p=params();
  return {
    min:p.get('min')||'',
    max:p.get('max')||'',
    spread:p.get('spread')||'',
    foil:p.get('foil')||'',
  };
}
function writeUrl(extra={}){
  if(syncingUrl)return;
  const p=params();
  p.set('tab','scout');
  const q=document.getElementById('cxParitySearch')?.value?.trim()||'';
  const grade=document.getElementById('cxParityGrade')?.value||'';
  const set=document.getElementById('cxParitySet')?.value||'';
  const merged={...readFilters(),...extra};
  const setOrDelete=(k,v)=>v?p.set(k,v):p.delete(k);
  setOrDelete('q',q);setOrDelete('grade',grade);setOrDelete('set',set);
  setOrDelete('min',merged.min);setOrDelete('max',merged.max);setOrDelete('spread',merged.spread);setOrDelete('foil',merged.foil);
  history.replaceState({collectish:true},'',`${location.pathname}?${p.toString()}${location.hash}`);
}
function rowsForCompact(){
  const s=store.get().scout||{};
  const base=(s.visible?.length?s.visible:s.rows)||[];
  const f=readFilters(),min=Number(f.min),max=Number(f.max),minSpread=Number(f.spread);
  return base.filter(r=>{
    const price=Number(r.direct_low||r.tcg_low||0),sp=spread(r),printing=String(r.printing||'').toLowerCase();
    if(f.min&&Number.isFinite(min)&&price<min)return false;
    if(f.max&&Number.isFinite(max)&&price>max)return false;
    if(f.spread&&Number.isFinite(minSpread)&&(sp==null||sp<minSpread))return false;
    if(f.foil==='true'&&!printing.includes('foil'))return false;
    if(f.foil==='false'&&printing.includes('foil'))return false;
    return true;
  });
}
function ensureControls(){
  const toolbar=document.querySelector('#cxScout .cx-scout-toolbar');if(!toolbar||toolbar.querySelector('[data-cx-compact-filters]'))return;
  const f=readFilters();
  const wrap=document.createElement('div');wrap.dataset.cxCompactFilters='1';wrap.className='cx-scout-compact-filters';
  wrap.innerHTML=`<input id="cxScoutMin" inputmode="decimal" placeholder="Min $" value="${esc(f.min)}"><input id="cxScoutMax" inputmode="decimal" placeholder="Max $" value="${esc(f.max)}"><input id="cxScoutSpread" inputmode="decimal" placeholder="Min spread" value="${esc(f.spread)}"><select id="cxScoutFoil"><option value="">All finishes</option><option value="false">Nonfoil</option><option value="true">Foil</option></select><button type="button" id="cxScoutShare" class="cx-refresh">Share</button>`;
  toolbar.appendChild(wrap);wrap.querySelector('#cxScoutFoil').value=f.foil||'';
  const update=()=>{writeUrl({min:wrap.querySelector('#cxScoutMin').value.trim(),max:wrap.querySelector('#cxScoutMax').value.trim(),spread:wrap.querySelector('#cxScoutSpread').value.trim(),foil:wrap.querySelector('#cxScoutFoil').value});renderCompact()};
  wrap.querySelectorAll('input').forEach(el=>el.addEventListener('input',update));wrap.querySelector('#cxScoutFoil').addEventListener('change',update);
  wrap.querySelector('#cxScoutShare').addEventListener('click',shareTargets);
}
function hydrateBaseFiltersFromUrl(){
  const p=params(),mapping=[['q','cxParitySearch','input'],['grade','cxParityGrade','change'],['set','cxParitySet','change']];
  syncingUrl=true;
  for(const [param,id,eventName] of mapping){const v=p.get(param);const el=document.getElementById(id);if(v!=null&&el&&el.value!==v){el.value=v;el.dispatchEvent(new Event(eventName,{bubbles:true}))}}
  syncingUrl=false;
}
function image(r){return r?.product_id?`https://tcgplayer-cdn.tcgplayer.com/product/${encodeURIComponent(r.product_id)}_in_1000x1000.jpg`:''}
function renderCompact(){
  const host=document.getElementById('cxParityCards');if(!host||!matchMedia('(max-width:700px)').matches)return;
  const rows=rowsForCompact().slice(0,120),selected=String(store.get().scout?.selectedSku||'');
  if(!rows.length){host.innerHTML='<div class="cx-empty">No opportunities match these filters.</div>';return}
  host.innerHTML=rows.map(r=>{const sp=spread(r),img=image(r);return `<article class="cx-scout-card cx-scout-compact-card ${String(r.sku_id)===selected?'selected':''}" data-sku="${esc(r.sku_id)}"><div class="cx-scout-compact-summary">${img?`<div class="cx-scout-compact-thumb"><img loading="lazy" decoding="async" src="${esc(img)}" alt="${esc(r.product_name)}"></div>`:'<div class="cx-scout-compact-thumb skeleton"></div>'}<div class="cx-scout-compact-main"><strong>${esc(r.product_name)}</strong><small>${esc(r.set_name||'')} · ${esc(r.printing||'')} · ${esc(r.condition||'')}</small><button type="button" class="cx-spread-chip ${tier(sp)}" data-spread-help="${esc(tooltip(sp))}" aria-label="Explain ${esc(tierLabel(sp))}">${esc(tierLabel(sp))}</button><div class="cx-scout-compact-price"><span>Low <b>${money(r.tcg_low)}</b></span><span>Direct <b>${money(r.direct_low)}</b></span></div></div></div><details class="cx-scout-compact-drawer" data-no-detail-swipe><summary>Tap to expand ladder breakdown</summary><div class="cx-scout-compact-ladder"><span>TCG Low <b>${money(r.tcg_low)}</b></span><span>TCG Market <b>${money(r.sku_market_price)}</b></span><span>TCG Direct Low <b>${money(r.direct_low)}</b></span><span>Velocity <b>${Number(r.avg_daily_qty_sold||0).toFixed(1)} sales/day</b></span><span>Direct supply <b>${num(r.direct_available)} copies · ${num(r.direct_listings)} listings</b></span></div><div class="cx-scout-compact-actions"><button type="button" data-copy-sku="${esc(r.sku_id)}">Copy SKU</button>${directUrl(r)?`<button type="button" data-open-url="${esc(directUrl(r))}">Open Direct</button>`:''}${tcgUrl(r)?`<button type="button" data-open-url="${esc(tcgUrl(r))}">TCG listing</button>`:''}${scryUrl(r)?`<button type="button" data-open-url="${esc(scryUrl(r))}">Scryfall</button>`:''}</div></details></article>`}).join('');
}
function openExternal(url){if(!url)return;try{if(window.CollectishAndroid?.openExternal){window.CollectishAndroid.openExternal(url);return}}catch{}window.open(url,'_blank','noopener')}
async function shareTargets(){
  const rows=rowsForCompact().slice(0,30),text=rows.map(r=>`${r.product_name} — ${spread(r)?.toFixed(2)||'—'}x — Direct ${money(r.direct_low)} — Low ${money(r.tcg_low)}`).join('\n');
  const url=location.href;
  try{if(navigator.share){await navigator.share({title:'Collectish Scout targets',text,url});return}}catch(e){if(e?.name==='AbortError')return}
  try{await navigator.clipboard.writeText(`${text}\n\n${url}`);document.dispatchEvent(new CustomEvent('collectish:toast',{detail:{message:'Scout targets copied'}}))}catch{}
}
function clickHandler(e){
  const help=e.target.closest?.('[data-spread-help]');if(help){e.preventDefault();e.stopPropagation();const old=help.querySelector('.cx-spread-tooltip');document.querySelectorAll('.cx-spread-tooltip').forEach(x=>x.remove());if(!old){const tip=document.createElement('span');tip.className='cx-spread-tooltip';tip.textContent=help.dataset.spreadHelp;help.appendChild(tip)}return}
  const copy=e.target.closest?.('[data-copy-sku]');if(copy){e.preventDefault();e.stopPropagation();navigator.clipboard?.writeText(copy.dataset.copySku||'');return}
  const open=e.target.closest?.('[data-open-url]');if(open){e.preventDefault();e.stopPropagation();openExternal(open.dataset.openUrl);return}
}
function install(){
  if(installed)return;installed=true;
  document.addEventListener('collectish:scout-v5-ready',()=>{hydrateBaseFiltersFromUrl();ensureControls();renderCompact()});
  document.addEventListener('collectish:scout-list-rendered',()=>{writeUrl();renderCompact()});
  document.addEventListener('click',clickHandler,true);
  addEventListener('popstate',()=>{if(params().get('tab')==='scout'){hydrateBaseFiltersFromUrl();ensureControls();renderCompact()}});
  addEventListener('resize',renderCompact,{passive:true});
}

install();
window.CollectishScoutCompact={render:renderCompact,share:shareTargets};
