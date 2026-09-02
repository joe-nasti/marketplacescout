import { registerComponent } from '../../core/lifecycle.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const age=t=>{if(!t)return'';const ms=Math.max(0,Date.now()-new Date(t).getTime()),m=Math.round(ms/60000);if(m<2)return'just now';if(m<60)return`${m}m ago`;const h=Math.round(m/60);return h<48?`${h}h ago`:`${Math.round(h/24)}d ago`};
let loading=false,installed=false,unavailable=false,scheduled=false;

function permissionDenied(error){return /permission denied|\b401\b|\b403\b/i.test(String(error?.message||error||''))}
function scheduleRender(){
  if(scheduled||unavailable)return;
  scheduled=true;
  const run=()=>{scheduled=false;void render()};
  if('requestIdleCallback' in window)requestIdleCallback(run,{timeout:3000});
  else setTimeout(run,1000);
}

async function resolveBusiness(key){
  await rest('rpc/collectish_resolve_alert',{method:'POST',body:{p_alert_key:key}});
  await render();
}

function card(a){
  const operational=a.category==='operational';
  const sev=String(a.severity||'info');
  const meta=a.metadata_json||{};
  return `<article class="cx-admin-alert cx-admin-alert-${esc(sev)}">
    <div class="cx-admin-alert-main"><div class="cx-admin-alert-title"><span class="cx-admin-alert-dot"></span><strong>${esc(a.title)}</strong><small>${esc(age(a.last_seen_at))}</small></div><p>${esc(a.message)}</p>${meta.count!=null?`<small>${esc(meta.count)} item${Number(meta.count)===1?'':'s'}${meta.gross?` · $${Number(meta.gross).toFixed(2)} gross`:''}</small>`:''}</div>
    <div class="cx-admin-alert-actions">${a.action_screen?`<button type="button" data-alert-open="${esc(a.action_screen)}">Open</button>`:''}${operational?'<small>Auto-resolves when healthy</small>':`<button type="button" data-alert-dismiss="${esc(a.alert_key)}">Dismiss</button>`}</div>
  </article>`;
}

async function render(){
  const admin=document.getElementById('cxAdmin');if(!admin||!admin.classList.contains('active')||loading||unavailable)return;
  loading=true;
  try{
    const rows=await rest('collectish_alerts?select=id,alert_key,category,severity,title,message,action_screen,metadata_json,last_seen_at,occurrence&resolved_at=is.null&order=severity.desc,last_seen_at.desc&limit=30');
    let host=admin.querySelector('#cxAdminAlerts');
    if(!host){host=document.createElement('section');host.id='cxAdminAlerts';host.className='cx-admin-alerts';const head=admin.querySelector('.cx-page-head');head?.after(host);if(!head)admin.prepend(host)}
    if(!rows?.length){host.innerHTML='';host.hidden=true;return}
    host.hidden=false;
    const ops=rows.filter(x=>x.category==='operational').length,biz=rows.length-ops;
    host.innerHTML=`<div class="cx-admin-alert-head"><div><div class="cx-section-title">Needs attention</div><p>${ops?`${ops} operational`:''}${ops&&biz?' · ':''}${biz?`${biz} business`:''}</p></div></div><div class="cx-admin-alert-list">${rows.map(card).join('')}</div>`;
    host.querySelectorAll('[data-alert-open]').forEach(b=>b.onclick=()=>window.CollectishShell?.switchPage?.(b.dataset.alertOpen));
    host.querySelectorAll('[data-alert-dismiss]').forEach(b=>b.onclick=()=>resolveBusiness(b.dataset.alertDismiss).catch(console.error));
  }catch(e){
    if(permissionDenied(e)){
      unavailable=true;
      const host=admin.querySelector('#cxAdminAlerts');if(host)host.hidden=true;
      return;
    }
    console.warn('Admin alerts load failed',e);
  }finally{loading=false}
}

function install(){if(installed)return;installed=true;document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='admin')scheduleRender()});document.addEventListener('collectish:ready',()=>{if(document.getElementById('cxAdmin')?.classList.contains('active'))scheduleRender()});setInterval(()=>{if(document.getElementById('cxAdmin')?.classList.contains('active'))scheduleRender()},5*60*1000)}

registerComponent('admin-alerts',{mount:install});
