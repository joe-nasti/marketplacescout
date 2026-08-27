import { rest } from '../../core/rest.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const age=t=>{if(!t)return'—';const h=(Date.now()-new Date(t).getTime())/36e5;if(h<1)return`${Math.max(1,Math.round(h*60))}m`;if(h<48)return`${Math.round(h)}h`;return`${Math.round(h/24)}d`};
const pct=v=>v==null?'—':`${Number(v).toFixed(1)}%`;
let loading=false;

function ensure(){
  const host=document.getElementById('cxAdminSinglesModules');if(!host)return null;
  let panel=document.getElementById('cxSignalsVideoAuditAdmin');
  if(!panel){
    panel=document.createElement('section');panel.id='cxSignalsVideoAuditAdmin';panel.className='cx-admin-module cx-signals-video-audit';
    panel.innerHTML=`<div class="cx-admin-module-head"><div><h3>Signals outcomes & video audit</h3><p>What Signals woke in Scout, whether sources lead or react to demand, plus which YouTube videos Collectish evaluated.</p></div><button type="button" id="cxSignalsVideoAuditRefresh">Refresh</button></div><div id="cxSignalsOutcomeMetrics" class="cx-admin-summary-grid cx-ui-metrics"></div><div class="cx-admin-subsection"><div class="cx-admin-module-head"><div><h4>Source timing outcomes</h4><p>Empirical 7-day sales timing. Reactive means velocity was already elevated before the Signal; predictive means acceleration followed without a comparable pre-Signal spike.</p></div></div><div id="cxSignalSourceOutcomes"></div></div><div class="cx-admin-subsection"><h4>Evaluated channels</h4><div id="cxVideoChannels"></div></div><div class="cx-admin-subsection"><div class="cx-admin-module-head"><div><h4>Evaluated videos</h4><p>Newest first. Open the source to verify what Collectish analyzed.</p></div></div><div id="cxVideoEvaluations"></div></div>`;
    host.prepend(panel);panel.querySelector('#cxSignalsVideoAuditRefresh').onclick=()=>refresh(true);
  }
  return panel;
}
function metric(label,value,sub,state='neutral'){return `<div class="cx-admin-summary-card cx-ui-metric ${esc(state)}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub||'')}</small></div>`}
function sourceRow(r){
  const mature=Math.max(0,Number(r.measured_signals||0)-Number(r.pending_signals||0)-Number(r.unmeasured_signals||0));
  return `<div class="cx-admin-list-row"><div><strong>${esc(r.source_name||'Unknown source')}</strong><small>${mature} mature · ${Number(r.pending_signals||0)} pending · ${Number(r.unmeasured_signals||0)} unmeasured</small></div><div><strong>${pct(r.reactive_pct)} reactive · ${pct(r.predictive_pct)} predictive</strong><small>${pct(r.confirming_pct)} confirming · pre-7 vs prior ${pct(r.avg_pre7_vs_prior23_pct)} · post-7 vs pre-7 ${pct(r.avg_post7_vs_pre7_pct)}</small></div></div>`;
}
function channelRow(r){return `<div class="cx-admin-list-row"><div><strong>${esc(r.channel_name||'Unknown channel')}</strong><small>${esc(r.creator_lane||'unknown')} · ${esc(r.channel_id||'no channel id')}</small></div><div><strong>${Number(r.videos_evaluated||0).toLocaleString()} videos</strong><small>${Number(r.events_detected||0).toLocaleString()} events · latest ${esc(age(r.latest_evaluated_at))} ago</small></div></div>`}
function videoRow(r){const href=r.source_url?`<a href="${esc(r.source_url)}" target="_blank" rel="noopener">Open ↗</a>`:'';const types=Array.isArray(r.event_types)?r.event_types.join(', '):'';const modes=Array.isArray(r.transcript_modes)?r.transcript_modes.join(', '):'';return `<div class="cx-admin-list-row"><div><strong>${esc(r.title||r.video_id||'Untitled video')}</strong><small>${esc(r.channel_name||'Unknown channel')} · ${esc(r.creator_lane||'unknown')} · ${Number(r.events_detected||0)} events · ${Number(r.cards_detected||0)} cards</small><small>${esc(types||'No event type')} ${modes?`· ${esc(modes)}`:''}</small></div><div><strong>${esc(age(r.latest_evaluated_at))} ago</strong><small>${esc(r.video_id||'')}</small>${href}</div></div>`}

