import { rest } from '../../core/rest.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
const pct=n=>n==null||!Number.isFinite(Number(n))?'—':`${Number(n).toFixed(1)}%`;
const age=d=>{if(!d)return'—';const ms=Math.max(0,Date.now()-new Date(d).getTime()),m=Math.round(ms/6e4);if(m<60)return m<=1?'just now':`${m}m ago`;const h=Math.round(m/60);return h<24?`${h}h ago`:`${Math.round(h/24)}d ago`};
const stat=(label,value,sub='')=>`<div class="cx-sealed-stat"><span>${esc(label)}</span><strong>${value}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`;
let seq=0;

function spreadPct(reference,buy){
  const r=Number(reference),b=Number(buy);
  return Number.isFinite(r)&&Number.isFinite(b)&&r>0&&b>0?(r/b-1)*100:null;
}

async function renderCardTrader(event){
  const id=event?.detail?.id;if(!id)return;const current=++seq;
  const rows=await rest(`sealed_product_price_current?select=product_id,low_price,total_listings,captured_at,raw_json&source=eq.cardtrader&sealed_uuid=eq.${encodeURIComponent(id)}&limit=1`).catch(()=>[]);
  if(current!==seq)return;
  const host=document.getElementById('cxSealedDetail');if(!host)return;
  host.querySelector('[data-cardtrader-acquire]')?.remove();
  const row=(rows||[])[0];if(!row)return;
  const raw=row.raw_json||{},ct=raw.ct||{},zero=raw.ct_zero||{},currency=raw.currency||'USD';
  const tcgMarket=event?.detail?.data?.price?.market_price,tcgLow=event?.detail?.data?.price?.low_with_shipping??event?.detail?.data?.price?.low_price;
  const zeroSpreadMarket=spreadPct(tcgMarket,zero.low),zeroSpreadLow=spreadPct(tcgLow,zero.low);
  const identity=raw.match_method?String(raw.match_method).replaceAll('_',' '):'exact map';
  const currencyOk=currency==='USD';
  const block=document.createElement('div');block.dataset.cardtraderAcquire='';
  block.innerHTML=`<div class="cx-section-title">CardTrader acquisition</div><div class="cx-sealed-grid">${stat('CT Low',currencyOk?money(ct.low):'—',`${Number(ct.quantity||0).toLocaleString()} units · ${Number(ct.offers||0)} offers`)}${stat('CT Zero Low',currencyOk?money(zero.low):'—',`${Number(zero.quantity||0).toLocaleString()} Zero units`)}${stat('CT0 ×6 avg',currencyOk?money(zero.cost_6_avg):'—',zero.cost_6_avg==null?'fewer than 6 units available':'weighted acquisition')}${stat('CT0 vs TCG',currencyOk&&zero.low!=null?(zeroSpreadMarket!=null?`+${pct(zeroSpreadMarket)}`:'—'):'—',zeroSpreadLow!=null?`vs TCG low +${pct(zeroSpreadLow)}`:'raw acquisition spread')}</div><div class="cx-sealed-summary"><strong>CardTrader Zero:</strong> ${currencyOk?'Raw marketplace acquisition before Zero fees, hub shipping, and any landed-cost assumptions.':'Currency mismatch; price comparison suppressed.'} <span class="cx-sub">Mapped ${esc(identity)} · CT synced ${esc(age(row.captured_at))}.</span></div>`;
  const anchor=host.querySelector('.cx-sealed-econ-title');
  if(anchor)anchor.before(block);else host.appendChild(block);
}

document.addEventListener('collectish:sealed-detail-rendered',event=>{renderCardTrader(event).catch(()=>{})});
