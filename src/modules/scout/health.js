import { rest } from '../../core/rest.js';

const WARN_MIN=75;
const BAD_MIN=105;
const PRICE_WARN_MIN=30*60;
const SALES_WARN_MIN=5*60;
const VOLATILITY_WARN_MIN=9*60;
const INITIAL_DELAY_MS=8000;
let timer=0;
let last=null;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
const ageMin=t=>t?Math.max(0,(Date.now()-new Date(t).getTime())/60000):Infinity;
const rel=t=>{if(!t)return'Never';const m=Math.round(ageMin(t));if(m<60)return`${Math.max(1,m)}m ago`;const h=Math.round(m/60);return h<48?`${h}h ago`:`${Math.round(h/24)}d ago`};
const secs=ms=>ms==null?'—':`${(Number(ms)/1000).toFixed(1)}s`;
const pipe=(row,warn)=>{const at=row?.last_completed_at||null,attemptAt=row?.last_started_at||null,mins=ageMin(at),bad=row?.status==='failed'||row?.status==='paused'||!at||mins>warn;return{...(row||{}),at,attemptAt,mins,state:bad?'warn':'good'}};
function clockText(row,{successAt=row?.at||null,cadence=''}={}){const status=String(row?.status||'').toLowerCase(),attemptAt=row?.attemptAt||row?.last_started_at||null,suffix=cadence?` · ${cadence}`:'';if(status==='failed')return`Failed ${rel(attemptAt)} · last good ${rel(successAt)}${suffix}`;if(status==='paused')return`Paused · last good ${rel(successAt)}${suffix}`;if(!successAt)return`Never completed${suffix}`;return`${rel(successAt)}${suffix}`}
export async function readScoutHealth(){
  const [cacheRows,stateRows,priceRows]=await Promise.all([
    rest('scout_opportunities_v5_cache?select=v5_computed_at&order=v5_computed_at.desc.nullslast&limit=1').catch(()=>[]),
    rest('mtgjson_sync_state?select=feed,status,last_started_at,last_completed_at,detail&feed=in.(scout_rankings,scout_rankings_watchdog,marketplace_sales_history,scout_volatility)').catch(()=>[]),
    rest('tcgcsv_sync_state?select=feed,status,source_updated_at,last_started_at,last_completed_at,detail&feed=eq.tcgplayer_prices&limit=1').catch(()=>[])
  ]);
  const cacheAt=cacheRows?.[0]?.v5_computed_at||null;
  const primary=(stateRows||[]).find(x=>x.feed==='scout_rankings')||{};
  const watchdog=(stateRows||[]).find(x=>x.feed==='scout_rankings_watchdog')||{};
  const sales=pipe((stateRows||[]).find(x=>x.feed==='marketplace_sales_history'),SALES_WARN_MIN);
  const volatility=pipe((stateRows||[]).find(x=>x.feed==='scout_volatility'),VOLATILITY_WARN_MIN);
  const price=priceRows?.[0]||{};
  const mins=ageMin(cacheAt);
  const state=primary.status==='failed'||!cacheAt||mins>BAD_MIN?'bad':mins>WARN_MIN?'warn':'good';
  const priceAt=price.source_updated_at||price.last_completed_at||null;
  const priceMins=ageMin(priceAt);
  const priceState=price.status==='failed'||price.status==='paused'||!priceAt||priceMins>PRICE_WARN_MIN?'warn':'good';
  return{cacheAt,mins,state,primary,watchdog,price:{...price,priceAt,at:priceAt,attemptAt:price.last_started_at||null,mins:priceMins,state:priceState},sales,volatility};
}
function relabelScoreTimestamp(host){const sub=host?.querySelector('.cx-page-head .cx-sub');if(sub&&/^v5 updated\s/i.test(sub.textContent||''))sub.textContent=(sub.textContent||'').replace(/^v5 updated\s/i,'Score generated ')}
function renderFreshnessStrip(x){
  const host=document.getElementById('cxScout');if(!host)return;relabelScoreTimestamp(host);
  let strip=document.getElementById('cxScoutFreshnessStrip');
  if(!strip){strip=document.createElement('div');strip.id='cxScoutFreshnessStrip';strip.style.cssText='margin:6px 0 10px;display:flex;gap:8px;flex-wrap:wrap;font-size:11px;line-height:1.35;color:var(--cx-text-muted,#75869a)';host.querySelector('.cx-page-head')?.insertAdjacentElement('afterend',strip)}
  const scoreTone=x.state==='bad'?'#b42318':x.state==='warn'?'#9a6700':'inherit';
  const tone=row=>row?.state==='warn'?'#9a6700':'inherit';
  const item=(label,row,text)=>`<span style="color:${tone(row)}"><strong>${esc(label)}</strong> · ${esc(text)}</span>`;
  const items=[`<span style="color:${scoreTone}"><strong>Scout score</strong> · ${esc(rel(x.cacheAt))}${x.state==='bad'?' · STALE':''}</span>`,item('TCGplayer prices',x.price,clockText(x.price,{successAt:x.price?.priceAt,cadence:'daily TCGCSV'})),item('Sales',x.sales,clockText(x.sales,{cadence:'3h cadence'})),item('Volatility',x.volatility,clockText(x.volatility,{cadence:'6h cadence'}))];
  strip.innerHTML=items.join('<span aria-hidden="true">•</span>');
}
function renderScoutBanner(x){const host=document.getElementById('cxScout');if(!host)return;renderFreshnessStrip(x);let banner=document.getElementById('cxScoutFreshnessAlert');if(x.state==='good'){banner?.remove();return}if(!banner){banner=document.createElement('div');banner.id='cxScoutFreshnessAlert';banner.style.cssText='margin:8px 0 12px;padding:10px 12px;border-radius:12px;font-size:12px;font-weight:700';const strip=document.getElementById('cxScoutFreshnessStrip');(strip||host.querySelector('.cx-page-head'))?.insertAdjacentElement('afterend',banner)}banner.style.background=x.state==='bad'?'#fff1f0':'#fff8e6';banner.style.border=`1px solid ${x.state==='bad'?'#ef9a9a':'#e7b85a'}`;banner.style.color='#5b3a16';const phase=x.primary?.detail?.failed_phase||x.primary?.detail?.phase||'';banner.textContent=x.state==='bad'?`Scout score is stale — score cache ${rel(x.cacheAt)}${phase?` · ${phase}`:''}. Supporting data clocks are tracked separately.`:`Scout score is aging — score cache ${rel(x.cacheAt)}. Supporting data clocks are tracked separately.`}
function renderAdminCard(x){const grid=document.getElementById('cxAdminOverviewCards');if(!grid)return;let card=document.getElementById('cxAdminScoutHealth');if(!card){card=document.createElement('div');card.id='cxAdminScoutHealth';grid.prepend(card)}card.className=`cx-admin-summary-card ${x.state}`;const detail=x.primary?.detail||{},durations=detail.durations_ms||{},failed=detail.failed_phase?` · failed ${detail.failed_phase}`:'';card.innerHTML=`<span>Scout freshness</span><strong>${x.state==='good'?'Healthy':x.state==='warn'?'Score aging':'SCORE STALE'}</strong><small>Score ${esc(rel(x.cacheAt))}${esc(failed)}<br>TCGplayer ${esc(clockText(x.price,{successAt:x.price?.priceAt,cadence:'daily TCGCSV'}))}<br>Sales ${esc(clockText(x.sales,{cadence:'every 3h'}))}<br>Volatility ${esc(clockText(x.volatility,{cadence:'every 6h'}))}<br>agg ${esc(secs(durations['24h_aggregation']))} · v5 ${esc(secs(durations['v5_shadow']))} · cache ${esc(secs(durations['promoted_cache']))}</small>`;const overall=document.getElementById('cxAdminOverallState');if(overall&&(x.state==='bad'||x.price?.state==='warn'||x.sales?.state==='warn'||x.volatility?.state==='warn')){overall.textContent='ATTENTION';overall.className='cx-admin-console-state attention'}}
export function renderScoutHealth(x=last){if(!x)return;renderScoutBanner(x);renderAdminCard(x)}
export async function checkScoutHealth(){try{last=await readScoutHealth();renderScoutHealth(last);document.dispatchEvent(new CustomEvent('collectish:scout-health',{detail:last}));return last}catch(error){console.warn('Scout health monitor',error);return null}}
function schedule(){clearTimeout(timer);if(document.hidden)return;timer=setTimeout(async()=>{await checkScoutHealth();schedule()},60000)}
function scheduleInitial(){clearTimeout(timer);timer=setTimeout(async()=>{if(!document.hidden)await checkScoutHealth();schedule()},INITIAL_DELAY_MS)}
export function installScoutHealthMonitor(){document.addEventListener('collectish:ready',scheduleInitial);document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(timer);return}if(last){renderScoutHealth(last);schedule()}else scheduleInitial()});document.addEventListener('click',e=>{if(e.target.closest?.('[data-cx-page="admin"],#cxScoutRefresh'))setTimeout(checkScoutHealth,350)},true);document.addEventListener('collectish:admin-section-change',()=>setTimeout(()=>renderScoutHealth(last),0))}
installScoutHealthMonitor();
