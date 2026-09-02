const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
const human=s=>String(s||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
const hasPrice=v=>v!=null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>0;

function stat(label,value){return `<div class="cx-sealed-mobile-econ-stat"><span>${esc(label)}</span><strong>${money(value)}</strong></div>`}
function statIf(label,value){return hasPrice(value)?stat(label,value):''}
function bestExit(c){
  const routes=[
    {label:'CK Buylist',value:c.cardkingdom_buylist},
    {label:'Direct net',value:c.tcg_direct_net},
    {label:'Market',value:c.tcg_market}
  ].filter(x=>hasPrice(x.value)).sort((a,b)=>Number(b.value)-Number(a.value));
  return routes[0]||null;
}
function directMissing(c){return hasPrice(c.tcg_direct_net)?'':'<span class="cx-sealed-mobile-econ-missing">No Direct listing</span>'}
function scoutUrl(c){const u=new URL(location.href);for(const k of ['sealed','sealedView','q','status','settype','set','lang','buylist_backed'])u.searchParams.delete(k);u.searchParams.set('tab','scout');if(c?.sku_id)u.searchParams.set('sku',c.sku_id);else{u.searchParams.set('card',c?.card_name||'');u.searchParams.set('set',c?.set_code||'');u.searchParams.set('finish',c?.finish||'')}return `${u.pathname}?${u.searchParams.toString()}${u.hash}`}

function accordion(cards){
  if(!cards?.length)return '';
  return `<div class="cx-sealed-mobile-econ" data-no-detail-swipe><div class="cx-econ-legend"><span class="retail">RETAIL / ACQUIRE</span><span class="reference">TCGM = MARKET REF</span><span class="exit">EXIT / SELL</span></div>${cards.map(c=>{
    const qty=Number(c.quantity||0),route=bestExit(c);
    const primary=route?`<span class="cx-sealed-mobile-econ-route"><small>${esc(route.label)}</small><b>${money(route.value)}</b></span>`:'<span class="cx-sealed-mobile-econ-route muted"><small>Exit</small><b>Unconfirmed</b></span>';
    const tiles=[
      statIf('TCG Low',c.tcg_low),
      statIf('Low + ship',c.tcg_low_with_shipping),
      statIf('TCG Market',c.tcg_market),
      statIf('CK retail',c.cardkingdom_retail),
      statIf('Mana Pool',c.manapool_retail),
      statIf('Cardmarket',c.cardmarket_retail),
      statIf('CK buylist',c.cardkingdom_buylist),
      statIf('TCG Direct net',c.tcg_direct_net)
    ].filter(Boolean).join('');
    return `<details class="cx-sealed-mobile-econ-row"><summary><a class="cx-sealed-mobile-card-link" href="${esc(scoutUrl(c))}"><strong>${esc(c.card_name||'Unknown card')}</strong><small>${esc(c.set_code||'')} #${esc(c.collector_number||'—')} · ×${qty.toLocaleString()} · ${esc(human(c.finish||''))}</small></a><div class="cx-sealed-mobile-econ-primary">${primary}</div></summary><div class="cx-sealed-mobile-econ-grid">${tiles}${directMissing(c)}</div></details>`;
  }).join('')}</div>`;
}

function renderFromEvent(event){
  const host=document.getElementById('cxSealedDetail');
  const wrap=host?.querySelector('.cx-sealed-econ-wrap');
  if(!host||!wrap)return;
  host.querySelector('.cx-sealed-mobile-econ')?.remove();
  const html=accordion(event.detail?.data?.cards||[]);
  if(!html)return;
  wrap.insertAdjacentHTML('beforebegin',html);
}

let installed=false;
export function installMobileEconomics(){
  if(installed)return;
  installed=true;
  // The renderer dispatches this synchronously in the same task that writes detail HTML,
  // so the mobile accordion exists before the browser paints; no observer/recovery pass.
  document.addEventListener('collectish:sealed-detail-rendered',renderFromEvent);
}

installMobileEconomics();
