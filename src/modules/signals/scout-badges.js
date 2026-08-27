import store from '../../state/store.js';
import { rest } from '../../core/rest.js';

let links=[];
let items=new Map();
let loading=null;
const lower=s=>String(s||'').trim().toLowerCase();
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

async function load(){
  if(loading)return loading;
  loading=Promise.all([
    rest('market_intel_items?select=intel_id,signal_stage,direction,title,source_name,source_url,observed_at&order=observed_at.desc&limit=500'),
    rest('market_intel_scout_signal_links?select=intel_id,entity_name,canonical_name,oracle_id,source_scryfall_id,source_product_id,matched_scryfall_id,product_id,family_match&limit=5000')
  ]).then(([itemRows,entityRows])=>{
    items=new Map((itemRows||[]).map(x=>[x.intel_id,x]));
    links=(entityRows||[]).filter(x=>items.has(x.intel_id));
    decorateList();
    decorateDetail(store.get().scout?.selectedSku||null);
  }).catch(()=>{}).finally(()=>{loading=null});
  return loading;
}

function matching(row){
  if(!row)return[];
  const sf=lower(row.scryfall_id),pid=String(row.product_id||''),name=lower(row.product_name);
  const seen=new Set(),out=[];
  for(const link of links){
    const hit=(sf&&lower(link.matched_scryfall_id)===sf)||(pid&&String(link.product_id||'')===pid)||(name&&lower(link.entity_name)===name);
    if(!hit||seen.has(link.intel_id))continue;
    const item=items.get(link.intel_id);
    if(item){
      seen.add(link.intel_id);
      out.push({...item,_oracleFamily:Boolean(link.family_match),_signalCard:link.canonical_name||link.entity_name});
    }
  }
  return out.sort((a,b)=>new Date(b.observed_at||0)-new Date(a.observed_at||0));
}
function summary(signals){
  const leading=signals.filter(x=>x.signal_stage==='leading').length;
  const confirming=signals.filter(x=>x.signal_stage==='confirming').length;
  return `${signals.length} signal${signals.length===1?'':'s'}${leading?` · ${leading} early`:confirming?` · ${confirming} confirming`:''}`;
}
function decorateList(){
  const rows=store.get().scout?.rows||[];
  const bySku=new Map(rows.map(r=>[String(r.sku_id),r]));
  document.querySelectorAll('#cxParityCards .cx-scout-card').forEach(card=>{
    card.querySelector('.cx-intel-mini')?.remove();
    const signals=matching(bySku.get(String(card.dataset.sku)));if(!signals.length)return;
    const top=card.querySelector('.cx-scout-card-top');if(!top)return;
    const badge=document.createElement('span');badge.className='cx-intel-mini';badge.textContent=`◉ ${summary(signals)}`;
    badge.title=signals.some(x=>x._oracleFamily)?'Underlying oracle-card market intelligence; exact-SKU execution remains separate':'External market intelligence; does not affect Scout grade';
    top.appendChild(badge);
  });
}
function decorateDetail(sku){
  const host=document.getElementById('cxParityDetail');if(!host||!sku)return;
  host.querySelector('.cx-intel-detail')?.remove();
  const row=(store.get().scout?.rows||[]).find(r=>String(r.sku_id)===String(sku));
  const signals=matching(row);if(!signals.length)return;
  const section=document.createElement('section');section.className='cx-v5-section cx-intel-detail';
  section.innerHTML=`<div class="cx-section-title">Market signals <span class="cx-intel-context">context only</span></div><div class="cx-intel-detail-list">${signals.slice(0,5).map(x=>`<a href="${esc(x.source_url)}" target="_blank" rel="noopener"><span class="cx-signal-stage ${esc(x.signal_stage)}">${esc(x.signal_stage)}</span><strong>${esc(x.title||x.source_name||'Market signal')}</strong><small>${esc(x.source_name||'External source')}${x._oracleFamily?` · underlying card: ${esc(x._signalCard)}`:''}</small></a>`).join('')}</div>`;
  const anchor=host.querySelector('.cx-v5-components')||host.firstElementChild;
  if(anchor?.parentNode)anchor.parentNode.insertBefore(section,anchor.nextSibling);else host.appendChild(section);
}

document.addEventListener('collectish:scout-list-rendered',()=>{if(links.length)decorateList();else load()});
document.addEventListener('collectish:scout-detail-rendered',e=>{if(links.length)decorateDetail(e.detail?.sku);else load()});
document.addEventListener('collectish:intel-changed',()=>{links=[];items.clear();load()});
document.addEventListener('collectish:ready',()=>load());

load();
