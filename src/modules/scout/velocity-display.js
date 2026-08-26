import store from '../../state/store.js';

// Keep Scout velocity presentation faithful to shared TCGplayer sales evidence.
// Unknown is never rendered as zero; coarse upstream daily averages fall back to quarter / 90.
const rows=()=>store.get().scout?.rows||[];
const bySku=()=>new Map(rows().map(r=>[String(r.sku_id),r]));
const finite=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
function components(r){
  const raw=r?.score_components;
  if(raw&&typeof raw==='object')return raw;
  if(typeof raw==='string'){try{return JSON.parse(raw)||{}}catch{}}
  return {};
}
function salesEvidence(r){
  const c=components(r),rawDaily=finite(r?.avg_daily_qty_sold),quarterQty=finite(c.quarter_quantity_sold),rawTx=finite(c.average_daily_transaction_count),quarterTx=finite(c.quarter_transaction_count);
  const explicitKnown=r?.sales_history_known===true||c.sales_history_known===true||['measured','stale'].includes(String(c.sales_history_status||''));
  const known=explicitKnown||rawDaily!==null||quarterQty!==null;
  if(!known)return {known:false,daily:null,txDaily:null,quarterQty:null,quarterTx:null};
  const daily=rawDaily!==null&&rawDaily>0?rawDaily:quarterQty!==null?quarterQty/90:rawDaily;
  const txDaily=rawTx!==null&&rawTx>0?rawTx:quarterTx!==null?quarterTx/90:rawTx;
  return {known:true,daily,txDaily,quarterQty,quarterTx};
}
function label(m){return m.known&&m.daily!==null?`${m.daily.toFixed(1)}/d`:'—'}
function help(m){
  if(!m.known)return 'TCGplayer marketplace sales velocity has not been measured for this exact SKU yet.';
  const bits=[];
  if(m.daily!==null)bits.push(`${m.daily.toFixed(2)} cards/day`);
  if(m.txDaily!==null)bits.push(`${m.txDaily.toFixed(2)} transactions/day`);
  if(m.quarterQty!==null)bits.push(`${Math.round(m.quarterQty)} cards in the quarter`);
  if(m.quarterTx!==null)bits.push(`${Math.round(m.quarterTx)} quarter transactions`);
  return `Measured TCGplayer marketplace sales. ${bits.join(' · ')}. Direct vs non-Direct is not identified.`;
}
function setStrong(strong,m){
  if(!strong)return;
  const marker=strong.querySelector('em');
  strong.textContent=label(m);
  if(marker)strong.append(' ',marker);
  strong.title=help(m);
  strong.dataset.velocityMeasured=m.known?'true':'false';
}
function decorateList(){
  const map=bySku();
  document.querySelectorAll('#cxParityCards .cx-scout-card[data-sku]').forEach(card=>{
    const r=map.get(String(card.dataset.sku));if(!r)return;
    const metric=[...card.querySelectorAll('.cx-scout-card-price')].find(x=>x.querySelector('small')?.textContent?.trim().toUpperCase()==='VELOCITY');
    setStrong(metric?.querySelector('strong'),salesEvidence(r));
  });
}
function decorateDetail(sku){
  if(!sku)return;
  const r=rows().find(x=>String(x.sku_id)===String(sku));if(!r)return;
  const m=salesEvidence(r),detail=document.getElementById('cxParityDetail');if(!detail)return;
  const stat=[...detail.querySelectorAll('.cx-v5-stat')].find(x=>x.querySelector('span')?.textContent?.trim()==='Sales / day');
  const strong=stat?.querySelector('strong');if(strong){strong.textContent=m.known&&m.daily!==null?m.daily.toFixed(1):'—';strong.title=help(m)}
}
document.addEventListener('collectish:scout-list-rendered',()=>queueMicrotask(decorateList));
document.addEventListener('collectish:scout-detail-rendered',e=>queueMicrotask(()=>decorateDetail(e.detail?.sku)));
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='scout')setTimeout(()=>{decorateList();decorateDetail(store.get().scout?.selectedSku)},80)});

export {salesEvidence as scoutSalesEvidence};
