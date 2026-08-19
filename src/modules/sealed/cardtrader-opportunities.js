import { rest } from '../../core/rest.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
const pct=n=>n==null||!Number.isFinite(Number(n))?'—':`${Number(n).toFixed(1)}%`;
let cache=null;

function scoreOpportunity(row){
  const raw=row.raw_json||{},zero=raw.ct_zero||{},trend=raw.ct_zero_trend||{};
  const landed=Number(zero.landed_6_avg??zero.landed_3_avg??zero.landed_1_avg);
  const tcg=Number(row.tcg_market_price||row.tcg_low_with_shipping||row.tcg_low_price);
  if(!Number.isFinite(landed)||landed<=0||!Number.isFinite(tcg)||tcg<=0)return null;
  const spread=(tcg/landed-1)*100;
  const qty=Number(zero.quantity||0);
  const pressure=Number(trend.pressure_score||0);
  const historyReady=trend.signal&&trend.signal!=='building_history';
  const depth=Math.min(25,qty)/25;
  const spreadScore=Math.max(-20,Math.min(60,spread));
  const trendBoost=historyReady?Math.max(-20,Math.min(20,pressure/5)):0;
  const score=spreadScore*0.75+depth*15+trendBoost;
  let tier='watch';
  if(spread>=20&&qty>=6&&(trend.signal==='tightening'||trend.signal==='strong_tightening'))tier='priority';
  else if(spread>=15&&qty>=6)tier='strong';
  else if(spread>=8&&qty>=3)tier='watch';
  else return null;
  return{...row,landed,tcg,spread,qty,pressure,historyReady,signal:trend.signal||'building_history',score,tier};
}

async function load(){
  if(cache)return cache;
  const rows=await rest('sealed_product_price_current?select=sealed_uuid,product_name,raw_json,captured_at&source=eq.cardtrader&limit=5000').catch(()=>[]);
  const ids=(rows||[]).map(r=>r.sealed_uuid).filter(Boolean);
  const tcg=[];
  for(let i=0;i<ids.length;i+=100){
    const batch=ids.slice(i,i+100);if(!batch.length)continue;
    const q=batch.map(x=>`"${x}"`).join(',');
    const got=await rest(`sealed_product_price_current?select=sealed_uuid,market_price,low_price,low_with_shipping&source=eq.tcgplayer_public&sealed_uuid=in.(${encodeURIComponent(q)})`).catch(()=>[]);
    tcg.push(...got);
  }
  const tmap=new Map(tcg.map(r=>[String(r.sealed_uuid),r]));
  cache=(rows||[]).map(r=>{const t=tmap.get(String(r.sealed_uuid))||{};return scoreOpportunity({...r,tcg_market_price:t.market_price,tcg_low_price:t.low_price,tcg_low_with_shipping:t.low_with_shipping})}).filter(Boolean).sort((a,b)=>b.score-a.score);
  return cache;
}

function ensurePanel(){
  const root=document.getElementById('cxSealed');if(!root)return null;
  let panel=root.querySelector('[data-ct0-opportunities]');
  if(panel)return panel;
  panel=document.createElement('section');panel.dataset.ct0Opportunities='';panel.className='cx-card';
  const layout=root.querySelector('.cx-sealed-layout');
  if(layout)root.insertBefore(panel,layout);else root.appendChild(panel);
  return panel;
}

async function render(){
  const panel=ensurePanel();if(!panel)return;
  const rows=await load();
  const ready=rows.filter(r=>r.historyReady),building=rows.filter(r=>!r.historyReady);
  const top=(ready.length?ready:building).slice(0,12);
  panel.innerHTML=`<div class="cx-page-head"><div><h3>CT0 Opportunities</h3><p>Estimated landed acquisition spread with Zero depth${ready.length?' and supply-pressure confirmation':''}.</p><small class="cx-sub">${rows.length} candidates · ${ready.length} with trend history · ${building.length} building history</small></div><button type="button" class="cx-refresh" data-ct0-toggle>Hide</button></div><div data-ct0-list>${top.length?top.map(r=>`<button type="button" class="cx-sealed-row" data-deck="${esc(r.sealed_uuid)}"><div class="cx-sealed-name"><strong>${esc(r.product_name)}</strong><small>${esc(r.tier.toUpperCase())} · ${r.signal==='building_history'?'trend building':esc(r.signal.replaceAll('_',' '))}</small></div><div class="cx-sealed-metric"><span>CT0 ×6 landed</span><b>${money(r.landed)}</b><small>${r.qty.toLocaleString()} Zero units</small></div><div class="cx-sealed-metric"><span>TCG reference</span><b>${money(r.tcg)}</b><small>${r.tcg===Number(r.tcg_market_price)?'market':'low/reference'}</small></div><div class="cx-sealed-metric ${r.spread>=0?'cx-sealed-positive':'cx-sealed-negative'}"><span>Landed spread</span><b>${r.spread>=0?'+':''}${pct(r.spread)}</b><small>${r.historyReady?`pressure ${r.pressure>=0?'+':''}${r.pressure.toFixed(0)}`:'waiting for trend baseline'}</small></div></button>`).join(''):'<div class="cx-empty">No CT0 opportunities meet the current landed-spread/depth thresholds.</div>'}</div>`;
  panel.querySelector('[data-ct0-toggle]')?.addEventListener('click',e=>{const list=panel.querySelector('[data-ct0-list]');const hidden=list.hidden=!list.hidden;e.currentTarget.textContent=hidden?'Show':'Hide'});
  panel.querySelectorAll('[data-deck]').forEach(b=>b.addEventListener('click',()=>window.CollectishSealed?.select?.(b.dataset.deck)));
}

document.addEventListener('collectish:sealed-rendered',()=>{cache=null;render().catch(()=>{})});
