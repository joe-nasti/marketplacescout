import { rest } from '../../core/rest.js';
import { validSession } from '../../core/session.js';
import { collectishConfig } from '../../core/config.js';

let edhRows=[];
let cedhRows=[];
let cedhCardRows=[];
let cedhEvents=[];
let loading=null;
let lastLoadedAt=0;
let syncMessage='';
let edhError='';
let cedhError='';
let cedhCardError='';
const AUTO_REFRESH_MS=5*60*1000;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=v=>v==null?'—':`$${Number(v).toFixed(2)}`;
const pct=v=>v==null?'—':`${Number(v)>=0?'+':''}${Number(v).toFixed(1)}%`;
const host=()=>document.getElementById('cxSignals');
const ready=()=>host()?.dataset.cxLazyReady==='1';
const safeError=e=>String(e?.message||e||'Request failed').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,240);

function edhEstablished(){return edhRows.filter(r=>['edh_popular','edh_demand'].includes(r.watch_class)).slice(0,8)}
function edhBreakouts(){return edhRows.filter(r=>r.watch_class==='edh_breakout').slice(0,8)}
function cedhEstablished(){return cedhRows.filter(r=>['cedh_established','cedh_watch','cedh_baseline'].includes(r.watch_class)).slice(0,8)}
function cedhBreakouts(){return cedhRows.filter(r=>r.watch_class==='cedh_breakout').slice(0,8)}
function cedhCardEstablished(){return cedhCardRows.filter(r=>r.watch_class==='cedh_played_scout').slice(0,8)}
function cedhCardRecent(){return cedhCardRows.filter(r=>r.watch_class==='cedh_recent_card').slice(0,8)}
function cedhCardBreakouts(){return cedhCardRows.filter(r=>r.watch_class==='cedh_breakout').slice(0,8)}

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
  const trend=r.share_prev_30d_pct!=null?`${r.share_30d_pct??0}% known-commander share vs ${r.share_prev_30d_pct}% prior · ${pct(r.share_change_pp)} pp`:`${r.share_30d_pct??'—'}% known-commander share · baseline`;
  const setup=r.product_id?`Commander Scout: ${r.set_name||'printing'} · Market ${money(r.market_price)} · Direct ${money(r.direct_low)} · Scout ${r.opportunity_score??'—'}`:'Commander card is not currently linked to a Scout printing.';
  const label=r.watch_class==='cedh_breakout'?'cEDH BREAKOUT':r.watch_class==='cedh_established'?'cEDH META':'cEDH WATCH';
  const cls=r.watch_class==='cedh_breakout'?'leading':r.watch_class==='cedh_established'?'confirming':'unclassified';
  const attrs=r.product_id?`class="cx-detail-stat cx-scout-deep-link" ${scoutAttrs(r,'commander')} role="button" tabindex="0" title="Open commander in Scout"`:'class="cx-detail-stat"';
  return `<div ${attrs}><span><strong>${esc(r.commander)}</strong><small>${esc(`${r.entries_30d||0}/${r.total_field_30d||'—'} known entries · ${r.top16_entries||0} Top 16 · ${r.wins||0} wins`)}</small><small>${esc(trend)}</small></span><span><strong><span class="cx-signal-stage ${cls}">${label}</span> <span class="cx-signal-stage confirming">${esc(`PRIORITY ${r.cedh_priority}`)}</span></strong><small>${esc(setup)}</small><small>${esc(`${r.event_count||0} tournament${Number(r.event_count)===1?'':'s'} · latest ${r.latest_seen||'—'}`)}</small></span></div>`;
}
function cedhCardRow(r){
  const denominator=Number(r.structured_decks_30d||0);
  const trend=r.share_prev_30d_pct!=null?`${r.share_30d_pct??0}% vs ${r.share_prev_30d_pct}% prior · ${pct(r.share_change_pp)} pp`:`${r.share_30d_pct??'—'}% of structured cEDH lists · baseline`;
  const setup=r.product_id?`${r.set_name||'Scout printing'} · Market ${money(r.market_price)} · Direct ${money(r.direct_low)} · ${r.direct_available??'—'} Direct qty · Scout ${r.opportunity_score??'—'}`:'No linked Scout printing yet.';
  const label=r.watch_class==='cedh_breakout'?'cEDH CARD BREAKOUT':r.watch_class==='cedh_recent_card'?'cEDH NEW / RECENT':'cEDH PLAYED + SCOUT';
  const cls=r.watch_class==='cedh_breakout'?'leading':r.watch_class==='cedh_recent_card'?'leading':'confirming';
  const attrs=r.product_id?`class="cx-detail-stat cx-scout-deep-link" ${scoutAttrs(r)} role="button" tabindex="0" title="Open card in Scout"`:'class="cx-detail-stat"';
  const reason=r.watch_class==='cedh_breakout'?'Card adoption is increasing across imported structured cEDH lists.':r.watch_class==='cedh_recent_card'?'Relatively recent/lightly reprinted card already appearing across meaningful cEDH tournament lists; this is a baseline watch until more history accumulates.':'Established cEDH card usage paired with a useful Scout setup; not claimed as new adoption.';
  return `<div ${attrs}><span><strong>${esc(r.card_name)}</strong><small>${esc(`${r.deck_count_30d||0}/${denominator||'—'} structured lists · ${r.top16_decks_30d||0} Top 16 · ${r.copies_30d||0} copies`)}</small><small>${esc(trend)}</small></span><span><strong><span class="cx-signal-stage ${cls}">${label}</span> <span class="cx-signal-stage confirming">${esc(`PRIORITY ${r.cedh_card_priority}`)}</span></strong><small>${esc(setup)}</small><small>${esc(reason)}</small></span></div>`;
}
function section(title,sub,items,rowFn,error=''){
  const body=error?`<div class="cx-empty">Unavailable: ${esc(error)}</div>`:items.length?items.map(rowFn).join(''):'<div class="cx-empty">Nothing qualifies yet.</div>';
  return `<div class="cx-section-title">${esc(title)}</div><p class="cx-sub">${esc(sub)}</p><div class="cx-detail-list">${body}</div>`;
}

