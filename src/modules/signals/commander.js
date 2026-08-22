import { rest } from '../../core/rest.js';
import { validSession } from '../../core/session.js';
import { collectishConfig } from '../../core/config.js';

let edhRows=[];
let cedhRows=[];
let cedhEvents=[];
let loading=null;
let lastLoadedAt=0;
let syncMessage='';
const AUTO_REFRESH_MS=5*60*1000;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=v=>v==null?'—':`$${Number(v).toFixed(2)}`;
const pct=v=>v==null?'—':`${Number(v)>=0?'+':''}${Number(v).toFixed(1)}%`;
const host=()=>document.getElementById('cxSignals');
const ready=()=>host()?.dataset.cxLazyReady==='1';

function edhEstablished(){return edhRows.filter(r=>['edh_popular','edh_demand'].includes(r.watch_class)).slice(0,8)}
function edhBreakouts(){return edhRows.filter(r=>r.watch_class==='edh_breakout').slice(0,8)}
function cedhEstablished(){return cedhRows.filter(r=>['cedh_established','cedh_watch','cedh_baseline'].includes(r.watch_class)).slice(0,8)}
function cedhBreakouts(){return cedhRows.filter(r=>r.watch_class==='cedh_breakout').slice(0,8)}

function scoutAttrs(r,nameKey='card_name'){
  const name=r?.[nameKey]||'';
  return `data-open-scout="1" data-sku="${esc(r?.sku_id||'')}" data-product="${esc(r?.product_id||'')}" data-card="${esc(name)}"`;
}
function edhRow(r){
  const trend=Number(r.history_days||0)>=3&&r.rank_improvement_pct!=null?`${pct(r.rank_improvement_pct)} rank move over ${Number(r.history_days).toFixed(1)}d`:'baseline';
  const setup=`Market ${money(r.market_price)} · Direct ${money(r.direct_low)} · ${r.direct_available??'—'} Direct qty · Scout ${r.opportunity_score??'—'}`;
  const label=r.watch_class==='edh_breakout'?'EDH BREAKOUT':r.watch_class==='edh_popular'?'EDH PLAYED + SCOUT':'EDH DEMAND + SCOUT';
  const cls=r.watch_class==='edh_breakout'?'leading':'confirming';
  return `<div class="cx-detail-stat cx-scout-deep-link" ${scoutAttrs(r)} role="button" tabindex="0" title="Open in Scout"><span><strong>${esc(r.card_name)}</strong><small>EDHREC #${esc(r.edhrec_rank||'—')} · ${esc(trend)}</small><small>${esc(`${r.set_name||'Unknown printing'} · ${r.printing||'printing unknown'}`)}</small></span><span><strong><span class="cx-signal-stage ${cls}">${label}</span> <span class="cx-signal-stage confirming">${esc(`PRIORITY ${r.commander_priority}`)}</span></strong><small>${esc(setup)}</small><small>${esc(r.watch_reason||r.edhrec_signal||'Commander demand')}</small></span></div>`;
}
function cedhRow(r){
  const trend=r.share_prev_30d_pct!=null?`${r.share_30d_pct??0}% share vs ${r.share_prev_30d_pct}% prior · ${pct(r.share_change_pp)} pp`:`${r.share_30d_pct??'—'}% recent tournament share · baseline`;
  const setup=r.product_id?`Commander Scout: ${r.set_name||'printing'} · Market ${money(r.market_price)} · Direct ${money(r.direct_low)} · Scout ${r.opportunity_score??'—'}`:'Commander card is not currently linked to a Scout printing.';
  const label=r.watch_class==='cedh_breakout'?'cEDH BREAKOUT':r.watch_class==='cedh_established'?'cEDH META':'cEDH WATCH';
  const cls=r.watch_class==='cedh_breakout'?'leading':r.watch_class==='cedh_established'?'confirming':'unclassified';
  const attrs=r.product_id?`class="cx-detail-stat cx-scout-deep-link" ${scoutAttrs(r,'commander')} role="button" tabindex="0" title="Open commander in Scout"`:'class="cx-detail-stat"';
  return `<div ${attrs}><span><strong>${esc(r.commander)}</strong><small>${esc(`${r.entries_30d||0} entries · ${r.top16_entries||0} Top 16 · ${r.wins||0} wins`)}</small><small>${esc(trend)}</small></span><span><strong><span class="cx-signal-stage ${cls}">${label}</span> <span class="cx-signal-stage confirming">${esc(`PRIORITY ${r.cedh_priority}`)}</span></strong><small>${esc(setup)}</small><small>${esc(`${r.event_count||0} tournament${Number(r.event_count)===1?'':'s'} · latest ${r.latest_seen||'—'}`)}</small></span></div>`;
}
function section(title,sub,items,rowFn){return `<div class="cx-section-title">${esc(title)}</div><p class="cx-sub">${esc(sub)}</p><div class="cx-detail-list">${items.length?items.map(rowFn).join(''):'<div class="cx-empty">Nothing qualifies yet.</div>'}</div>`}

