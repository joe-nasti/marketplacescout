import store from '../../state/store.js';
import { rest } from '../../core/rest.js';
import { registerComponent } from '../../core/lifecycle.js';

const detail=()=>document.getElementById('cxParityDetail');
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
const pct=n=>n==null||!Number.isFinite(Number(n))?'—':`${Number(n)>=0?'+':''}${Number(n).toFixed(1)}%`;
const dec=(n,d=3)=>n==null||!Number.isFinite(Number(n))?'—':Number(n).toFixed(d);
let seq=0;

function selectedRow(event){const sku=event?.detail?.sku||store.get().scout?.selectedSku;return event?.detail?.row||(store.get().scout?.rows||[]).find(r=>String(r.sku_id)===String(sku))||null}
function finishOf(row){return String(row?.printing||row?.finish||'').toLowerCase().includes('foil')?'foil':'normal'}
function identityPath(row){
  const parts=[
    `card_name=eq.${encodeURIComponent(row.product_name||row.card_name||'')}`,
    `card_set_code=eq.${encodeURIComponent(row.set_code||'')}`,
    `collector_number=eq.${encodeURIComponent(row.collector_number||'')}`,
    `finish=eq.${encodeURIComponent(finishOf(row))}`
  ];
  return `sealed_single_source_compare_current?select=sealed_uuid,product_name,expected_copies,sealed_market_price,naive_sealed_spend_per_expected_copy,expected_market_contribution,ev_allocated_acquisition_per_copy,direct_buy_price,best_modeled_exit_net,crack_advantage_vs_direct_pct,crack_allocated_profit_per_copy,source_kind,refreshed_at&${parts.join('&')}&order=crack_advantage_vs_direct_pct.desc.nullslast&limit=20`;
}
function liveExit(row){
  const lanes=[
    ['TCG Direct',Number(row?.direct_net_est)],
    ['TCG regular',Number(row?.sku_market_price||0)*0.75],
    ['Card Kingdom',Number(row?.ck_buylist)],
    ['ManaPool',Number(row?.manapool_retail||0)*0.921]
  ].filter(([,v])=>Number.isFinite(v)&&v>0).sort((a,b)=>b[1]-a[1]);
  return lanes[0]||['Unmeasured',null];
}
function style(){if(document.getElementById('cxScoutSealedCompareStyle'))return;const s=document.createElement('style');s.id='cxScoutSealedCompareStyle';s.textContent=`
.cx-sealed-compare{margin:12px 0;padding:12px;border:1px solid var(--cx-border,#2a3440);border-radius:13px;background:var(--cx-surface,#111820)}.cx-sealed-compare-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.cx-sealed-compare-card{padding:9px;border:1px solid var(--cx-border,#2a3440);border-radius:10px}.cx-sealed-compare-card span{display:block;font-size:9px;text-transform:uppercase;opacity:.62}.cx-sealed-compare-card b{display:block;font-size:16px;margin-top:2px}.cx-sealed-compare-card small{display:block;font-size:10px;opacity:.7;margin-top:2px;line-height:1.25}.cx-sealed-compare-card.positive{border-color:#9acdaf;background:#eef7f1}.cx-sealed-source-list{margin-top:9px;display:grid;gap:6px}.cx-sealed-source-row{display:grid;grid-template-columns:minmax(0,1.4fr) repeat(3,minmax(80px,.7fr));gap:8px;padding:8px;border-top:1px solid var(--cx-border,#2a3440);align-items:center;font-size:10px}.cx-sealed-source-row strong{font-size:11px}.cx-sealed-source-row small{display:block;opacity:.65}.cx-sealed-source-row span{text-align:right}.cx-sealed-source-note{font-size:10px;opacity:.68;line-height:1.35;margin-top:8px}@media(max-width:700px){.cx-sealed-compare-grid{grid-template-columns:1fr}.cx-sealed-source-row{grid-template-columns:minmax(0,1fr) 90px}.cx-sealed-source-row span:nth-of-type(2),.cx-sealed-source-row span:nth-of-type(3){display:none}}
`;document.head.appendChild(s)}
function sourceRows(rows,directBuy){return rows.slice().sort((a,b)=>Number(b.crack_advantage_vs_direct_pct??-999)-Number(a.crack_advantage_vs_direct_pct??-999)).slice(0,10).map(r=>{const exp=Number(r.expected_copies||0),per=exp>0?1/exp:null,alloc=Number(r.ev_allocated_acquisition_per_copy),adv=directBuy>0&&alloc>0?100*(directBuy-alloc)/directBuy:null;return `<div class="cx-sealed-source-row"><div><strong>${esc(r.product_name)}</strong><small>${dec(exp,4)} expected copies${per?` · ${dec(per,1)} products / expected copy`:''} · ${money(r.expected_market_contribution)} expected market contribution</small></div><span><small>Allocated cost</small><b>${money(alloc)}</b></span><span><small>Cached exit ref</small><b>${money(r.best_modeled_exit_net)}</b></span><span><small>vs direct</small><b>${pct(adv)}</b></span></div>`}).join('')}

