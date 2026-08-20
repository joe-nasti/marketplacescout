const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
const human=s=>String(s||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());

function stat(label,value){return `<div class="cx-sealed-mobile-econ-stat"><span>${esc(label)}</span><strong>${value}</strong></div>`}

function accordion(cards){
  if(!cards?.length)return '';
  return `<div class="cx-sealed-mobile-econ" data-no-detail-swipe><div class="cx-econ-legend"><span class="retail">RETAIL / ACQUIRE</span><span class="reference">TCGM = MARKET REF</span><span class="exit">EXIT / SELL</span></div>${cards.map(c=>{
    const qty=Number(c.quantity||0),market=Number(c.tcg_market||0),componentEv=qty*market;
    return `<details class="cx-sealed-mobile-econ-row"><summary><div><strong>${esc(c.card_name||'Unknown card')}</strong><small>${esc(c.set_code||'')} #${esc(c.collector_number||'—')} · ×${qty.toLocaleString()} · ${esc(human(c.finish||''))}</small></div><div class="cx-sealed-mobile-econ-primary"><span>EV <b>${money(componentEv)}</b></span><span>Direct <b>${money(c.tcg_direct_net)}</b></span></div></summary><div class="cx-sealed-mobile-econ-grid">${stat('TCG Low',money(c.tcg_low))}${stat('Low + ship',money(c.tcg_low_with_shipping))}${stat('TCG Market',money(c.tcg_market))}${stat('CK retail',money(c.cardkingdom_retail))}${stat('Mana Pool',money(c.manapool_retail))}${stat('Cardmarket',money(c.cardmarket_retail))}${stat('CK buylist',money(c.cardkingdom_buylist))}${stat('TCG Direct net',money(c.tcg_direct_net))}</div></details>`;
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