function render(){
  const h=host();if(!h||!ready())return;
  let panel=document.getElementById('cxCommanderIntel');
  if(!panel){panel=document.createElement('section');panel.id='cxCommanderIntel';panel.className='cx-card';const comp=document.getElementById('cxCompetitiveIntel'),layout=h.querySelector('.cx-signals-layout');if(comp)comp.insertAdjacentElement('afterend',panel);else if(layout)layout.insertAdjacentElement('beforebegin',panel);else h.appendChild(panel)}
  const established=edhEstablished(),breakouts=edhBreakouts(),cedh=cedhEstablished(),cedhUp=cedhBreakouts();
  const history=Math.max(0,...edhRows.map(r=>Number(r.history_days||0)));
  const latest=cedhEvents.slice(0,4).map(e=>`${e.event_name} · ${e.player_count||e.published_deck_count||'?'} players`).join(' · ');
  const loadHtml=loading?'<div class="cx-empty">Loading Commander Intelligence…</div>':'';
  panel.innerHTML=`<div class="cx-page-head"><div><div class="cx-section-title">Commander intelligence</div><p class="cx-sub">Broad EDH demand from EDHREC plus tournament-backed cEDH adoption. Commander demand and cEDH tournament play are separate evidence sources.</p></div><button type="button" class="cx-refresh" id="cxRefreshCedh">Refresh cEDH</button></div><p class="cx-sub">EDHREC history available: about ${history.toFixed(1)} days. Trend labels require at least 3 days of observed rank history.</p>${latest?`<p class="cx-sub">Recent cEDH coverage: ${esc(latest)}</p>`:''}${loadHtml}${!loading?section('EDH played + Scout','Established Commander demand where the selected printing also has a useful Scout setup.',established,edhRow):''}${!loading?section('EDH trends / breakouts','Cards whose EDHREC rank is improving across the history MarketplaceScout has actually observed.',breakouts,edhRow):''}${!loading?section('cEDH tournament meta','Commanders with meaningful tournament representation. This is cEDH tournament adoption, not broad Commander popularity.',cedh,cedhRow):''}${!loading&&cedhUp.length?section('cEDH adoption breakouts','Commander archetypes gaining tournament share versus the prior 30-day window.',cedhUp,cedhRow):''}<div id="cxCommanderMsg" class="cx-sub">${esc(syncMessage)}</div>`;
  document.getElementById('cxRefreshCedh')?.addEventListener('click',syncCedh);
}

