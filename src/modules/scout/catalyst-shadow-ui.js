import store from '../../state/store.js';
import {scoreCatalystShadow} from '../signals/catalyst-shadow-score.js';

const lower=s=>String(s||'').trim().toLowerCase();
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const baseName=s=>String(s||'').replace(/\s*\([^)]*(foil|showcase|borderless|extended art|serialized|retro frame|etched|alternate art|halo foil|rainbow foil|surge foil|galaxy foil)[^)]*\)\s*/ig,' ').replace(/\s+/g,' ').trim();

function rows(){return store.get().scout?.rows||[]}
function items(){return Array.isArray(store.get().intel?.items)?store.get().intel.items:[]}
function matches(item,row){
  if(!item||!row)return false;
  const sku=String(row.sku_id||''),pid=String(row.product_id||''),sf=String(row.scryfall_id||''),name=lower(baseName(row.product_name));
  const entities=Array.isArray(item.market_intel_entities)?item.market_intel_entities:[];
  if(entities.some(e=>(sku&&String(e.sku_id||'')===sku)||(pid&&String(e.product_id||'')===pid)||(sf&&String(e.scryfall_id||'')===sf)||lower(baseName(e.entity_name))===name))return true;
  const mentions=Array.isArray(item.market_intel_card_mentions)?item.market_intel_card_mentions:[];
  return mentions.some(m=>(sf&&String(m.scryfall_id||'')===sf)||lower(baseName(m.card_name))===name);
}
function crossSourceFor(row){
  const data=Array.isArray(store.get().intel?.crossSourceRows)?store.get().intel.crossSourceRows:[],sku=String(row?.sku_id||''),pid=String(row?.product_id||''),name=lower(baseName(row?.product_name));
  return data.filter(x=>(sku&&String(x.sku_id||'')===sku)||(pid&&String(x.product_id||'')===pid)||lower(baseName(x.card_name))===name);
}
function signed(v){const x=Number(v||0);return `${x>0?'+':''}${x}`}
function render(sku){
  const host=document.getElementById('cxParityDetail');if(!host||!sku)return;
  host.querySelector('.cx-catalyst-shadow')?.remove();
  const row=rows().find(r=>String(r.sku_id)===String(sku));if(!row)return;
  const signals=items().filter(x=>matches(x,row));if(!signals.length&&!crossSourceFor(row).length)return;
  const shadow=scoreCatalystShadow({row,signals,crossSource:crossSourceFor(row)});
  const reasons=shadow.reasons.map(x=>`<li>${esc(x)}</li>`).join('');
  const section=document.createElement('section');section.className='cx-v5-section cx-catalyst-shadow';
  section.innerHTML=`<div class="cx-catalyst-shadow-head"><div><span>CATALYST SHADOW</span><strong>${esc(shadow.baseGrade)} ${Math.round(shadow.baseScore)} <i>→</i> ${esc(shadow.shadowGrade)} ${Math.round(shadow.shadowScore)}</strong></div><b class="${shadow.appliedModifier>0?'up':shadow.appliedModifier<0?'down':'flat'}">${signed(shadow.appliedModifier)} pts</b></div><div class="cx-catalyst-shadow-meta"><span>Official Scout unchanged</span><span>${shadow.signalCount} unique signal${shadow.signalCount===1?'':'s'}</span><span>${shadow.sourceCount} source${shadow.sourceCount===1?'':'s'}</span>${shadow.future?'<span>Future thesis only</span>':''}</div>${reasons?`<ul>${reasons}</ul>`:''}<small>This is a shadow score for validation. Catalyst evidence is capped at −8/+12 and is not used for ranking or the official Scout grade.</small>`;
  const intelligence=host.querySelector('.cx-intelligence-detail'),scoreExplain=host.querySelector('.cx-scout-score-explain'),anchor=intelligence||scoreExplain||host.querySelector('.cx-v5-badges')||host.firstElementChild;
  if(anchor?.parentNode)anchor.insertAdjacentElement('afterend',section);else host.appendChild(section);
}
function selectedSku(){return store.get().scout?.selectedSku||document.querySelector('#cxParityCards .cx-scout-card.selected')?.dataset?.sku||null}
function schedule(sku=selectedSku()){for(const ms of [0,100,360])setTimeout(()=>render(sku),ms)}

document.addEventListener('collectish:scout-detail-rendered',e=>schedule(e.detail?.sku));
document.addEventListener('collectish:intel-changed',()=>schedule());
document.addEventListener('collectish:cross-source-changed',()=>schedule());
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='scout')schedule()});

window.CollectishCatalystShadow={render,scoreCatalystShadow};