async function refresh(force=false){
  if(loading)return;const panel=ensure();if(!panel)return;loading=true;
  const metrics=panel.querySelector('#cxSignalsOutcomeMetrics'),sources=panel.querySelector('#cxSignalSourceOutcomes'),channels=panel.querySelector('#cxVideoChannels'),videos=panel.querySelector('#cxVideoEvaluations');
  metrics.innerHTML='<div class="cx-empty">Loading Signals outcomes…</div>';sources.innerHTML='<div class="cx-empty">Loading source timing…</div>';channels.innerHTML='<div class="cx-empty">Loading channels…</div>';videos.innerHTML='<div class="cx-empty">Loading evaluated videos…</div>';
  try{
    const [aRows,sRows,cRows,vRows]=await Promise.all([
      rest('rpc/admin_signal_scout_analytics',{method:'POST',body:{},force}),
      rest('market_intel_source_outcomes?select=source_name,measured_signals,pending_signals,unmeasured_signals,reactive_signals,predictive_signals,confirming_signals,flat_or_unclear_signals,reactive_pct,predictive_pct,confirming_pct,avg_pre7_vs_prior23_pct,avg_post7_vs_pre7_pct,avg_post7_market_price_change_pct,latest_signal_at&order=measured_signals.desc',{force}),
      rest('rpc/admin_video_evaluation_channels',{method:'POST',body:{},force}),
      rest('rpc/admin_video_evaluations',{method:'POST',body:{p_limit:100},force})
    ]);
    const a=aRows?.[0]||aRows||{};
    metrics.innerHTML=[
      metric('Wakes · 24h',Number(a.wakes_24h||0).toLocaleString(),`${Number(a.signals_wakes_24h||0)} Signals · ${Number(a.user_wakes_24h||0)} user`),
      metric('Completed',Number(a.wakes_completed_24h||0).toLocaleString(),a.avg_refresh_seconds!=null?`${Number(a.avg_refresh_seconds).toFixed(1)}s average request→complete`:'No completed wakes',Number(a.wakes_failed_24h||0)?'warn':'good'),
      metric('Failed',Number(a.wakes_failed_24h||0).toLocaleString(),Number(a.wakes_failed_24h||0)?'Needs attention':'No wake failures',Number(a.wakes_failed_24h||0)?'bad':'good'),
      metric('Refreshed A/B',Number(a.refreshed_ab_24h||0).toLocaleString(),'Wake outcomes that became Scout A/B'),
      metric('Latest wake',a.latest_completed_at?`${age(a.latest_completed_at)} ago`:'—',a.latest_completed_at?new Date(a.latest_completed_at).toLocaleString():'No completed wake yet')
    ].join('');
    sources.innerHTML=(sRows||[]).length?(sRows||[]).map(sourceRow).join(''):'<div class="cx-empty">No mature Signal outcome windows yet.</div>';
    channels.innerHTML=(cRows||[]).length?(cRows||[]).map(channelRow).join(''):'<div class="cx-empty">No evaluated YouTube channels yet.</div>';
    videos.innerHTML=(vRows||[]).length?(vRows||[]).map(videoRow).join(''):'<div class="cx-empty">No evaluated YouTube videos yet.</div>';
  }catch(error){const msg=`Couldn’t load Signals/video audit: ${esc(error?.message||error)}`;metrics.innerHTML=`<div class="cx-admin-error">${msg}</div>`;sources.innerHTML='';channels.innerHTML='';videos.innerHTML=''}finally{loading=false}
}

document.addEventListener('collectish:admin-modules-ready',()=>{ensure();refresh()});
document.addEventListener('collectish:admin-section-change',e=>{if(e.detail?.section==='singles')refresh()});
window.CollectishSignalsVideoAuditAdmin={refresh};