async function load({force=false}={}){
  if(loading)return loading;
  if(!force&&lastLoadedAt&&Date.now()-lastLoadedAt<AUTO_REFRESH_MS){render();return edhRows}
  loading=Promise.allSettled([
    rest('rpc/commander_edh_opportunities',{method:'POST',body:{p_limit:150}}),
    rest('rpc/cedh_commander_rollups',{method:'POST',body:{p_days:90,p_min_event_size:16}}),
    rest('competitive_events?select=event_name,event_date,player_count,published_deck_count,coverage_type,source_url&format=eq.cEDH&order=event_date.desc,fetched_at.desc&limit=12')
  ]).then(([e,c,ev])=>{
    edhRows=e.status==='fulfilled'&&Array.isArray(e.value)?e.value:[];
    cedhRows=c.status==='fulfilled'&&Array.isArray(c.value)?c.value:[];
    cedhEvents=ev.status==='fulfilled'&&Array.isArray(ev.value)?ev.value:[];
    lastLoadedAt=Date.now();
    document.dispatchEvent(new CustomEvent('collectish:commander-intel-changed',{detail:{edh:edhRows.length,cedh:cedhRows.length}}));
    return edhRows;
  }).finally(()=>{loading=null;render()});
  render();return loading;
}
async function syncCedh(){
  const btn=document.getElementById('cxRefreshCedh');const original=btn?.textContent||'Refresh cEDH';const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),65000);
  if(btn){btn.disabled=true;btn.textContent='Refreshing…'}syncMessage='Importing recent EDHTop16 cEDH tournaments…';render();
  try{
    const session=await validSession();if(!session)throw new Error('Sign in required');
    const r=await fetch(`${collectishConfig.supabaseUrl}/functions/v1/competitive-cedh-sync`,{method:'POST',signal:controller.signal,headers:{apikey:collectishConfig.publishableKey,Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},body:JSON.stringify({limit:4,days:120,min_size:16})});
    const text=await r.text();let data;try{data=text?JSON.parse(text):{}}catch{data={error:text}};
    if(!r.ok)throw new Error(data?.error||`cEDH sync HTTP ${r.status}`);
    syncMessage=`Imported ${data.events||0} new cEDH event${Number(data.events)===1?'':'s'} and ${data.decks||0} tournament entries.${data.skipped_imported?` Skipped ${data.skipped_imported} already-imported event${Number(data.skipped_imported)===1?'':'s'}.`:''}${data.errors?` ${data.errors} event${Number(data.errors)===1?'':'s'} failed.`:''}`;
    lastLoadedAt=0;await load({force:true});document.dispatchEvent(new CustomEvent('collectish:competitive-changed',{detail:{source:'cedh',...data}}));
  }catch(e){syncMessage=e?.name==='AbortError'?'cEDH refresh timed out after 65 seconds.':(e?.message||'Could not refresh cEDH results.');render()}
  finally{clearTimeout(timer);const current=document.getElementById('cxRefreshCedh');if(current){current.disabled=false;current.textContent=original}}
}
function openScoutFrom(el){
  const detail={sku_id:el.dataset.sku||null,product_id:el.dataset.product||null,card_name:el.dataset.card||null};
  document.dispatchEvent(new CustomEvent('collectish:open-scout-card',{detail}));
}
document.addEventListener('click',e=>{const el=e.target.closest?.('#cxCommanderIntel [data-open-scout="1"]');if(!el||e.target.closest('a,button,input,select,textarea'))return;e.preventDefault();openScoutFrom(el)},true);
document.addEventListener('keydown',e=>{if(e.key!=='Enter'&&e.key!==' ')return;const el=e.target.closest?.('#cxCommanderIntel [data-open-scout="1"]');if(!el)return;e.preventDefault();openScoutFrom(el)},true);
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals'&&ready())queueMicrotask(()=>load().catch(()=>{}))});
document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='signals')queueMicrotask(()=>load().catch(()=>{}))});
document.addEventListener('collectish:commander-intel-changed',()=>{});
if(ready())queueMicrotask(()=>load().catch(()=>{}));
export {load as loadCommanderIntel,syncCedh};
