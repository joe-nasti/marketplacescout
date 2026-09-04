import {rest} from '../../core/rest.js';

const esc=value=>String(value??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
const money=value=>value==null||value===''||!Number.isFinite(Number(value))?'—':Number(value).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
const pct=value=>value==null||!Number.isFinite(Number(value))?'—':`${Number(value)>=0?'+':''}${Number(value).toFixed(1)}%`;
const when=value=>{const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';return d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})};
const duration=value=>{const h=Number(value);if(!Number.isFinite(h))return '—';if(h<1)return `${Math.max(1,Math.round(h*60))}m`;if(h<48)return `${h.toFixed(h<10?1:0)}h`;return `${(h/24).toFixed(h<168?1:0)}d`};
let request=0;

function reasonCopy(reasons=[]){
  const map={baseline:'History starts',model_version:'Model changed',score:'Score moved',grade:'Grade changed',flag:'Thesis changed',confidence:'Confidence changed',buylist_backing:'Buylist backing changed',direct_backing:'Direct backing changed',near_direct_backing:'Direct floor changed',source_verification:'Source verification changed',direct_price:'Direct price moved',market_price:'Market price moved',ck_buylist:'CK buylist moved',direct_supply:'Direct supply moved',velocity:'Sales velocity moved',daily_checkpoint:'Daily checkpoint'};
  return reasons.map(x=>map[x]||String(x).replace(/_/g,' ')).join(' · ');
}

function forwardBits(forward){
  const h=forward?.horizons||{};
  return ['6h','24h','72h','7d'].map(label=>{
    const x=h[label];
    if(!x?.outcome_at)return null;
    const bits=[];
    if(x.market_change_pct!=null)bits.push(`Market ${pct(x.market_change_pct)}`);
    if(x.landed_change_pct!=null)bits.push(`Low ${pct(x.landed_change_pct)}`);
    if(x.direct_change_pct!=null)bits.push(`Direct ${pct(x.direct_change_pct)}`);
    return bits.length?`<span><b>${esc(label)}</b> ${esc(bits.join(' · '))}</span>`:null;
  }).filter(Boolean).join('');
}

function attributionBits(attr){
  const rows=Array.isArray(attr?.evidence)?attr.evidence:[];
  if(!rows.length)return '';
  return rows.slice(0,3).map(x=>`<span><b>${esc(x.source||x.type||'Evidence')}</b> ${esc(x.label||'Pre-open evidence')} · ${esc(x.lead_bucket||'')}</span>`).join('');
}

function episodeCard(ep,attr,conv){
  const entry=ep?.entry||{},f=ep?.followthrough||{},open=ep?.status==='open',associated=attributionBits(attr);
  const moves=[f.best_market_pct!=null?`Best market ${pct(f.best_market_pct)}`:null,f.worst_market_pct!=null?`Worst market ${pct(f.worst_market_pct)}`:null,f.best_landed_pct!=null?`Best low ${pct(f.best_landed_pct)}`:null].filter(Boolean).join(' · ');
  const entryBits=[`Entry ${entry.grade||'—'}/${entry.score??'—'}`,entry.flag,entry.market_price!=null?`Market ${money(entry.market_price)}`:null,entry.landed_low!=null?`Low ${money(entry.landed_low)}`:null].filter(Boolean).join(' · ');
  const convergence=conv?`<span class="cx-scout-convergence"><b>Convergence ${esc(conv.convergence_score??0)}</b> · ${esc(String(conv.convergence_class||'').replace(/-/g,' '))}</span>`:'';
  return `<div class="cx-scout-episode-card ${open?'is-open':'is-closed'}">
    <div class="cx-scout-episode-top"><strong>${open?'Open opportunity':'Closed opportunity'}</strong><span>${esc(duration(ep.duration_hours))}${open?' old':''}</span></div>
    <b>${esc(entryBits)}</b>
    <small>Opened ${esc(when(ep.opened_at))}${ep.closed_at?` · Closed ${esc(when(ep.closed_at))}`:''} · Peak Scout ${esc(ep.peak_scout_score??'—')}</small>
    ${moves?`<small>${esc(moves)}</small>`:''}
    ${convergence}
    ${associated?`<div class="cx-scout-episode-evidence"><em>Associated pre-open evidence</em>${associated}</div>`:''}
  </div>`;
}

function card(e){
  const ev=e.evidence||{},components=e.components||{},forward=forwardBits(e.forward);
  const evidence=[`Direct ${money(ev.direct_low)}`,`Market ${money(ev.market_price)}`,ev.direct_available!=null?`${Number(ev.direct_available).toLocaleString()} Direct copies`:null,ev.sales_per_day!=null?`${Number(ev.sales_per_day).toFixed(2)}/day sold`:null,ev.ck_buylist!=null?`CK buy ${money(ev.ck_buylist)}`:null].filter(Boolean).join(' · ');
  const componentBits=[components.thesis!=null?`Thesis ${Number(components.thesis).toFixed(1)}`:null,components.direct_execution!=null?`Execution ${Number(components.direct_execution).toFixed(1)}`:null,components.buylist_backing!=null?`Buylist ${Number(components.buylist_backing).toFixed(1)}`:null,components.confirmation!=null?`Confirm ${Number(components.confirmation).toFixed(1)}`:null].filter(Boolean).join(' · ');
  return `<div class="cx-scout-replay-card">
    <div class="cx-scout-replay-score"><strong>${esc(e.grade||'—')}</strong><span>${e.score==null?'—':esc(e.score)}</span></div>
    <div class="cx-scout-replay-copy">
      <div class="cx-scout-replay-top"><strong>${esc(reasonCopy(e.change_reasons)||'Scout evaluation')}</strong><span>${esc(when(e.event_at))}</span></div>
      <b>${esc(e.flag||e.confidence||'Scout evaluation')}</b>
      ${componentBits?`<small>${esc(componentBits)}</small>`:''}
      ${evidence?`<small>${esc(evidence)}</small>`:''}
      ${forward?`<div class="cx-scout-replay-forward">${forward}</div>`:''}
      <em>${esc(e.model_version||'Scout model')}</em>
    </div>
  </div>`;
}

function render(data,outcomes,episodes,attribution,convergence){
  const evaluations=Array.isArray(data?.evaluations)?data.evaluations:[];
  const outcomeRows=Array.isArray(outcomes?.evaluations)?outcomes.evaluations:[];
  const episodeRows=Array.isArray(episodes?.episodes)?episodes.episodes:[];
  const attrRows=Array.isArray(attribution?.episodes)?attribution.episodes:[];
  const convRows=Array.isArray(convergence?.recent_episodes)?convergence.recent_episodes:[];
  const outcomeMap=new Map(outcomeRows.map(x=>[String(x.event_at),x]));
  const attrMap=new Map(attrRows.map(x=>[String(x.episode_id),x]));
  const convMap=new Map(convRows.map(x=>[String(x.episode_id),x]));
  const recent=evaluations.slice(-8).reverse().map(e=>({...e,forward:outcomeMap.get(String(e.event_at))||null}));
  const body=recent.length?recent.map(card).join(''):'<div class="cx-scout-replay-empty">No preserved Scout evaluations in this window yet.</div>';
  const matured=outcomeRows.some(x=>Object.values(x?.horizons||{}).some(h=>h?.outcome_at));
  const episodeBody=episodeRows.length?episodeRows.slice(0,3).map(ep=>episodeCard(ep,attrMap.get(String(ep.episode_id)),convMap.get(String(ep.episode_id)))).join(''):'';
  return `<section class="cx-v5-section cx-scout-replay">
    <div class="cx-section-title">Scout decision history</div>
    <p class="cx-sub">What Scout actually scored and saw at each preserved evaluation. History begins when append-only capture was enabled.</p>
    <div class="cx-scout-replay-meta"><span>${Number(data?.evaluation_count||0).toLocaleString()} preserved evaluations</span><span>Material changes + daily checkpoints</span>${episodeRows.length?`<span>${episodeRows.length} opportunity episode${episodeRows.length===1?'':'s'}</span>`:''}${matured?'<span>Forward outcomes measured</span>':''}</div>
    ${episodeBody?`<div class="cx-scout-episodes"><div class="cx-scout-episodes-title">Opportunity episodes</div>${episodeBody}<small class="cx-scout-episode-note">Convergence is descriptive evidence diversity/recency, not a prediction probability. Pre-open evidence is association/context, not proof that a source caused the opportunity.</small></div>`:''}
    <div class="cx-scout-replay-list">${body}</div>
    ${evaluations.length>8?'<small class="cx-scout-replay-more">Showing the 8 most recent evaluations.</small>':''}
    ${matured?'<small class="cx-scout-replay-method">Forward changes use the nearest exact-SKU official observation at or after each horizon; they are market follow-through, not assumed realized returns.</small>':''}
  </section>`;
}

async function decorate(event){
  const host=document.getElementById('cxParityDetail'),row=event.detail?.row;
  host?.querySelector('.cx-scout-replay')?.remove();
  if(!host||!row?.sku_id)return;
  const seq=++request;
  try{
    const [data,outcomes,episodes,attribution,convergence]=await Promise.all([
      rest('rpc/ask_collectish_scout_evaluation_history_v1',{method:'POST',body:{p_sku_id:String(row.sku_id),p_days:365}}),
      rest('rpc/ask_collectish_scout_forward_outcomes_v1',{method:'POST',body:{p_sku_id:String(row.sku_id),p_days:365}}).catch(()=>null),
      rest('rpc/ask_collectish_scout_opportunity_episodes_v1',{method:'POST',body:{p_sku_id:String(row.sku_id),p_days:365,p_limit:20}}).catch(()=>null),
      rest('rpc/ask_collectish_scout_episode_attribution_v1',{method:'POST',body:{p_sku_id:String(row.sku_id),p_days:365,p_limit:20}}).catch(()=>null),
      rest('rpc/ask_collectish_scout_convergence_analytics_v1',{method:'POST',body:{p_days:365,p_limit:500}}).catch(()=>null)
    ]);
    if(seq!==request||!document.getElementById('cxParityDetail'))return;
    const section=document.createRange().createContextualFragment(render(data,outcomes,episodes,attribution,convergence)).firstElementChild;
    const anchor=host.querySelector('.cx-market-timeline')||host.querySelector('.cx-vendor-depth')||host.querySelector('.cx-scout-market-board');
    if(anchor)anchor.insertAdjacentElement('afterend',section);else host.appendChild(section);
  }catch(error){console.warn('Scout decision history unavailable',error)}
}

const style=document.createElement('style');
style.textContent=`.cx-scout-replay-meta{display:flex;gap:8px;flex-wrap:wrap;margin:7px 0 9px;color:var(--cx-muted);font-size:10px}.cx-scout-replay-meta span{border:1px solid var(--cx-line);border-radius:999px;padding:3px 7px}.cx-scout-episodes{display:grid;gap:6px;margin:8px 0 10px}.cx-scout-episodes-title{font-size:11px;font-weight:800}.cx-scout-episode-card{border:1px solid var(--cx-line);border-radius:10px;padding:7px 8px;background:var(--cx-bg)}.cx-scout-episode-card.is-open{border-color:var(--cx-accent);background:color-mix(in srgb,var(--cx-accent) 6%,var(--cx-bg))}.cx-scout-episode-top{display:flex;justify-content:space-between;gap:8px}.cx-scout-episode-top strong{font-size:11px}.cx-scout-episode-top span,.cx-scout-episode-card small{font-size:10px;color:var(--cx-muted)}.cx-scout-episode-card>b,.cx-scout-episode-card small{display:block;margin-top:3px}.cx-scout-convergence{display:inline-block;margin-top:5px;font-size:9px;border:1px solid var(--cx-accent);border-radius:999px;padding:3px 6px;background:color-mix(in srgb,var(--cx-accent) 6%,var(--cx-bg))}.cx-scout-convergence b{font-size:9px}.cx-scout-episode-evidence{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}.cx-scout-episode-evidence em{width:100%;font-size:9px;color:var(--cx-muted);font-style:normal}.cx-scout-episode-evidence span{font-size:9px;border:1px solid var(--cx-line);border-radius:999px;padding:3px 6px}.cx-scout-episode-note{display:block;color:var(--cx-muted);font-size:9px}.cx-scout-replay-list{display:grid;gap:7px}.cx-scout-replay-card{display:grid;grid-template-columns:46px minmax(0,1fr);gap:9px;border:1px solid var(--cx-line);border-radius:11px;padding:8px;background:var(--cx-bg)}.cx-scout-replay-score{display:flex;flex-direction:column;align-items:center;justify-content:center;border-right:1px solid var(--cx-line)}.cx-scout-replay-score strong{font-size:18px}.cx-scout-replay-score span{font-size:11px;color:var(--cx-muted)}.cx-scout-replay-copy{min-width:0}.cx-scout-replay-top{display:flex;justify-content:space-between;gap:8px}.cx-scout-replay-top strong{font-size:11px}.cx-scout-replay-top span,.cx-scout-replay-copy small,.cx-scout-replay-copy em{color:var(--cx-muted);font-size:10px}.cx-scout-replay-copy>b,.cx-scout-replay-copy small,.cx-scout-replay-copy em{display:block;margin-top:3px}.cx-scout-replay-copy em{font-style:normal}.cx-scout-replay-forward{display:flex;gap:5px;flex-wrap:wrap;margin-top:5px}.cx-scout-replay-forward span{font-size:9px;border:1px solid var(--cx-line);border-radius:999px;padding:3px 6px}.cx-scout-replay-forward b{font-size:9px}.cx-scout-replay-more,.cx-scout-replay-empty,.cx-scout-replay-method{display:block;color:var(--cx-muted);margin-top:7px;font-size:10px}.cx-scout-replay-method{padding-top:6px;border-top:1px solid var(--cx-line)}@media(max-width:520px){.cx-scout-replay-top,.cx-scout-episode-top{display:block}.cx-scout-replay-top span,.cx-scout-episode-top span{display:block;margin-top:2px}}`;
document.head.appendChild(style);
document.addEventListener('collectish:scout-detail-rendered',event=>void decorate(event));
