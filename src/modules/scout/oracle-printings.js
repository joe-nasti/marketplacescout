import store from '../../state/store.js';

let installed=false;
const sfCache=new Map();
let compareContext=null;

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const baseName=n=>String(n||'').replace(/\s*\([^)]*(foil|showcase|borderless|extended art|serialized|retro frame|etched|alternate art|halo foil|rainbow foil|surge foil|galaxy foil)[^)]*\)\s*/ig,' ').replace(/\s+/g,' ').trim();
const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
const score=r=>Number(r?.promoted_score??r?.v5_shadow_score??r?.opportunity_score??0);
const grade=r=>r?.promoted_grade||r?.v5_shadow_grade||(score(r)>=80?'A':score(r)>=70?'B':score(r)>=60?'C':score(r)>=50?'D':'F');

function selectedRow(sku){
  const scout=store.get().scout||{};
  return (scout.rows||[]).find(r=>String(r?.sku_id)===String(sku))||null;
}

function familyRows(name){
  const wanted=baseName(name).toLowerCase();
  return (store.get().scout?.rows||[]).filter(r=>baseName(r?.product_name).toLowerCase()===wanted);
}

async function canonicalCard(row){
  if(!row)return null;
  const key=`${row.scryfall_id||''}|${row.set_code||''}|${row.collector_number||''}|${row.product_name||''}`;
  if(sfCache.has(key))return sfCache.get(key);
  const job=(async()=>{
    try{
      if(row.scryfall_id){
        const r=await fetch(`https://api.scryfall.com/cards/${encodeURIComponent(row.scryfall_id)}`);
        if(r.ok)return await r.json();
      }
      if(row.set_code&&row.collector_number){
        const r=await fetch(`https://api.scryfall.com/cards/${encodeURIComponent(String(row.set_code).toLowerCase())}/${encodeURIComponent(row.collector_number)}`);
        if(r.ok)return await r.json();
      }
      if(row.product_name){
        const r=await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(baseName(row.product_name))}`);
        if(r.ok)return await r.json();
      }
    }catch{}
    return null;
  })();
  sfCache.set(key,job);
  const card=await job;
  sfCache.set(key,Promise.resolve(card));
  return card;
}

function clearPrintingFilters(){
  for(const id of ['cxParityGrade','cxParitySet','cxScoutMin','cxScoutMax','cxScoutSpread','cxScoutFoil','cxLiquidityFilter']){
    const el=document.getElementById(id);
    if(el)el.value='';
  }
  window.CollectishScoutRenderer?.setSaved?.('top');
}

function metric(rows,selector,compare=(a,b)=>a-b){
  const values=rows.map(selector).filter(v=>v&&Number.isFinite(Number(v.value)));
  return values.sort((a,b)=>compare(Number(a.value),Number(b.value)))[0]||null;
}

function renderCompareSummary(){
  const scout=document.getElementById('cxScout');
  if(!scout||!compareContext)return;
  scout.querySelector('#cxOracleCompareSummary')?.remove();
  const rows=familyRows(compareContext.name);
  const best=rows.slice().sort((a,b)=>score(b)-score(a))[0];
  const cheapest=metric(rows,r=>({value:Number(r.cheapest_buy||r.tcg_low||0),row:r}));
  const buylist=metric(rows,r=>({value:Number(r.buylist_roi_pct||0),row:r}),(a,b)=>b-a);
  const direct=metric(rows,r=>({value:r.cheapest_buy>0&&r.direct_net_profit!=null?Number(r.direct_net_profit)/Number(r.cheapest_buy)*100:0,row:r}),(a,b)=>b-a);
  const velocity=metric(rows,r=>({value:Number(r.avg_daily_qty_sold||0),row:r}),(a,b)=>b-a);
  const panel=document.createElement('section');
  panel.id='cxOracleCompareSummary';
  panel.className='cx-oracle-compare-summary';
  panel.innerHTML=`<div class="cx-oracle-compare-head"><div><small>Oracle comparison</small><strong>${esc(compareContext.name)}</strong><span>${rows.length} evaluated Scout printing${rows.length===1?'':'s'} in the current ranking set</span></div><button type="button" data-oracle-return>Back to this printing</button></div><div class="cx-oracle-compare-grid"><div><span>Best Scout</span><strong>${best?`${esc(grade(best))} · ${Math.round(score(best))}/100`:'—'}</strong><small>${best?esc([best.set_code||best.set_name,best.printing].filter(Boolean).join(' · ')):'No evaluated printing'}</small></div><div><span>Cheapest buy</span><strong>${cheapest?money(cheapest.value):'—'}</strong><small>${cheapest?esc([cheapest.row.set_code||cheapest.row.set_name,cheapest.row.printing].filter(Boolean).join(' · ')):'—'}</small></div><div><span>Best buylist ROI</span><strong>${buylist&&buylist.value>0?`${Number(buylist.value).toFixed(1)}%`:'—'}</strong><small>${buylist&&buylist.value>0?esc([buylist.row.set_code||buylist.row.set_name,buylist.row.printing].filter(Boolean).join(' · ')):'—'}</small></div><div><span>Best Direct ROI</span><strong>${direct&&direct.value>0?`${Number(direct.value).toFixed(1)}%`:'—'}</strong><small>${direct&&direct.value>0?esc([direct.row.set_code||direct.row.set_name,direct.row.printing].filter(Boolean).join(' · ')):'—'}</small></div><div><span>Highest velocity</span><strong>${velocity&&velocity.value>0?`${Number(velocity.value).toFixed(1)}/d`:'—'}</strong><small>${velocity&&velocity.value>0?esc([velocity.row.set_code||velocity.row.set_name,velocity.row.printing].filter(Boolean).join(' · ')):'—'}</small></div></div>`;
  const toolbar=scout.querySelector('.cx-scout-toolbar');
  toolbar?.insertAdjacentElement('afterend',panel);
  panel.querySelector('[data-oracle-return]')?.addEventListener('click',returnToPrinting);
}

function markCurrentPrinting(){
  if(!compareContext)return;
  document.querySelectorAll('[data-universal-sku]').forEach(el=>{
    const current=String(el.dataset.universalSku)===String(compareContext.sku);
    el.classList.toggle('cx-oracle-current-printing',current);
    let badge=el.querySelector('.cx-oracle-current-badge');
    if(current&&!badge){badge=document.createElement('span');badge.className='cx-oracle-current-badge';badge.textContent='Current printing';el.appendChild(badge)}
    if(!current)badge?.remove();
  });
}

function refreshCompareDecorations(){
  if(!compareContext)return;
  renderCompareSummary();
  markCurrentPrinting();
}

function returnToPrinting(){
  const ctx=compareContext;
  if(!ctx?.row)return;
  document.querySelector('#cxOracleCompareSummary')?.remove();
  const input=document.getElementById('cxParitySearch');
  if(input)input.value='';
  compareContext=null;
  const p=new URL(location.href).searchParams;
  p.delete('oracle');p.delete('fromSku');p.delete('q');
  history.replaceState({collectish:true},'',`${location.pathname}?${p.toString()}${location.hash}`);
  window.CollectishScoutRenderer?.renderDetail?.(selectedRow(ctx.sku)||ctx.row,true);
}

function openAllPrintings(name,oracleId,sku,row){
  const input=document.getElementById('cxParitySearch');
  if(!input)return;
  compareContext={name,oracleId,sku,row};
  clearPrintingFilters();
  input.value=name;
  const p=new URL(location.href).searchParams;
  p.set('tab','scout');
  p.set('q',name);
  if(oracleId)p.set('oracle',oracleId);else p.delete('oracle');
  if(sku)p.set('fromSku',sku);else p.delete('fromSku');
  for(const key of ['grade','set','min','max','spread','foil','liquidity'])p.delete(key);
  history.replaceState({collectish:true},'',`${location.pathname}?${p.toString()}${location.hash}`);
  renderCompareSummary();
  input.dispatchEvent(new Event('input',{bubbles:true}));
  input.dispatchEvent(new Event('focus',{bubbles:true}));
  document.querySelector('.cx-mobile-detail-close')?.click();
  document.body.classList.remove('cx-scout-detail-lock');
  document.getElementById('cxParityDetail')?.classList.remove('cx-mobile-detail-open');
  input.focus({preventScroll:true});
  input.scrollIntoView({behavior:'smooth',block:'center'});
  setTimeout(markCurrentPrinting,300);
}

async function addLink(detail){
  const host=document.getElementById('cxParityDetail');
  if(!host||!detail?.sku)return;
  const title=host.querySelector('.cx-v5-title>div');
  if(!title)return;
  const row=selectedRow(detail.sku);
  const card=await canonicalCard(row);
  if(!host.isConnected||String(store.get().scout?.selectedSku||'')!==String(detail.sku))return;
  const canonical=card?.name||baseName(row?.product_name||title.querySelector('.cx-section-title')?.textContent||'');
  if(!canonical)return;
  title.querySelector('.cx-scout-all-printings')?.remove();
  const button=document.createElement('button');
  button.type='button';
  button.className='cx-scout-all-printings';
  button.dataset.oracleId=card?.oracle_id||'';
  button.dataset.oracleName=canonical;
  button.innerHTML=`<span>Compare all printings</span><small>${esc(canonical)}</small><b aria-hidden="true">→</b>`;
  button.addEventListener('click',()=>openAllPrintings(canonical,card?.oracle_id||'',detail.sku,row));
  title.appendChild(button);
}

function restoreContextFromUrl(){
  const p=new URL(location.href).searchParams,name=p.get('q'),oracleId=p.get('oracle'),sku=p.get('fromSku');
  if(!name||!sku)return;
  const row=selectedRow(sku);
  if(!row)return;
  compareContext={name,oracleId,sku,row};
  refreshCompareDecorations();
}

function ensureStyle(){
  if(document.getElementById('cxScoutOraclePrintingsStyle'))return;
  const style=document.createElement('style');
  style.id='cxScoutOraclePrintingsStyle';
  style.textContent=`.cx-scout-all-printings{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1px 8px;align-items:center;margin-top:7px;padding:0;border:0;background:transparent;color:var(--cx-accent);text-align:left;cursor:pointer;font:inherit}.cx-scout-all-printings span{font-size:12px;font-weight:850;line-height:1.25}.cx-scout-all-printings small{grid-column:1;font-size:9px;opacity:.72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:230px}.cx-scout-all-printings b{grid-column:2;grid-row:1/3;font-size:16px}.cx-scout-all-printings:hover span,.cx-scout-all-printings:focus-visible span{text-decoration:underline}.cx-scout-all-printings:focus-visible{outline:2px solid var(--cx-accent);outline-offset:4px;border-radius:4px}.cx-oracle-compare-summary{margin:8px 0 14px;padding:12px;border:1px solid var(--cx-line);border-radius:14px;background:var(--cx-bg)}.cx-oracle-compare-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.cx-oracle-compare-head small,.cx-oracle-compare-grid span,.cx-oracle-compare-grid small{display:block;color:var(--cx-muted);font-size:10px}.cx-oracle-compare-head strong{display:block;font-size:16px}.cx-oracle-compare-head span{display:block;margin-top:2px;color:var(--cx-muted);font-size:11px}.cx-oracle-compare-head button{border:1px solid var(--cx-line);border-radius:9px;background:transparent;color:var(--cx-accent);font-weight:800;padding:7px 9px;white-space:nowrap}.cx-oracle-compare-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px;margin-top:10px}.cx-oracle-compare-grid>div{border:1px solid var(--cx-line);border-radius:10px;padding:8px}.cx-oracle-compare-grid strong{display:block;margin:2px 0;font-size:14px}.cx-oracle-current-printing{outline:2px solid var(--cx-accent);outline-offset:-2px;position:relative}.cx-oracle-current-badge{font-size:10px;font-weight:850;color:var(--cx-accent);white-space:nowrap;align-self:center}@media(max-width:760px){.cx-oracle-compare-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.cx-oracle-compare-head{flex-direction:column}.cx-oracle-compare-head button{width:100%}}@media(max-width:520px){.cx-scout-all-printings{margin-top:6px}.cx-scout-all-printings small{max-width:180px}}`;
  document.head.appendChild(style);
}

export function installOraclePrintingsLink(){
  if(installed)return;
  installed=true;
  ensureStyle();
  document.addEventListener('collectish:scout-detail-rendered',e=>void addLink(e.detail));
  document.addEventListener('collectish:scout-structure-ready',restoreContextFromUrl);
  document.addEventListener('collectish:scout-list-rendered',refreshCompareDecorations);
}

installOraclePrintingsLink();
