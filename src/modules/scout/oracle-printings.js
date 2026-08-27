import store from '../../state/store.js';

let installed=false;
const sfCache=new Map();

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const baseName=n=>String(n||'').replace(/\s*\([^)]*(foil|showcase|borderless|extended art|serialized|retro frame|etched|alternate art|halo foil|rainbow foil|surge foil|galaxy foil)[^)]*\)\s*/ig,' ').replace(/\s+/g,' ').trim();

function selectedRow(sku){
  const scout=store.get().scout||{};
  return (scout.rows||[]).find(r=>String(r?.sku_id)===String(sku))||null;
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

function openAllPrintings(name,oracleId){
  const input=document.getElementById('cxParitySearch');
  if(!input)return;
  clearPrintingFilters();
  input.value=name;
  const p=new URL(location.href).searchParams;
  p.set('tab','scout');
  p.set('q',name);
  if(oracleId)p.set('oracle',oracleId);else p.delete('oracle');
  for(const key of ['grade','set','min','max','spread','foil','liquidity'])p.delete(key);
  history.replaceState({collectish:true},'',`${location.pathname}?${p.toString()}${location.hash}`);
  input.dispatchEvent(new Event('input',{bubbles:true}));
  input.dispatchEvent(new Event('focus',{bubbles:true}));
  document.querySelector('.cx-mobile-detail-close')?.click();
  input.focus({preventScroll:true});
  input.scrollIntoView({behavior:'smooth',block:'center'});
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
  button.addEventListener('click',()=>openAllPrintings(canonical,card?.oracle_id||''));
  title.appendChild(button);
}

function ensureStyle(){
  if(document.getElementById('cxScoutOraclePrintingsStyle'))return;
  const style=document.createElement('style');
  style.id='cxScoutOraclePrintingsStyle';
  style.textContent=`.cx-scout-all-printings{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1px 8px;align-items:center;margin-top:7px;padding:0;border:0;background:transparent;color:var(--cx-accent);text-align:left;cursor:pointer;font:inherit}.cx-scout-all-printings span{font-size:12px;font-weight:850;line-height:1.25}.cx-scout-all-printings small{grid-column:1;font-size:9px;opacity:.72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:230px}.cx-scout-all-printings b{grid-column:2;grid-row:1/3;font-size:16px}.cx-scout-all-printings:hover span,.cx-scout-all-printings:focus-visible span{text-decoration:underline}.cx-scout-all-printings:focus-visible{outline:2px solid var(--cx-accent);outline-offset:4px;border-radius:4px}@media(max-width:520px){.cx-scout-all-printings{margin-top:6px}.cx-scout-all-printings small{max-width:180px}}`;
  document.head.appendChild(style);
}

export function installOraclePrintingsLink(){
  if(installed)return;
  installed=true;
  ensureStyle();
  document.addEventListener('collectish:scout-detail-rendered',e=>void addLink(e.detail));
}

installOraclePrintingsLink();
