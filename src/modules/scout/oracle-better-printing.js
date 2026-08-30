import store from '../../state/store.js';
import { rest } from '../../core/rest.js';

let installed=false,seq=0;
const FAMILY_LIMIT=2000;
const CACHE_TTL_MS=60_000;
const familyCache=new Map();

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});

function selectedRow(sku){return (store.get().scout?.rows||[]).find(r=>String(r?.sku_id)===String(sku))||null}
function stateOf(r){
  const raw=String(r?.coverage_state||'').trim().toLowerCase();
  if(raw.includes('catalog')||!r?.last_evaluated_at)return'catalog';
  if(raw.includes('current')||raw.includes('active')||raw.includes('fresh'))return'current';
  if(raw.includes('dormant')||raw.includes('stale'))return'dormant';
  return (Date.now()-new Date(r.last_evaluated_at).getTime())/86400000<=7?'current':'dormant';
}
function directRoi(r){const buy=Number(r?.cheapest_buy||r?.tcg_low||0),profit=Number(r?.direct_net_profit);return buy>0&&Number.isFinite(profit)?profit/buy*100:null}
function label(r){return [String(r?.set_code||r?.set_name||'').toUpperCase(),r?.collector_number?`#${r.collector_number}`:'',r?.printing||r?.finish||''].filter(Boolean).join(' · ')}
function bestBy(rows,valueFn,dir='max'){
  let best=null,bv=null;
  for(const r of rows){const v=valueFn(r);if(v==null||!Number.isFinite(Number(v))||Number(v)===0)continue;if(best==null||(dir==='max'?Number(v)>bv:Number(v)<bv)){best=r;bv=Number(v)}}
  return best?{row:best,value:bv}:null;
}
function materialAlternative(rows,sku){
  const current=rows.find(r=>String(r?.sku_id)===String(sku));
  if(!current||stateOf(current)!=='current')return null;
  const siblings=rows.filter(r=>String(r?.sku_id)!==String(sku)&&stateOf(r)==='current');
  if(!siblings.length)return null;

  const currentDirect=directRoi(current),bestDirect=bestBy(siblings,directRoi);
  if(currentDirect!=null&&bestDirect&&bestDirect.value-currentDirect>=15)return{row:bestDirect.row,metric:'Direct ROI',detail:`+${(bestDirect.value-currentDirect).toFixed(1)} pts Direct ROI`};

  const currentBuy=Number(current.cheapest_buy||current.tcg_low||0),bestBuy=bestBy(siblings,r=>Number(r.cheapest_buy||r.tcg_low||0),'min');
  if(currentBuy>0&&bestBuy&&bestBuy.value>0&&bestBuy.value<=currentBuy*.8){const pct=(1-bestBuy.value/currentBuy)*100;return{row:bestBuy.row,metric:'Buy price',detail:`${pct.toFixed(0)}% lower buy · ${money(bestBuy.value)}`}}

  const currentBuylist=Number(current.buylist_roi_pct||0),bestBuylist=bestBy(siblings,r=>Number(r.buylist_roi_pct||0));
  if(currentBuylist>0&&bestBuylist&&bestBuylist.value-currentBuylist>=15)return{row:bestBuylist.row,metric:'Buylist ROI',detail:`+${(bestBuylist.value-currentBuylist).toFixed(1)} pts buylist ROI`};

  const currentVelocity=Number(current.avg_daily_qty_sold||0),bestVelocity=bestBy(siblings,r=>Number(r.avg_daily_qty_sold||0));
  if(currentVelocity>0&&bestVelocity&&bestVelocity.value>=currentVelocity*1.5&&bestVelocity.value-currentVelocity>=.5)return{row:bestVelocity.row,metric:'Velocity',detail:`+${(bestVelocity.value-currentVelocity).toFixed(1)}/d velocity`};

  const currentScore=Number(current.scout_score??current.last_score),bestScout=bestBy(siblings,r=>Number(r.scout_score??r.last_score));
  if(Number.isFinite(currentScore)&&bestScout&&bestScout.value-currentScore>=8)return{row:bestScout.row,metric:'Scout score',detail:`+${Math.round(bestScout.value-currentScore)} Scout points`};
  return null;
}
async function family(oracle){
  const cached=familyCache.get(oracle);if(cached&&Date.now()-cached.at<CACHE_TTL_MS)return cached.rows;
  const rows=await rest('rpc/scout_catalog_by_oracle',{method:'POST',body:{p_oracle_id:oracle,p_limit:FAMILY_LIMIT}})||[];
  familyCache.set(oracle,{at:Date.now(),rows});return rows;
}
function ensureStyle(){
  if(document.getElementById('cxOracleBetterPrintingStyle'))return;
  const s=document.createElement('style');s.id='cxOracleBetterPrintingStyle';s.textContent=`.cx-oracle-better-printing{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;align-items:center;width:100%;margin-top:8px;padding:8px 9px;border:1px solid rgba(113,213,154,.32);border-radius:10px;background:rgba(113,213,154,.07);color:inherit;text-align:left;cursor:pointer;font:inherit}.cx-oracle-better-printing strong{font-size:11px}.cx-oracle-better-printing span{font-size:10px;color:var(--cx-muted)}.cx-oracle-better-printing b{grid-column:2;grid-row:1/3;color:var(--cx-accent);font-size:15px}.cx-oracle-better-printing:hover strong,.cx-oracle-better-printing:focus-visible strong{text-decoration:underline}.cx-oracle-better-printing:focus-visible{outline:2px solid var(--cx-accent);outline-offset:2px}@media(max-width:520px){.cx-oracle-better-printing{padding:9px}}`;document.head.appendChild(s);
}
async function decorate(sku,token,attempt=0){
  if(token!==seq)return;
  const host=document.getElementById('cxParityDetail');
  if(!host||String(store.get().scout?.selectedSku||'')!==String(sku))return;
  const compare=host.querySelector('.cx-scout-all-printings');
  if(!compare){if(attempt<20)setTimeout(()=>void decorate(sku,token,attempt+1),100);return}
  host.querySelector('.cx-oracle-better-printing')?.remove();
  const oracle=String(compare.dataset.oracleId||'');if(!oracle)return;
  try{
    const rows=await family(oracle);if(token!==seq||!host.isConnected||String(store.get().scout?.selectedSku||'')!==String(sku))return;
    const alt=materialAlternative(rows,sku);if(!alt)return;
    const button=document.createElement('button');button.type='button';button.className='cx-oracle-better-printing';button.dataset.betterSku=String(alt.row.sku_id||'');button.innerHTML=`<strong>Better printing available</strong><span>${esc(alt.detail)} · ${esc(label(alt.row))}</span><b aria-hidden="true">→</b>`;button.title=`Compare all printings — ${alt.metric} currently favors ${label(alt.row)}`;button.addEventListener('click',()=>compare.click());compare.insertAdjacentElement('afterend',button);
  }catch{}
}
function onDetail(e){const sku=e.detail?.sku;if(!sku)return;const token=++seq;setTimeout(()=>void decorate(sku,token),0)}
function invalidateFamily(e){const oracle=e.detail?.oracle;if(oracle)familyCache.delete(String(oracle))}
function hydrate(){const sku=store.get().scout?.selectedSku;if(sku&&document.getElementById('cxParityDetail'))onDetail({detail:{sku}})}

export function installOracleBetterPrinting(){
  if(installed)return;installed=true;ensureStyle();document.addEventListener('collectish:scout-detail-rendered',onDetail);document.addEventListener('collectish:oracle-bulk-refresh-queued',invalidateFamily);document.addEventListener('collectish:oracle-family-refreshed',invalidateFamily);setTimeout(hydrate,0);
}

installOracleBetterPrinting();