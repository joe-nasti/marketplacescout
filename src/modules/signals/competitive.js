import { rest } from '../../core/rest.js';
import { validSession } from '../../core/session.js';
import { collectishConfig } from '../../core/config.js';

let rows=[];
let events=[];
let loading=null;
let syncMessage='';
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pct=v=>v==null?'—':`${Number(v)>=0?'+':''}${Number(v).toFixed(1)}%`;
const stageClass=s=>s==='early'?'leading':s==='confirming'?'confirming':s==='late'?'lagging':'unclassified';

function host(){return document.getElementById('cxSignals')}
function coverageLabel(e){return e?.coverage_type==='curated_sample'?'curated sample':e?.coverage_type==='partial_event'?'published event subset':e?.coverage_type==='complete_event'?'complete event':'coverage unknown'}
function rowHtml(r){
  const velocity=Number(r.decks_prev_7d||0)===0?`${r.decks_7d} new decks`:`${r.decks_7d} vs ${r.decks_prev_7d} decks`;
  return `<div class="cx-detail-stat"><span><strong>${esc(r.card_name)}</strong><small>${esc(`${r.format||'Unknown format'} · ${velocity} · ${r.top8_decks_30d} Top 8 · ${r.wins_30d} win${Number(r.wins_30d)===1?'':'s'}`)}</small></span><span><strong><span class="cx-signal-stage ${stageClass(r.competitive_stage)}">${esc(String(r.competitive_stage||'watch').toUpperCase())}</span></strong><small>${esc(`Market ${pct(r.market_change_7d_pct)} · Direct qty ${pct(r.direct_qty_change_7d_pct)} · Scout ${r.opportunity_score??'—'}`)}</small></span></div>`;
}
function render(){
  const h=host();if(!h)return;
  let panel=document.getElementById('cxCompetitiveIntel');
  if(!panel){panel=document.createElement('section');panel.id='cxCompetitiveIntel';panel.className='cx-card';const layout=h.querySelector('.cx-signals-layout');if(layout)layout.insertAdjacentElement('beforebegin',panel);else h.appendChild(panel)}
  const latest=events.slice(0,4).map(e=>`${e.event_name}${e.format?` · ${e.format}`:''} · ${coverageLabel(e)}`).join(' · ');
  panel.innerHTML=`<div class="cx-page-head"><div><div class="cx-section-title">Competitive opportunities</div><p class="cx-sub">Official tournament adoption compared with Scout price/supply movement. League publications are treated as curated discovery samples; field-share inference requires known event coverage.</p></div><button type="button" class="cx-refresh" id="cxRefreshMtgo">Refresh MTGO</button></div>${latest?`<p class="cx-sub">Latest imported: ${esc(latest)}</p>`:''}<div class="cx-detail-list">${rows.length?rows.slice(0,12).map(rowHtml).join(''):'<div class="cx-empty">No linked competitive opportunities yet. Refresh MTGO to import recent Challenge/Qualifier/Showcase results.</div>'}</div><div id="cxCompetitiveMsg" class="cx-sub">${esc(syncMessage)}</div>`;
  document.getElementById('cxRefreshMtgo')?.addEventListener('click',sync);
}
async function load(){
  if(loading)return loading;
  loading=Promise.all([
    rest('rpc/competitive_scout_opportunities',{method:'POST',body:{p_format:null}}),
    rest('competitive_events?select=event_name,format,event_date,player_count,published_deck_count,coverage_type,coverage_note,source_url&order=event_date.desc,fetched_at.desc&limit=8')
  ]).then(([r,e])=>{rows=Array.isArray(r)?r:[];events=Array.isArray(e)?e:[];render();return rows}).catch(error=>{console.warn('Competitive intel load failed',error);render();return rows}).finally(()=>{loading=null});
  return loading;
}
async function sync(){
  const btn=document.getElementById('cxRefreshMtgo');
  const original=btn?.textContent||'Refresh MTGO';
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),65000);
  if(btn){btn.disabled=true;btn.textContent='Refreshing…'}
  syncMessage='Fetching and parsing up to 4 recent MTGO Challenge/Qualifier/Showcase/Trial results…';render();
  try{
    const session=await validSession();if(!session)throw new Error('Sign in required');
    const r=await fetch(`${collectishConfig.supabaseUrl}/functions/v1/competitive-mtgo-sync`,{method:'POST',signal:controller.signal,headers:{apikey:collectishConfig.publishableKey,Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},body:JSON.stringify({limit:4})});
    const text=await r.text();let data;try{data=text?JSON.parse(text):{}}catch{data={error:text}};
    if(!r.ok)throw new Error(data?.error||`MTGO sync HTTP ${r.status}`);
    const errorCount=Number(data.errors||0);
    const seconds=Math.max(1,Math.round(Number(data.elapsed_ms||0)/1000));
    syncMessage=`Imported ${data.events||0} event${Number(data.events)===1?'':'s'}, ${data.decks||0} decks and ${data.cards||0} card rows in ${seconds}s.${errorCount?` ${errorCount} event${errorCount===1?'':'s'} could not be fully imported.`:''}${Number(data.events||0)===0?` MTGO discovery found ${data.discovered||0} decklist URL${Number(data.discovered)===1?'':'s'}${data.message?`: ${data.message}`:'.'}`:''}`;
    loading=null;await load();document.dispatchEvent(new CustomEvent('collectish:competitive-changed',{detail:data}));
  }catch(e){
    syncMessage=e?.name==='AbortError'?'MTGO refresh timed out after 65 seconds. Nothing will keep spinning; try again or inspect the returned event errors.':(e?.message||'Could not refresh MTGO results.');
    render();
  }finally{clearTimeout(timer);const current=document.getElementById('cxRefreshMtgo');if(current){current.disabled=false;current.textContent=original}}
}
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals')queueMicrotask(()=>void load())});
document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='signals')queueMicrotask(()=>void load())});
document.addEventListener('collectish:competitive-changed',()=>{loading=null;void load()});
export { load as loadCompetitiveIntel, sync as syncCompetitiveMtgo };
