import { registerComponent } from '../../core/lifecycle.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const age=t=>{if(!t)return'';const ms=Math.max(0,Date.now()-new Date(t).getTime()),m=Math.round(ms/60000);if(m<2)return'just now';if(m<60)return`${m}m ago`;const h=Math.round(m/60);return h<48?`${h}h ago`:`${Math.round(h/24)}d ago`};
let loading=false,installed=false;

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
  const admin=document.getElementById('cxAdmin');if(!admin||!admin.classList.contains('active')||loading)return;
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
  }catch(e){console.warn('Admin alerts load failed',e)}finally{loading=false}
}

function install(){if(installed)return;installed=true;document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='admin')setTimeout(render,0)});document.addEventListener('collectish:ready',()=>{if(document.getElementById('cxAdmin')?.classList.contains('active'))render()});setInterval(()=>{if(document.getElementById('cxAdmin')?.classList.contains('active'))render()},5*60*1000)}

const style=document.createElement('style');style.textContent=`.cx-admin-alerts{margin:0 0 16px}.cx-admin-alert-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}.cx-admin-alert-head p{margin:2px 0 0;color:var(--cx-muted);font-size:12px}.cx-admin-alert-list{display:grid;gap:8px}.cx-admin-alert{display:flex;justify-content:space-between;gap:12px;padding:12px 14px;border:1px solid var(--cx-line);border-radius:14px;background:var(--cx-card)}.cx-admin-alert-title{display:flex;align-items:center;gap:7px}.cx-admin-alert-title small{color:var(--cx-muted);font-weight:600}.cx-admin-alert p{margin:5px 0 0;color:var(--cx-text);font-size:13px;line-height:1.35}.cx-admin-alert-dot{width:9px;height:9px;border-radius:50%;background:var(--cx-muted)}.cx-admin-alert-warning{border-color:#b7791f}.cx-admin-alert-warning .cx-admin-alert-dot{background:#d69e2e}.cx-admin-alert-critical{border-color:#c53030}.cx-admin-alert-critical .cx-admin-alert-dot{background:#e53e3e}.cx-admin-alert-info{border-color:#2b6cb0}.cx-admin-alert-info .cx-admin-alert-dot{background:#3182ce}.cx-admin-alert-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}.cx-admin-alert-actions button{min-height:40px;padding:0 12px;border:1px solid var(--cx-line);border-radius:999px;background:var(--cx-bg);color:var(--cx-text);font-weight:750}.cx-admin-alert-actions small{color:var(--cx-muted);font-size:10px}@media(max-width:700px){.cx-admin-alert{flex-direction:column}.cx-admin-alert-actions{justify-content:flex-start}}`;
document.head.appendChild(style);
registerComponent('admin-alerts',{mount:install});
