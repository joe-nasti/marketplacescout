import { rest } from '../../core/rest.js';
import { loadResource } from '../../state/resources.js';
import { registerComponent } from '../../core/lifecycle.js';
import store from '../../state/store.js';

const PATH='scout_sku_volatility?select=sku_id,volatility,z_score,fetched_at&order=fetched_at.desc&limit=600';
let data=new Map();
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export const volatilityAdjustment=v=>String(v||'').toUpperCase()==='HIGH'?-3:0;
const grade=s=>s>=80?'A':s>=70?'B':s>=60?'C':s>=50?'D':'F';
const label=v=>{const s=String(v||'').toUpperCase();return s==='MEDIUM'?'MED VOL':s==='HIGH'?'HIGH VOL':s==='LOW'?'LOW VOL':'VOL ?'};

async function load(force=false){
  const rows=await loadResource('scout.volatility',()=>rest(PATH),{force,ttl:5*60*1000});
  data=new Map((rows||[]).map(x=>[String(x.sku_id),x]));
  store.update('scout',{volatilityCount:data.size});
  decorate();
  return rows;
}

function applyCard(card){
  const sku=String(card.dataset.sku||''),v=data.get(sku);if(!v)return;
  const top=card.querySelector('.cx-scout-card-top'),scoreEl=card.querySelector('.cx-score-mini'),gradeEl=card.querySelector('.cx-grade');if(!top||!scoreEl||!gradeEl)return;
  if(!scoreEl.dataset.volBase){const m=scoreEl.textContent.match(/Scout\s+(\d+)/i);if(!m)return;scoreEl.dataset.volBase=m[1]}
  const base=Number(scoreEl.dataset.volBase),adj=volatilityAdjustment(v.volatility),score=Math.max(0,Math.min(100,base+adj)),g=grade(score);
  scoreEl.textContent=`Scout ${score}/100`;gradeEl.textContent=g;gradeEl.className=`cx-grade cx-grade-${g.toLowerCase()}`;
  let badge=top.querySelector('[data-volatility-badge]');if(!badge){badge=document.createElement('span');badge.dataset.volatilityBadge='1';badge.className='cx-v5-badge';top.append(badge)}
  badge.textContent=`${label(v.volatility)}${adj?` ${adj}`:''}`;badge.title=`TCGplayer SKU volatility${v.z_score==null?'':` · z ${Number(v.z_score).toFixed(2)}`}`;badge.classList.toggle('verify',String(v.volatility).toUpperCase()==='HIGH');
  card.dataset.volatility=String(v.volatility||'');card.dataset.volatilityAdjustedScore=String(score);
}

function applyDetail(){
  const selected=document.querySelector('#cxParityCards .cx-scout-card.selected'),host=document.getElementById('cxParityDetail');if(!selected||!host)return;
  const v=data.get(String(selected.dataset.sku||''));if(!v)return;
  const badges=host.querySelector('.cx-v5-badges');if(badges&&!badges.querySelector('[data-volatility-detail]')){const el=document.createElement('span');el.dataset.volatilityDetail='1';el.className='cx-v5-badge';if(String(v.volatility).toUpperCase()==='HIGH')el.classList.add('verify');el.textContent=`${label(v.volatility)}${volatilityAdjustment(v.volatility)?' · -3 score':''}`;badges.append(el)}
  const details=host.querySelector('.cx-v5-details .cx-v5-grid');if(details&&!details.querySelector('[data-volatility-stat]')){const el=document.createElement('div');el.className='cx-v5-stat';el.dataset.volatilityStat='1';el.innerHTML=`<span>TCG volatility</span><strong>${esc(String(v.volatility||'—'))}</strong><small>${v.z_score==null?'SKU-level signal':`z-score ${Number(v.z_score).toFixed(2)}`}</small>`;details.append(el)}
}

export function decorate(){document.querySelectorAll('#cxParityCards .cx-scout-card[data-sku]').forEach(applyCard);applyDetail()}
function onScoutRendered(){load().catch(()=>{});requestAnimationFrame(decorate)}
function onClick(event){if(event.target.closest?.('#cxParityCards .cx-scout-card'))requestAnimationFrame(()=>requestAnimationFrame(decorate))}

registerComponent('scout-volatility',{
  mount(){document.addEventListener('collectish:scout-v5-ready',onScoutRendered);document.addEventListener('collectish:scout-detail-rendered',decorate);document.addEventListener('click',onClick,true);load().catch(()=>{})},
  unmount(){document.removeEventListener('collectish:scout-v5-ready',onScoutRendered);document.removeEventListener('collectish:scout-detail-rendered',decorate);document.removeEventListener('click',onClick,true)},
  onPage(page){if(page==='scout')requestAnimationFrame(decorate)}
});

window.CollectishScoutVolatility={refresh:()=>load(true),adjustment:volatilityAdjustment,decorate};
