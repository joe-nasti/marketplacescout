import { rest } from '../../core/rest.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const age=t=>{if(!t)return'Never';const h=(Date.now()-new Date(t).getTime())/36e5;if(h<1)return`${Math.max(1,Math.round(h*60))}m ago`;if(h<48)return`${Math.round(h)}h ago`;return`${Math.round(h/24)}d ago`};
let loading=false;

function ensure(){
  const host=document.getElementById('cxAdminSinglesModules');if(!host)return null;
  let panel=document.getElementById('cxScoutUniverseAdmin');
  if(!panel){
    panel=document.createElement('section');panel.id='cxScoutUniverseAdmin';panel.className='cx-admin-module cx-scout-universe-admin';
    panel.innerHTML='<div class="cx-admin-module-head"><div><h3>Scout universe</h3><p>Universal card coverage, cold baseline progress, and signal wake-ups.</p></div><button type="button" id="cxScoutUniverseRefresh">Refresh</button></div><div id="cxScoutUniverseBody" class="cx-admin-summary-grid cx-ui-metrics"></div>';
    host.prepend(panel);panel.querySelector('#cxScoutUniverseRefresh').onclick=()=>refresh(true);
  }
  return panel;
}
function metric(label,value,sub,state='neutral'){return `<div class="cx-admin-summary-card cx-ui-metric ${esc(state)}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub||'')}</small></div>`}

async function refresh(force=false){
  if(loading)return;const panel=ensure();if(!panel)return;loading=true;
  const body=panel.querySelector('#cxScoutUniverseBody');
  try{
    const rows=await rest('rpc/scout_universe_status',{method:'POST',body:{},force});const s=rows?.[0]||rows||{};
    const catalog=Number(s.catalog_rows||0),evaluated=Number(s.evaluated_rows||0),remaining=Number(s.catalog_only_rows||0),pct=Number(s.coverage_pct||0),wake=Number(s.wake_queued||0),done=Number(s.sets_completed||0),active=Number(s.sets_active||0),failed=Number(s.sets_failed||0);
    body.innerHTML=[
      metric('Catalog',catalog.toLocaleString(),'English / NM TCGplayer SKUs'),
      metric('Evaluated',evaluated.toLocaleString(),`${pct.toFixed(1)}% have a real Scout baseline`,pct>=75?'good':pct>=25?'warn':'neutral'),
      metric('Catalog-only',remaining.toLocaleString(),'Known and searchable; no fabricated grade'),
      metric('Cold sets',String(done),active?`${active} currently queued/running`:'No active cold set',active?'good':'neutral'),
      metric('Wake queue',String(wake),'Signals and user requests jump ahead',wake?'warn':'good'),
      metric('Failures',String(failed),failed?'Cold backfill needs attention':'No cold-backfill failures',failed?'bad':'good'),
      metric('Last baseline',s.last_baseline_set||'—',s.last_baseline_at?`${age(s.last_baseline_at)} · ${new Date(s.last_baseline_at).toLocaleString()}`:'No completed baseline yet')
    ].join('');
  }catch(error){body.innerHTML=`<div class="cx-admin-error">Couldn’t load Scout universe status: ${esc(error?.message||error)}</div>`}finally{loading=false}
}

document.addEventListener('collectish:admin-modules-ready',()=>{ensure();refresh()});
document.addEventListener('collectish:admin-section-change',e=>{if(e.detail?.section==='singles')refresh()});
window.CollectishScoutUniverseAdmin={refresh};