function render(){
  const h=host();if(!h||!ready())return;
  let panel=document.getElementById('cxCommanderIntel');
  if(!panel){panel=document.createElement('section');panel.id='cxCommanderIntel';panel.className='cx-card';panel.hidden=h.dataset.signalsView!=='commander';const comp=document.getElementById('cxCompetitiveIntel'),layout=h.querySelector('.cx-signals-layout');if(comp)comp.insertAdjacentElement('afterend',panel);else if(layout)layout.insertAdjacentElement('beforebegin',panel);else h.appendChild(panel)}
  const established=edhEstablished(),breakouts=edhBreakouts(),cedh=cedhEstablished(),cedhUp=cedhBreakouts(),cedhCards=cedhCardEstablished(),cedhRecent=cedhCardRecent(),cedhCardUp=cedhCardBreakouts();
  const history=edhRows.length?Math.max(0,...edhRows.map(r=>Number(r.history_days||0))):null;
  const latest=cedhEvents.slice(0,4).map(e=>`${e.event_name} · ${e.player_count||e.published_deck_count||'?'} players`).join(' · ');
  const loadHtml=loading?'<div class="cx-empty">Loading Commander Intelligence…</div>':'';
  const historyLine=edhError?`EDHREC intelligence request failed: ${esc(edhError)}`:history==null?'EDHREC history is loading or no linked Scout candidates are available.':`EDHREC history available: about ${history.toFixed(1)} days. Trend labels require at least 3 days of observed rank history.`;
  panel.innerHTML=`<div class="cx-page-head"><div><div class="cx-section-title">Commander intelligence</div><p class="cx-sub">Broad EDH demand from EDHREC plus tournament-backed cEDH adoption. Commander demand and cEDH tournament play are separate evidence sources.</p></div><button type="button" class="cx-refresh" id="cxRefreshCedh">Refresh cEDH</button></div><p class="cx-sub">${historyLine}</p>${latest?`<p class="cx-sub">Recent cEDH coverage: ${esc(latest)}</p>`:''}<p class="cx-sub">cEDH tournament data provided by <a href="https://topdeck.gg" target="_blank" rel="noopener">TopDeck.gg ↗</a>. Commander-share calculations use only entries with a known commander; hidden decklists are not treated as an archetype.</p>${loadHtml}${!loading?section('EDH played + Scout','Established Commander demand where the selected printing also has a useful Scout setup.',established,edhRow,edhError):''}${!loading?section('EDH trends / breakouts','Cards whose EDHREC rank is improving across the history MarketplaceScout has actually observed.',breakouts,edhRow,edhError):''}${!loading?section('cEDH tournament meta','Known commanders with meaningful tournament representation. Percentages use known commander entries, not hidden/unknown decklists.',cedh,cedhRow,cedhError):''}${!loading&&cedhUp.length?section('cEDH commander breakouts','Commander archetypes gaining share versus the prior imported window.',cedhUp,cedhRow,cedhError):''}${!loading&&cedhRecent.length?section('New / recent cEDH cards','Relatively recent or lightly reprinted cards already seeing meaningful cEDH tournament adoption. These are baseline watches until enough history exists to call a breakout.',cedhRecent,cedhCardRow,cedhCardError):''}${!loading?section('cEDH played + Scout','Established cards appearing across structured cEDH decklists whose selected printing also has a useful Scout setup. This does not imply new adoption.',cedhCards,cedhCardRow,cedhCardError):''}${!loading&&cedhCardUp.length?section('cEDH card breakouts','Cards whose adoption is increasing across imported structured cEDH lists and whose Scout setup makes that change financially relevant.',cedhCardUp,cedhCardRow,cedhCardError):''}<div id="cxCommanderMsg" class="cx-sub">${esc(syncMessage)}</div>`;
  document.getElementById('cxRefreshCedh')?.addEventListener('click',syncCedh);
}

