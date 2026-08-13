(() => {
  const el=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>\"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  const ago=iso=>{if(!iso)return 'never';const m=Math.max(0,Math.round((Date.now()-new Date(iso))/60000));return m<1?'now':m<60?`${m}m ago`:m<1440?`${Math.round(m/60)}h ago`:`${Math.round(m/1440)}d ago`};
  async function load(){
    const host=el('agentStatusBody');if(!host)return;
    try{
      const collectors=await rest('collectors?select=name,last_seen_at,app_version,capabilities_json,session_health_json&collector_type=eq.browser_connector&order=last_seen_at.desc&limit=10');
      const c=(collectors||[])[0],s=c?.session_health_json||{},cap=c?.capabilities_json||{};
      const ready=Boolean(s.authenticated&&cap.tcgplayer_authenticated_session);
      host.innerHTML=`<div class="collectish-health-grid"><div class="collectish-health-card"><span>Agent</span><strong>${esc(c?.name||'No browser agent')}</strong><small>${esc(c?.app_version||'')} ${c?.last_seen_at?'• '+ago(c.last_seen_at):''}</small></div><div class="collectish-health-card"><span>Session</span><strong>${ready?'Authenticated':esc(s.state||'Unknown')}</strong><small>${s.checkedAt?'checked '+ago(s.checkedAt):''}</small></div><div class="collectish-health-card"><span>Authenticated jobs</span><strong>${ready?'Eligible':'Not eligible'}</strong><small>tcgplayer_authenticated_session</small></div></div>`;
    }catch(e){host.innerHTML=`<div class="collectish-empty">${esc(e.message)}</div>`}
  }
  function install(){
    const anchor=el('collectishConnectorRole');if(!anchor||el('collectishAgentStatus'))return false;
    const panel=document.createElement('section');panel.id='collectishAgentStatus';panel.className='card collectish-ops-panel';panel.dataset.collectishPage='operations';
    panel.innerHTML='<div class="toolbar"><div><h2>Authenticated browser agent</h2><div class="meta">Live browser-agent session health.</div></div><button id="refreshAgentStatus" type="button">Refresh</button></div><div id="agentStatusBody"><div class="meta">Loading agent status…</div></div>';
    anchor.insertAdjacentElement('afterend',panel);el('refreshAgentStatus').onclick=load;load();return true;
  }
  document.addEventListener('click',e=>{if(e.target?.dataset?.page==='operations')setTimeout(load,150)},true);
  let tries=0;const timer=setInterval(()=>{tries++;if(install()||tries>160)clearInterval(timer)},100);
})();
