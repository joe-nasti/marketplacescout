// Collectish Admin — database-backed Marketplace scan configuration.
(() => {
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const cadences=[[3,'Every 3h'],[6,'Every 6h'],[12,'Every 12h'],[24,'Daily'],[48,'Every 2 days'],[72,'Every 3 days'],[168,'Weekly']];
  let loading=false;
  const session=()=>{try{return JSON.parse(localStorage.getItem('collectishSession')||'null')}catch{return null}};
  const userId=()=>session()?.user?.id||'';
  const opt=(values,current)=>values.map(v=>{const [value,label]=Array.isArray(v)?v:[v,v];return `<option value="${esc(value)}" ${String(value)===String(current)?'selected':''}>${esc(label)}</option>`}).join('');
  const fmt=x=>x?new Date(x).toLocaleString():'—';

  async function rebalance(uid){
    if(!uid)return;
    await rest('rpc/rebalance_marketplace_scan_schedule',{method:'POST',body:{p_user_id:uid}});
  }

  async function saveProfile(p,row){
    const body={enabled:row.querySelector('[data-f="enabled"]').checked,cadence_hours:Number(row.querySelector('[data-f="cadence"]').value),printing:row.querySelector('[data-f="printing"]').value,condition:row.querySelector('[data-f="condition"]').value,language:row.querySelector('[data-f="language"]').value,scan_depth:row.querySelector('[data-f="depth"]').value,updated_at:new Date().toISOString()};
    await rest(`marketplace_scan_profiles?user_id=eq.${encodeURIComponent(p.user_id)}&set_slug=eq.${encodeURIComponent(p.set_slug)}`,{method:'PATCH',body});
    await rebalance(p.user_id);
    row.querySelector('.cx-scan-msg').textContent='Saved • schedule spaced';
  }

  async function scanNow(p,row){
    const profile={setName:p.set_name,setSlug:p.set_slug,printing:row.querySelector('[data-f="printing"]').value,condition:row.querySelector('[data-f="condition"]').value,language:row.querySelector('[data-f="language"]').value,scanDepth:row.querySelector('[data-f="depth"]').value,salesEnrich:0};
    const body={user_id:p.user_id,source:'marketplace',action:'scan_set',status:'queued',priority:5,required_capability:'marketplace_public_api',preferred_executor:'cloud_worker',payload_json:{profile,cloudPrimary:true,manualAdmin:true,executionClass:'cloud_public'},progress_json:{stage:'queued',percent:0,detail:`Manual Admin scan: ${p.set_name}`,updatedAt:new Date().toISOString()},attempt_count:0,max_attempts:2,available_at:new Date().toISOString()};
    await rest('collector_jobs',{method:'POST',body});
    row.querySelector('.cx-scan-msg').textContent='Queued now';
  }

  function rowHtml(p){return `<div class="cx-admin-scan-row" data-set="${esc(p.set_slug)}">
    <div class="cx-admin-scan-main"><label class="cx-admin-switch"><input data-f="enabled" type="checkbox" ${p.enabled?'checked':''}><span></span></label><div><strong>${esc(p.set_name)}</strong><small>${esc(p.set_slug)}</small></div></div>
    <label>Cadence<select data-f="cadence">${opt(cadences,p.cadence_hours)}</select></label>
    <label>Printing<select data-f="printing">${opt(['Both','Normal','Foil'],p.printing)}</select></label>
    <label>Depth<select data-f="depth">${opt(['Smart','250','500','1000','Full'],p.scan_depth)}</select></label>
    <label>Condition<select data-f="condition">${opt(['Near Mint','Lightly Played','Moderately Played'],p.condition)}</select></label>
    <label>Language<select data-f="language">${opt(['English'],p.language)}</select></label>
    <div class="cx-admin-scan-time"><small>Next due<br><b>${esc(fmt(p.next_due_at))}</b></small><small>Last queued<br><b>${esc(fmt(p.last_queued_at))}</b></small></div>
    <div class="cx-admin-scan-actions"><button class="cx-refresh" data-act="save">Save</button><button class="cx-primary" data-act="scan">Scan now</button><small class="cx-scan-msg"></small></div>
  </div>`}

  async function addSet(host){
    const name=host.querySelector('#cxAddSetName').value.trim(),slug=host.querySelector('#cxAddSetSlug').value.trim();
    if(!name||!slug)throw Error('Set name and slug are required');
    const uid=userId();if(!uid)throw Error('Sign in required');
    await rest('marketplace_scan_profiles',{method:'POST',body:{user_id:uid,set_slug:slug,set_name:name,enabled:true,cadence_hours:24,printing:'Both',condition:'Near Mint',language:'English',scan_depth:'Smart',next_due_at:null}});
    await rebalance(uid);
    await render(true);
  }

  async function render(force=false){
    if(loading&&!force)return;const admin=document.getElementById('cxAdmin');if(!admin||!admin.classList.contains('active'))return;loading=true;
    try{
      const rows=await rest('marketplace_scan_profiles?select=*&order=set_name.asc');
      let host=admin.querySelector('#cxAdminScanConfig');
      if(!host){host=document.createElement('section');host.id='cxAdminScanConfig';host.className='cx-admin-scan-card';admin.appendChild(host)}
      host.innerHTML=`<div class="cx-admin-scan-head"><div><div class="cx-section-title">Marketplace scan configuration</div><p>These settings are the source of truth for scheduled cloud set scans. Next-due slots are staggered across each cadence window.</p></div><span>${rows.length} sets</span></div>
        <div class="cx-admin-add"><input id="cxAddSetName" placeholder="Set name"><input id="cxAddSetSlug" placeholder="Set slug"><button class="cx-refresh" id="cxAddSet">Add set</button><small id="cxAddSetMsg"></small></div>
        <div class="cx-admin-scan-list">${rows.map(rowHtml).join('')||'<div class="cx-empty">No scan profiles yet.</div>'}</div>`;
      host.querySelector('#cxAddSet').onclick=async()=>{const m=host.querySelector('#cxAddSetMsg');m.textContent='';try{await addSet(host)}catch(e){m.textContent=e.message}};
      host.querySelectorAll('.cx-admin-scan-row').forEach((row,i)=>{const p=rows[i];row.querySelector('[data-act="save"]').onclick=async()=>{const m=row.querySelector('.cx-scan-msg');m.textContent='Saving…';try{await saveProfile(p,row);setTimeout(()=>render(true),350)}catch(e){m.textContent=e.message}};row.querySelector('[data-act="scan"]').onclick=async()=>{const m=row.querySelector('.cx-scan-msg');m.textContent='Queueing…';try{await saveProfile(p,row);await scanNow(p,row)}catch(e){m.textContent=e.message}}});
    }catch(e){console.error(e)}finally{loading=false}
  }

  const style=document.createElement('style');style.textContent=`
  .cx-admin-scan-card{margin-top:18px;background:var(--cx-card);border:1px solid var(--cx-line);border-radius:18px;padding:16px}
  .cx-admin-scan-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.cx-admin-scan-head p{margin:4px 0;color:var(--cx-muted)}
  .cx-admin-add{display:grid;grid-template-columns:1.3fr 1fr auto;gap:8px;align-items:center;margin:14px 0}.cx-admin-add input{min-width:0}
  .cx-admin-scan-list{display:grid;gap:10px}.cx-admin-scan-row{display:grid;grid-template-columns:minmax(210px,1.6fr) repeat(5,minmax(105px,.8fr)) minmax(180px,1.2fr) auto;gap:10px;align-items:end;border:1px solid var(--cx-line);border-radius:14px;padding:12px;background:var(--cx-bg)}
  .cx-admin-scan-row label{display:grid;gap:4px;font-size:10px;font-weight:800;color:var(--cx-muted)}.cx-admin-scan-row select{min-width:0}
  .cx-admin-scan-main{display:flex;gap:10px;align-items:center}.cx-admin-scan-main strong,.cx-admin-scan-main small{display:block}.cx-admin-scan-main small{color:var(--cx-muted);margin-top:2px}
  .cx-admin-switch input{width:18px;height:18px}.cx-admin-scan-time{display:flex;gap:12px;color:var(--cx-muted)}.cx-admin-scan-time b{color:var(--cx-text);font-weight:700}.cx-admin-scan-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.cx-scan-msg{color:var(--cx-muted);min-width:52px}
  @media(max-width:980px){.cx-admin-scan-row{grid-template-columns:1fr 1fr}.cx-admin-scan-main,.cx-admin-scan-time,.cx-admin-scan-actions{grid-column:1/-1}.cx-admin-add{grid-template-columns:1fr}.cx-admin-scan-card{padding:12px}}
  `;document.head.appendChild(style);
  const mo=new MutationObserver(()=>{if(document.getElementById('cxAdmin')?.classList.contains('active'))setTimeout(render,0)});mo.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});document.addEventListener('click',e=>{if(e.target.closest?.('[data-cx-page="admin"]'))setTimeout(render,50)},true);
})();
