// Collectish Admin — catalog-backed Marketplace scan configuration.
(() => {
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const cadences=[[3,'Every 3h'],[6,'Every 6h'],[12,'Every 12h'],[24,'Daily'],[48,'Every 2 days'],[72,'Every 3 days'],[168,'Weekly']];
  let loading=false,searchText='';
  const session=()=>{try{return JSON.parse(localStorage.getItem('collectishSession')||'null')}catch{return null}};
  const userId=()=>session()?.user?.id||'';
  const opt=(values,current)=>values.map(v=>{const [value,label]=Array.isArray(v)?v:[v,v];return `<option value="${esc(value)}" ${String(value)===String(current)?'selected':''}>${esc(label)}</option>`}).join('');
  const fmt=x=>x?new Date(x).toLocaleString():'—';
  const defaults=c=>({user_id:userId(),set_slug:c.tcgplayer_slug,set_name:c.name,enabled:false,cadence_hours:24,printing:'Both',condition:'Near Mint',language:'English',scan_depth:'Smart',next_due_at:null,last_queued_at:null});

  async function rebalance(){
    try{await rest('rpc/rebalance_marketplace_scan_schedule',{method:'POST',body:{}})}catch(e){console.warn('Scan schedule rebalance failed',e)}
  }

  async function createProfile(c,enabled=true){
    const uid=userId();if(!uid)throw Error('Sign in required');
    const body={user_id:uid,set_slug:c.tcgplayer_slug,set_name:c.name,enabled,cadence_hours:24,printing:'Both',condition:'Near Mint',language:'English',scan_depth:'Smart',next_due_at:null,updated_at:new Date().toISOString()};
    await rest('marketplace_scan_profiles?on_conflict=user_id,set_slug',{method:'POST',body,prefer:'resolution=merge-duplicates,return=minimal'});
    await rebalance();
  }

  async function setEnabled(c,p,row,on){
    const msg=row.querySelector('.cx-scan-msg');
    msg.textContent=on?'Enabling…':'Disabling…';
    if(!p){await createProfile(c,on)}
    else{
      await rest(`marketplace_scan_profiles?user_id=eq.${encodeURIComponent(p.user_id)}&set_slug=eq.${encodeURIComponent(p.set_slug)}`,{method:'PATCH',body:{enabled:on,next_due_at:null,updated_at:new Date().toISOString()}});
      await rebalance();
    }
    await render();
  }

  async function saveProfile(p,row){
    if(!p)throw Error('Enable this set first');
    const body={enabled:row.querySelector('[data-f="enabled"]').checked,cadence_hours:Number(row.querySelector('[data-f="cadence"]').value),printing:row.querySelector('[data-f="printing"]').value,condition:row.querySelector('[data-f="condition"]').value,language:row.querySelector('[data-f="language"]').value,scan_depth:row.querySelector('[data-f="depth"]').value,next_due_at:null,updated_at:new Date().toISOString()};
    await rest(`marketplace_scan_profiles?user_id=eq.${encodeURIComponent(p.user_id)}&set_slug=eq.${encodeURIComponent(p.set_slug)}`,{method:'PATCH',body});
    await rebalance();
    row.querySelector('.cx-scan-msg').textContent='Saved';
  }

  async function scanNow(p,row){
    if(!p)throw Error('Enable this set first');
    const profile={setName:p.set_name,setSlug:p.set_slug,printing:row.querySelector('[data-f="printing"]').value,condition:row.querySelector('[data-f="condition"]').value,language:row.querySelector('[data-f="language"]').value,scanDepth:row.querySelector('[data-f="depth"]').value,salesEnrich:0};
    const body={user_id:p.user_id,source:'marketplace',action:'scan_set',status:'queued',priority:5,required_capability:'marketplace_public_api',preferred_executor:'cloud_worker',payload_json:{profile,cloudPrimary:true,manualAdmin:true,executionClass:'cloud_public'},progress_json:{stage:'queued',percent:0,detail:`Manual Admin scan: ${p.set_name}`,updatedAt:new Date().toISOString()},attempt_count:0,max_attempts:2,available_at:new Date().toISOString()};
    await rest('collector_jobs',{method:'POST',body});
    row.querySelector('.cx-scan-msg').textContent='Queued now';
  }

  function rowHtml(item){
    const c=item.catalog,p=item.profile,configured=Boolean(p),enabled=Boolean(p?.enabled),v=p||defaults(c),disabled=!enabled?'disabled':'';
    return `<div class="cx-admin-scan-row ${configured?'cx-admin-configured':'cx-admin-unconfigured'} ${enabled?'cx-admin-enabled':''}" data-set="${esc(c.tcgplayer_slug)}" data-name="${esc(c.name.toLowerCase())}">
      <div class="cx-admin-scan-main"><label class="cx-admin-switch"><input data-f="enabled" type="checkbox" ${enabled?'checked':''}><span></span></label><div><strong>${esc(c.name)}</strong><small>${esc(c.code||'')} ${c.released_at?`• ${esc(c.released_at)}`:''}${c.set_type?` • ${esc(c.set_type)}`:''}</small></div></div>
      <label>Cadence<select data-f="cadence" ${disabled}>${opt(cadences,v.cadence_hours)}</select></label>
      <label>Printing<select data-f="printing" ${disabled}>${opt(['Both','Normal','Foil'],v.printing)}</select></label>
      <label>Depth<select data-f="depth" ${disabled}>${opt(['Smart','250','500','1000','Full'],v.scan_depth)}</select></label>
      <label>Condition<select data-f="condition" ${disabled}>${opt(['Near Mint','Lightly Played','Moderately Played'],v.condition)}</select></label>
      <label>Language<select data-f="language" ${disabled}>${opt(['English'],v.language)}</select></label>
      <div class="cx-admin-scan-time"><small>Next due<br><b>${enabled?esc(fmt(v.next_due_at)):'Disabled'}</b></small><small>Last queued<br><b>${esc(fmt(v.last_queued_at))}</b></small></div>
      <div class="cx-admin-scan-actions"><button class="cx-refresh" data-act="save" ${disabled}>Save</button><button class="cx-primary" data-act="scan" ${disabled}>Scan now</button><small class="cx-scan-msg">${configured&&!enabled?'Configured, disabled':!configured?'Not configured':''}</small></div>
    </div>`;
  }

  function mergeRows(catalog,profiles){
    const bySlug=new Map((profiles||[]).map(p=>[String(p.set_slug||''),p]));
    const byName=new Map((profiles||[]).map(p=>[String(p.set_name||'').toLowerCase(),p]));
    const used=new Set();
    const out=(catalog||[]).map(c=>{
      const p=bySlug.get(String(c.tcgplayer_slug||''))||byName.get(String(c.name||'').toLowerCase())||null;
      if(p)used.add(p.set_slug);
      return {catalog:c,profile:p};
    });
    for(const p of profiles||[]){
      if(used.has(p.set_slug))continue;
      out.push({catalog:{name:p.set_name,code:'',set_type:'existing profile',released_at:null,tcgplayer_slug:p.set_slug},profile:p});
    }
    return out.sort((a,b)=>a.catalog.name.localeCompare(b.catalog.name,undefined,{sensitivity:'base'}));
  }

  async function render(){
    if(loading)return;const admin=document.getElementById('cxAdmin');if(!admin||!admin.classList.contains('active'))return;loading=true;
    try{
      const [catalog,profiles]=await Promise.all([
        rest('magic_set_catalog?select=scryfall_id,code,name,set_type,released_at,tcgplayer_group_id,tcgplayer_slug&digital=eq.false&tcgplayer_group_id=not.is.null&order=name.asc'),
        rest('marketplace_scan_profiles?select=*&order=set_name.asc')
      ]);
      const rows=mergeRows(catalog,profiles);
      let host=admin.querySelector('#cxAdminScanConfig');
      if(!host){host=document.createElement('section');host.id='cxAdminScanConfig';host.className='cx-admin-scan-card';admin.appendChild(host)}
      const enabledCount=profiles.filter(x=>x.enabled).length;
      host.innerHTML=`<div class="cx-admin-scan-head"><div><div class="cx-section-title">Marketplace scan configuration</div><p>All paper Magic sets with TCGplayer catalog IDs. Grey rows are not currently scanned; enable one to configure it.</p></div><span>${enabledCount} enabled • ${rows.length} sets</span></div>
        <div class="cx-admin-catalog-tools"><input id="cxSetCatalogSearch" placeholder="Search sets…" value="${esc(searchText)}"><label><input type="checkbox" id="cxShowConfiguredOnly"> Configured only</label></div>
        <div class="cx-admin-scan-list">${rows.map(rowHtml).join('')||'<div class="cx-empty">Set catalog is refreshing. Try again shortly.</div>'}</div>`;
      const search=host.querySelector('#cxSetCatalogSearch'),configuredOnly=host.querySelector('#cxShowConfiguredOnly');
      const applyFilter=()=>{searchText=search.value.trim().toLowerCase();for(const r of host.querySelectorAll('.cx-admin-scan-row')){const name=String(r.dataset.name||''),matches=!searchText||name.includes(searchText),configured=!configuredOnly.checked||r.classList.contains('cx-admin-configured');r.hidden=!(matches&&configured)}};
      search.oninput=applyFilter;configuredOnly.onchange=applyFilter;applyFilter();
      host.querySelectorAll('.cx-admin-scan-row').forEach((row,i)=>{
        const item=rows[i],c=item.catalog,p=item.profile,toggle=row.querySelector('[data-f="enabled"]');
        toggle.onchange=async()=>{toggle.disabled=true;try{await setEnabled(c,p,row,toggle.checked)}catch(e){row.querySelector('.cx-scan-msg').textContent=e.message;toggle.checked=!toggle.checked;toggle.disabled=false}};
        const save=row.querySelector('[data-act="save"]'),scan=row.querySelector('[data-act="scan"]');
        if(save)save.onclick=async()=>{const m=row.querySelector('.cx-scan-msg');m.textContent='Saving…';try{await saveProfile(p,row);await render()}catch(e){m.textContent=e.message}};
        if(scan)scan.onclick=async()=>{const m=row.querySelector('.cx-scan-msg');m.textContent='Queueing…';try{await saveProfile(p,row);await scanNow(p,row)}catch(e){m.textContent=e.message}};
      });
    }catch(e){console.error(e)}finally{loading=false}
  }

  const style=document.createElement('style');style.textContent=`
  .cx-admin-scan-card{margin-top:18px;background:var(--cx-card);border:1px solid var(--cx-line);border-radius:18px;padding:16px}
  .cx-admin-scan-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.cx-admin-scan-head p{margin:4px 0;color:var(--cx-muted)}
  .cx-admin-catalog-tools{display:flex;gap:14px;align-items:center;margin:14px 0}.cx-admin-catalog-tools input[type="text"],.cx-admin-catalog-tools>input{flex:1;min-width:160px}.cx-admin-catalog-tools label{display:flex;gap:6px;align-items:center;font-size:12px;font-weight:700;color:var(--cx-muted)}
  .cx-admin-scan-list{display:grid;gap:10px}.cx-admin-scan-row{display:grid;grid-template-columns:minmax(235px,1.7fr) repeat(5,minmax(105px,.8fr)) minmax(180px,1.2fr) auto;gap:10px;align-items:end;border:1px solid var(--cx-line);border-radius:14px;padding:12px;background:var(--cx-bg);transition:opacity .15s ease,background .15s ease}
  .cx-admin-unconfigured{opacity:.52}.cx-admin-configured:not(.cx-admin-enabled){opacity:.68}.cx-admin-enabled{opacity:1;background:var(--cx-card)}
  .cx-admin-scan-row label{display:grid;gap:4px;font-size:10px;font-weight:800;color:var(--cx-muted)}.cx-admin-scan-row select{min-width:0}.cx-admin-scan-row select:disabled,.cx-admin-scan-row button:disabled{opacity:.48}
  .cx-admin-scan-main{display:flex;gap:10px;align-items:center}.cx-admin-scan-main strong,.cx-admin-scan-main small{display:block}.cx-admin-scan-main small{color:var(--cx-muted);margin-top:2px}
  .cx-admin-switch input{width:18px;height:18px}.cx-admin-scan-time{display:flex;gap:12px;color:var(--cx-muted)}.cx-admin-scan-time b{color:var(--cx-text);font-weight:700}.cx-admin-scan-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.cx-scan-msg{color:var(--cx-muted);min-width:52px}
  @media(max-width:980px){.cx-admin-scan-row{grid-template-columns:1fr 1fr}.cx-admin-scan-main,.cx-admin-scan-time,.cx-admin-scan-actions{grid-column:1/-1}.cx-admin-catalog-tools{align-items:stretch;flex-direction:column}.cx-admin-scan-card{padding:12px}}
  `;document.head.appendChild(style);
  const mo=new MutationObserver(()=>{if(document.getElementById('cxAdmin')?.classList.contains('active'))setTimeout(render,0)});mo.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});document.addEventListener('click',e=>{if(e.target.closest?.('[data-cx-page="admin"]'))setTimeout(render,50)},true);
})();
