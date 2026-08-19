// Collectish Scout freshness monitor — verifies actual promoted cache, not just workflow state.
(() => {
  const WARN_MIN=90, BAD_MIN=120;
  let timer=0,last=null;
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const ageMin=t=>t?Math.max(0,(Date.now()-new Date(t).getTime())/60000):Infinity;
  const rel=t=>{if(!t)return'Never';const m=Math.round(ageMin(t));return m<60?`${Math.max(1,m)}m ago`:`${Math.round(m/60)}h ago`};
  const secs=ms=>ms==null?'—':`${(Number(ms)/1000).toFixed(1)}s`;
  async function read(){
    const [cacheRows,stateRows]=await Promise.all([
      rest('scout_opportunities_v5_cache?select=v5_computed_at&order=v5_computed_at.desc.nullslast&limit=1').catch(()=>[]),
      rest('mtgjson_sync_state?select=feed,status,last_started_at,last_completed_at,detail&feed=in.(scout_rankings,scout_rankings_watchdog)').catch(()=>[])
    ]);
    const cacheAt=cacheRows?.[0]?.v5_computed_at||null;
    const primary=(stateRows||[]).find(x=>x.feed==='scout_rankings')||{};
    const watchdog=(stateRows||[]).find(x=>x.feed==='scout_rankings_watchdog')||{};
    const mins=ageMin(cacheAt);
    const state=primary.status==='failed'||!cacheAt||mins>BAD_MIN?'bad':mins>WARN_MIN?'warn':'good';
    return {cacheAt,mins,state,primary,watchdog};
  }
  function scoutBanner(x){
    const host=document.getElementById('cxScout');if(!host)return;
    let b=document.getElementById('cxScoutFreshnessAlert');
    if(x.state==='good'){b?.remove();return}
    if(!b){b=document.createElement('div');b.id='cxScoutFreshnessAlert';b.style.cssText='margin:8px 0 12px;padding:10px 12px;border-radius:12px;font-size:12px;font-weight:700';const head=host.querySelector('.cx-page-head');head?.insertAdjacentElement('afterend',b)}
    b.style.background=x.state==='bad'?'#fff1f0':'#fff8e6';b.style.border=`1px solid ${x.state==='bad'?'#ef9a9a':'#e7b85a'}`;b.style.color='#5b3a16';
    const phase=x.primary?.detail?.failed_phase||x.primary?.detail?.phase||'';
    b.textContent=x.state==='bad'?`Scout rankings stale — promoted cache ${rel(x.cacheAt)}${phase?` · ${phase}`:''}`:`Scout rankings aging — promoted cache ${rel(x.cacheAt)}`;
  }
  function adminCard(x){
    const grid=document.getElementById('cxAdminOverviewCards');if(!grid)return;
    let card=document.getElementById('cxAdminScoutHealth');
    if(!card){card=document.createElement('div');card.id='cxAdminScoutHealth';grid.prepend(card)}
    card.className=`cx-admin-summary-card ${x.state}`;
    const d=x.primary?.detail||{},dur=d.durations_ms||{};
    const failed=d.failed_phase?` · failed ${d.failed_phase}`:'';
    card.innerHTML=`<span>Scout rankings</span><strong>${x.state==='good'?'Healthy':x.state==='warn'?'Aging':'STALE'}</strong><small>Cache ${esc(rel(x.cacheAt))}${esc(failed)}<br>agg ${esc(secs(dur['24h_aggregation']))} · v5 ${esc(secs(dur['v5_shadow']))} · cache ${esc(secs(dur['promoted_cache']))}</small>`;
    const overall=document.getElementById('cxAdminOverallState');if(overall&&x.state==='bad'){overall.textContent='ATTENTION';overall.className='cx-admin-console-state attention'}
  }
  async function check(){try{last=await read();scoutBanner(last);adminCard(last)}catch(e){console.warn('Scout health monitor',e)}}
  function schedule(){clearTimeout(timer);timer=setTimeout(async()=>{await check();if(!document.hidden)schedule()},60000)}
  document.addEventListener('collectish:ready',()=>{setTimeout(check,400);schedule()});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){check();schedule()}});
  document.addEventListener('click',e=>{if(e.target.closest('[data-cx-page="scout"],[data-cx-page="admin"],#cxScoutRefresh'))setTimeout(check,350)},true);
  new MutationObserver(()=>{if(last)adminCard(last)}).observe(document.documentElement,{childList:true,subtree:true});
})();