async function load({force=false}={}){
  if(loading)return loading;
  if(!force&&lastLoadedAt&&Date.now()-lastLoadedAt<AUTO_REFRESH_MS){render();return edhRows}
  edhError='';cedhError='';cedhCardError='';
  loading=Promise.allSettled([
    rest('rpc/commander_edh_opportunities',{method:'POST',body:{p_limit:150}}),
    rest('rpc/cedh_commander_rollups',{method:'POST',body:{p_days:90,p_min_event_size:16}}),
    rest('rpc/cedh_card_opportunities',{method:'POST',body:{p_days:90}}),
    rest('competitive_events?select=event_name,event_date,player_count,published_deck_count,coverage_type,source_url&format=eq.cEDH&order=event_date.desc,fetched_at.desc&limit=12')
  ]).then(([e,c,cc,ev])=>{
    if(e.status==='fulfilled'&&Array.isArray(e.value))edhRows=e.value;else{edhRows=[];edhError=safeError(e.status==='rejected'?e.reason:'Unexpected EDH response')}
    if(c.status==='fulfilled'&&Array.isArray(c.value))cedhRows=c.value;else{cedhRows=[];cedhError=safeError(c.status==='rejected'?c.reason:'Unexpected cEDH response')}
    if(cc.status==='fulfilled'&&Array.isArray(cc.value))cedhCardRows=cc.value;else{cedhCardRows=[];cedhCardError=safeError(cc.status==='rejected'?cc.reason:'Unexpected cEDH card response')}
    if(ev.status==='fulfilled'&&Array.isArray(ev.value))cedhEvents=ev.value;else if(!cedhError)cedhError=safeError(ev.status==='rejected'?ev.reason:'Could not load cEDH events');
    lastLoadedAt=Date.now();
    document.dispatchEvent(new CustomEvent('collectish:commander-intel-changed',{detail:{edh:edhRows.length,cedh:cedhRows.length,cedhCards:cedhCardRows.length,edhError,cedhError,cedhCardError}}));
    return edhRows;
  }).finally(()=>{loading=null;render()});
  render();return loading;
}
async function syncCedh(){
  const btn=document.getElementById('cxRefreshCedh');const original=btn?.textContent||'Refresh cEDH';const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),65000);
  if(btn){btn.disabled=true;btn.textContent='Refreshing…'}syncMessage='Discovering cEDH events, then importing selected TopDeck standings and structured decklists…';render();
  try{
    const session=await validSession();if(!session)throw new Error('Sign in required');
    const r=await fetch(`${collectishConfig.supabaseUrl}/functions/v1/competitive-cedh-sync`,{method:'POST',signal:controller.signal,headers:{apikey:collectishConfig.publishableKey,Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},body:JSON.stringify({limit:4,days:120,min_size:16})});
    const text=await r.text();let data;try{data=text?JSON.parse(text):{}}catch{data={error:'TopDeck sync returned an unreadable response.'}};
    if(!r.ok)throw new Error(data?.error||`cEDH sync HTTP ${r.status}`);
    syncMessage=`Imported ${data.events||0} new cEDH event${Number(data.events)===1?'':'s'}, ${data.decks||0} tournament entries and ${data.cards||0} structured card rows from TopDeck.gg.${data.windows_checked?` Checked ${data.windows_checked} 30-day window${Number(data.windows_checked)===1?'':'s'}.`:''}${data.errors?` ${data.errors} event${Number(data.errors)===1?'':'s'} failed.`:''}`;
    lastLoadedAt=0;await load({force:true});document.dispatchEvent(new CustomEvent('collectish:competitive-changed',{detail:{source:'cedh',...data}}));
  }catch(e){syncMessage=e?.name==='AbortError'?'cEDH refresh timed out after 65 seconds.':safeError(e);render()}
  finally{clearTimeout(timer);const current=document.getElementById('cxRefreshCedh');if(current){current.disabled=false;current.textContent=original}}
}
function openScoutFrom(el){const detail={sku_id:el.dataset.sku||null,product_id:el.dataset.product||null,card_name:el.dataset.card||null};document.dispatchEvent(new CustomEvent('collectish:open-scout-card',{detail}))}
document.addEventListener('click',e=>{const el=e.target.closest?.('#cxCommanderIntel [data-open-scout="1"]');if(!el||e.target.closest('a,button,input,select,textarea'))return;e.preventDefault();openScoutFrom(el)},true);
document.addEventListener('keydown',e=>{if(e.key!=='Enter'&&e.key!==' ')return;const el=e.target.closest?.('#cxCommanderIntel [data-open-scout="1"]');if(!el)return;e.preventDefault();openScoutFrom(el)},true);
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals'&&ready())queueMicrotask(()=>load().catch(()=>{}))});
document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='signals')queueMicrotask(()=>load().catch(()=>{}))});
if(ready())queueMicrotask(()=>load().catch(()=>{}));
export {load as loadCommanderIntel,syncCedh};