async function decorate(event){const my=++seq,row=selectedRow(event),h=detail();if(!row||!h)return;h.querySelector('.cx-sealed-compare')?.remove();let sources=[];try{sources=await rest(identityPath(row))}catch(e){console.warn('[scout sealed compare]',e);return}if(my!==seq||!sources?.length)return;const directBuy=Number(row.cheapest_buy||row.tcg_low||sources[0]?.direct_buy_price||0);const best=[...sources].filter(x=>Number(x.ev_allocated_acquisition_per_copy)>0).sort((a,b)=>{const aa=directBuy>0?100*(directBuy-Number(a.ev_allocated_acquisition_per_copy))/directBuy:-999,bb=directBuy>0?100*(directBuy-Number(b.ev_allocated_acquisition_per_copy))/directBuy:-999;return bb-aa})[0]||sources[0];const alloc=Number(best.ev_allocated_acquisition_per_copy),adv=directBuy>0&&alloc>0?100*(directBuy-alloc)/directBuy:null,[exitName,exitNet]=liveExit(row),profit=exitNet!=null&&alloc>0?exitNet-alloc:null;
  const box=document.createElement('section');box.className='cx-v5-section cx-sealed-compare';box.innerHTML=`<div class="cx-section-title">Buy direct · Crack sealed · Best exit</div><div class="cx-sealed-compare-grid"><div class="cx-sealed-compare-card"><span>Buy directly</span><b>${money(directBuy)}</b><small>${esc(row.cheapest_source||'best observed exact-printing acquisition')}</small></div><div class="cx-sealed-compare-card ${adv>0?'positive':''}"><span>Best sealed route</span><b>${money(alloc)}</b><small>${esc(best.product_name||'')} · ${pct(adv)} vs direct</small></div><div class="cx-sealed-compare-card"><span>Best live exit</span><b>${money(exitNet)}</b><small>${esc(exitName)}${profit==null?'':` · ${money(profit)} vs allocated crack cost`}</small></div></div><div class="cx-sealed-source-list">${sourceRows(sources,directBuy)}</div><div class="cx-sealed-source-note">Best live exit uses the selected printing’s current Collectish lanes: Direct net, TCG regular net, CK cash and ManaPool net estimate. Allocated crack cost credits the expected value of the other cards opened. Pulls remain probabilistic unless fixed.</div>`;
  const market=[...h.querySelectorAll('.cx-v5-section')].find(x=>String(x.querySelector(':scope > .cx-section-title')?.textContent||'').trim().toLowerCase()==='across the market');if(market)market.insertAdjacentElement('afterend',box);else h.append(box)
}
function schedule(event){requestAnimationFrame(()=>requestAnimationFrame(()=>decorate(event)))}
export function install(){style();document.addEventListener('collectish:scout-detail-rendered',schedule)}
registerComponent('scout-sealed-source-compare',{mount:install,unmount(){document.removeEventListener('collectish:scout-detail-rendered',schedule)}});
