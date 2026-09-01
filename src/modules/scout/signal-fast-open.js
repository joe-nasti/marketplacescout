import store from '../../state/store.js';
import { readScoutDetail } from './cache-read.js';

let openSeq=0;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
const lower=s=>String(s||'').trim().toLowerCase();
const baseName=s=>String(s||'')
  .replace(/\s*\([^)]*(foil|showcase|borderless|extended art|serialized|retro frame|etched|alternate art|halo foil|rainbow foil|surge foil|galaxy foil)[^)]*\)\s*/ig,' ')
  .replace(/\s*\(\d+[a-z]?\)\s*$/ig,' ')
  .replace(/\s+/g,' ').trim();

function rows(){return store.get().scout?.rows||[]}
function score(r){return Number(r?.promoted_score??r?.v5_shadow_score??r?.opportunity_score??0)}
function grade(r){return r?.promoted_grade||r?.v5_shadow_grade||(score(r)>=80?'A':score(r)>=70?'B':score(r)>=60?'C':score(r)>=50?'D':'F')}
function finishMatches(row,wanted){
  const w=lower(wanted);if(!w)return true;
  const p=lower(row?.printing||row?.finish);
  if(w==='foil')return p.includes('foil')&&!p.includes('non foil')&&!p.includes('non-foil');
  if(w==='regular'||w==='nonfoil'||w==='non foil')return !p.includes('foil')||p.includes('non foil')||p.includes('non-foil');
  return true;
}
function match(detail={}){
  const list=rows();
  if(detail.sku_id){const r=list.find(x=>String(x.sku_id)===String(detail.sku_id));if(r)return r}
  if(detail.scryfall_id){const r=list.find(x=>String(x.scryfall_id||'')===String(detail.scryfall_id));if(r)return r}
  if(detail.product_id){const r=list.find(x=>String(x.product_id||'')===String(detail.product_id));if(r)return r}
  const wanted=lower(baseName(detail.card_name));if(!wanted)return null;
  let candidates=list.filter(x=>lower(baseName(x.product_name))===wanted);
  const setHint=lower(detail.set_code||detail.set_name);
  if(setHint){const exact=candidates.filter(x=>lower(x.set_code)===setHint||lower(x.set_name)===setHint);if(exact.length)candidates=exact}
  const exactFinish=candidates.filter(x=>finishMatches(x,detail.finish));if(exactFinish.length)candidates=exactFinish;
  return candidates[0]||null;
}
function metric(label,value,sub=''){return `<div><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`}
function renderFast(row,detail=null){
  const host=document.getElementById('cxParityDetail');if(!host||!row)return;
  const r={...row,...(detail||{})},buy=r.cheapest_buy!=null?money(r.cheapest_buy):money(r.tcg_low),direct=money(r.direct_low),market=money(r.sku_market_price),net=money(r.direct_net_est),profit=money(r.direct_net_profit),velocity=Number(r.avg_daily_qty_sold||0);
  if(matchMedia('(max-width:980px)').matches){host.classList.add('cx-mobile-detail-open');document.body.classList.add('cx-scout-detail-lock')}
  host.innerHTML=`<button type="button" class="cx-mobile-detail-close" aria-label="Close card details">×</button><div class="cx-signal-fast-detail"><div class="cx-signal-fast-head"><div><small>Scout detail</small><div class="cx-section-title">${esc(r.product_name||'Card')}</div><span>${esc([r.set_name,r.printing,r.condition].filter(Boolean).join(' · '))}</span></div><div class="cx-signal-fast-grade"><b class="cx-grade cx-grade-${esc(grade(r).toLowerCase())}">${esc(grade(r))}</b><strong>${Math.round(score(r))}<small>/100</small></strong></div></div><section class="cx-signal-fast-decision"><small>Decision data is ready</small><strong>${buy!=='—'?`Buy ${buy}`:'Scout printing loaded'}${net!=='—'?` → ${net} net`:''}</strong><span>${profit!=='—'?`${profit} est. profit`:''}</span></section><div class="cx-signal-fast-grid">${metric('TCG Market',market)}${metric('TCG Direct Low',direct)}${metric('Best buy',buy,r.cheapest_source||'')}${metric('TCG velocity',`${velocity.toFixed(1)}/d`)}${metric('CK cash buylist',money(r.ck_buylist))}${metric('Direct available',Number(r.direct_available||0).toLocaleString())}</div><div class="cx-signal-fast-enrich"><span class="cx-signal-fast-spinner" aria-hidden="true"></span><span>Loading card art, external links and printing-family controls…</span></div></div>`;
  host.querySelector('.cx-mobile-detail-close')?.addEventListener('click',()=>{host.classList.remove('cx-mobile-detail-open');document.body.classList.remove('cx-scout-detail-lock')});
}
async function warmCard(r){
  try{
    let response=null;
    if(r.scryfall_id)response=await fetch(`https://api.scryfall.com/cards/${encodeURIComponent(r.scryfall_id)}`);
    else if(r.set_code&&r.collector_number)response=await fetch(`https://api.scryfall.com/cards/${encodeURIComponent(String(r.set_code).toLowerCase())}/${encodeURIComponent(r.collector_number)}`);
    else if(r.product_name)response=await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(baseName(r.product_name))}`);
    if(response?.ok)return response.json();
  }catch{}
  return null;
}
function markSelected(row){
  store.update('scout',{selectedSku:row.sku_id||null});
  document.querySelectorAll('#cxParityCards .cx-scout-card').forEach(el=>el.classList.toggle('selected',String(el.dataset.sku)===String(row.sku_id)));
}
export async function openSignalScoutFast(detail={}){
  const seq=++openSeq,start=performance.now();
  window.CollectishShell?.switchPage?.('scout');
  let row=match(detail);
  for(const delay of [0,32,80,160]){
    if(row||seq!==openSeq)break;
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    row=match(detail);
  }
  if(seq!==openSeq)return;
  if(!row){
    const input=document.getElementById('cxParitySearch'),q=baseName(detail.card_name||'');
    if(q&&input){input.value=q;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus({preventScroll:true})}
    return;
  }
  markSelected(row);renderFast(row);
  document.dispatchEvent(new CustomEvent('collectish:signal-scout-fast-paint',{detail:{sku:row.sku_id,ms:Math.round(performance.now()-start)}}));
  const local=await readScoutDetail(row).catch(()=>row);
  if(seq!==openSeq)return;
  renderFast(row,local);
  document.dispatchEvent(new CustomEvent('collectish:signal-scout-local-detail',{detail:{sku:row.sku_id,ms:Math.round(performance.now()-start)}}));
  await warmCard(local);
  if(seq!==openSeq)return;
  const renderer=window.CollectishScoutRenderer;
  if(renderer?.renderDetail){
    await renderer.renderDetail(local,true);
    if(seq!==openSeq)return;
    document.dispatchEvent(new CustomEvent('collectish:signal-scout-enriched-detail',{detail:{sku:row.sku_id,ms:Math.round(performance.now()-start)}}));
  }
}
