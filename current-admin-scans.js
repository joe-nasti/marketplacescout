// Collectish Admin — local-first catalog-backed Marketplace scan configuration.
(() => {
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const cadences=[[3,'Every 3h'],[6,'Every 6h'],[12,'Every 12h'],[24,'Daily'],[48,'Every 2 days'],[72,'Every 3 days'],[168,'Weekly']];
  let loading=false,searchText='',configuredOnlyState=false;
  const drafts=new Map();
  const timers=new Map();
  const session=()=>{try{return JSON.parse(localStorage.getItem('collectishSession')||'null')}catch{return null}};
  const userId=()=>session()?.user?.id||'';
  const opt=(values,current)=>values.map(v=>{const [value,label]=Array.isArray(v)?v:[v,v];return `<option value="${esc(value)}" ${String(value)===String(current)?'selected':''}>${esc(label)}</option>`}).join('');
  const fmt=x=>x?new Date(x).toLocaleString():'—';
  const defaults=c=>({user_id:userId(),set_slug:c.tcgplayer_slug,set_name:c.name,enabled:false,cadence_hours:24,printing:'Both',condition:'Near Mint',language:'English',scan_depth:'Smart',next_due_at:null,last_queued_at:null,_exists:false,_persisted:null,_dirty:false,_saving:false,_saveAgain:false,_error:''});

  async function rebalance(){
    try{await rest('rpc/rebalance_marketplace_scan_schedule',{method:'POST',body:{}})}catch(e){console.warn('Scan schedule rebalance failed',e)}
  }

  function snapshot(d){return {enabled:Boolean(d.enabled),cadence_hours:Number(d.cadence_hours||24),printing:d.printing||'Both',condition:d.condition||'Near Mint',language:d.language||'English',scan_depth:d.scan_depth||'Smart'};}
  function same(a,b){return a&&b&&a.enabled===b.enabled&&a.cadence_hours===b.cadence_hours&&a.printing===b.printing&&a.condition===b.condition&&a.language===b.language&&a.scan_depth===b.scan_depth;}
  function rowFor(slug){try{return document.querySelector(`#cxAdminScanConfig .cx-admin-scan-row[data-set="${CSS.escape(String(slug))}"]`)}catch{return null}}

  function applyDraftToRow(d,row){
    if(!row)return;
    row.classList.toggle('cx-admin-configured',d._exists||d.enabled);
    row.classList.toggle('cx-admin-unconfigured',!d._exists&&!d.enabled);
    row.classList.toggle('cx-admin-enabled',Boolean(d.enabled));
    const toggle=row.querySelector('[data-f="enabled"]');if(toggle)toggle.checked=Boolean(d.enabled);
    for(const el of row.querySelectorAll('select,[data-act="scan"]')) el.disabled=!d.enabled;
    const next=row.querySelector('[data-role="next"]');if(next)next.textContent=d.enabled?fmt(d.next_due_at):'Disabled';
    const msg=row.querySelector('.cx-scan-msg');
    if(msg){
      msg.classList.toggle('cx-save-error',Boolean(d._error));
      msg.textContent=d._error?`Save failed: ${d._error}`:d._saving?'Saving…':d._dirty?'Unsaved':d._exists?(d.enabled?'Saved':'Configured, disabled'):'Not configured';
    }
  }

  function readRowIntoDraft(d,row){
    d.enabled=row.querySelector('[data-f="enabled"]').checked;
    d.cadence_hours=Number(row.querySelector('[data-f="cadence"]').value);
    d.printing=row.querySelector('[data-f="printing"]').value;
    d.condition=row.querySelector('[data-f="condition"]').value;
    d.language=row.querySelector('[data-f="language"]').value;
    d.scan_depth=row.querySelector('[data-f="depth"]').value;
  }

  function markDirty(d,row,delay=700){
    d._dirty=true;d._error='';applyDraftToRow(d,row);
    clearTimeout(timers.get(d.set_slug));
    timers.set(d.set_slug,setTimeout(()=>persistDraft(d,row),delay));
  }

  async function persistDraft(d,row){
    clearTimeout(timers.get(d.set_slug));timers.delete(d.set_slug);
    if(d._saving){d._saveAgain=true;return}
    const current=snapshot(d);
    if(d._exists&&same(current,d._persisted)){d._dirty=false;applyDraftToRow(d,row);return}
    d._saving=true;d._dirty=false;d._error='';applyDraftToRow(d,row);
    const previous=d._persisted;
    const scheduleChanged=!d._exists||!previous||previous.enabled!==current.enabled||previous.cadence_hours!==current.cadence_hours;
    try{
      const body={user_id:d.user_id||userId(),set_slug:d.set_slug,set_name:d.set_name,enabled:current.enabled,cadence_hours:current.cadence_hours,printing:current.printing,condition:current.condition,language:current.language,scan_depth:current.scan_depth,updated_at:new Date().toISOString(),...(scheduleChanged?{next_due_at:null}:{})};
      await rest('marketplace_scan_profiles?on_conflict=user_id,set_slug',{method:'POST',body,prefer:'resolution=merge-duplicates,return=minimal'});
      d._exists=true;d._persisted={...current};
      if(scheduleChanged){await rebalance();try{const x=await rest(`marketplace_scan_profiles?select=next_due_at,last_queued_at&user_id=eq.${encodeURIComponent(body.user_id)}&set_slug=eq.${encodeURIComponent(d.set_slug)}&limit=1`);if(x?.[0]){d.next_due_at=x[0].next_due_at;d.last_queued_at=x[0].last_queued_at}}catch{}}
    }catch(e){d._error=e.message||String(e);d._dirty=true}
    finally{
      d._saving=false;applyDraftToRow(d,row);
      if(d._saveAgain){d._saveAgain=false;markDirty(d,row,100)}
    }
  }

  async function flushDraft(d,row){
    readRowIntoDraft(d,row);
    clearTimeout(timers.get(d.set_slug));timers.delete(d.set_slug);
    if(d._saving){d._saveAgain=true;while(d._saving)await new Promise(r=>setTimeout(r,50));}
    if(d._dirty||!d._exists||!same(snapshot(d),d._persisted))await persistDraft(d,row);
    if(d._error)throw Error(d._error);
  }

  async function scanNow(d,row){
    await flushDraft(d,row);
    if(!d.enabled)throw Error('Enable this set first');
    const profile={setName:d.set_name,setSlug:d.set_slug,printing:d.printing,condition:d.condition,language:d.language,scanDepth:d.scan_depth,salesEnrich:0};
    const body={user_id:d.user_id||userId(),source:'marketplace',action:'scan_set',status:'queued',priority:5,required_capability:'marketplace_public_api',preferred_executor:'cloud_worker',payload_json:{profile,cloudOnly:true,pcFallback:false,pcFallbackQueued:false,cloudPrimary:true,manualAdmin:true,executionClass:'cloud_public'},progress_json:{stage:'queued',percent:0,detail:`Manual Admin scan: ${d.set_name}`,updatedAt:new Date().toISOString()},attempt_count:0,max_attempts:2,available_at:new Date().toISOString()};
    await rest('collector_jobs',{method:'POST',body});
    const msg=row.querySelector('.cx-scan-msg');if(msg)msg.textContent='Scan queued';
  }

  function rowHtml(item){
    const c=item.catalog,d=item.draft,enabled=Boolean(d.enabled),disabled=!enabled?'disabled':'';
    return `<div class="cx-admin-scan-row ${d._exists?'cx-admin-configured':'cx-admin-unconfigured'} ${enabled?'cx-admin-enabled':''}" data-set="${esc(d.set_slug)}" data-name="${esc(c.name.toLowerCase())}">
      <div class="cx-admin-scan-main"><label class="cx-admin-switch"><input data-f="enabled" type="checkbox" ${enabled?'checked':''}><span></span></label><div><strong>${esc(c.name)}</strong><small>${esc(c.code||'')} ${c.released_at?`• ${esc(c.released_at)}`:''}${c.set_type?` • ${esc(c.set_type)}`:''}</small></div></div>
      <label>Cadence<select data-f="cadence" ${disabled}>${opt(cadences,d.cadence_hours)}</select></label>
      <label>Printing<select data-f="printing" ${disabled}>${opt(['Both','Normal','Foil'],d.printing)}</select></label>
      <label>Depth<select data-f="depth" ${disabled}>${opt(['Smart','250','500','1000','Full'],d.scan_depth)}</select></label>
      <label>Condition<select data-f="condition" ${disabled}>${opt(['Near Mint','Lightly Played','Moderately Played'],d.condition)}</select></label>
      <label>Language<select data-f="language" ${disabled}>${opt(['English'],d.language)}</select></label>
      <div class="cx-admin-scan-time"><small>Next due<br><b data-role="next">${enabled?esc(fmt(d.next_due_at)):'Disabled'}</b></small><small>Last queued<br><b>${esc(fmt(d.last_queued_at))}</b></small></div>
      <div class="cx-admin-scan-actions"><button class="cx-primary" data-act="scan" ${disabled}>Scan now</button><small class="cx-scan-msg">${d._exists?(enabled?'Saved':'Configured, disabled'):'Not configured'}</small></div>
    </div>`;
  }

  function mergeRows(catalog,profiles){
    const bySlug=new Map((profiles||[]).map(p=>[String(p.set_slug||''),p]));
    const byName=new Map((profiles||[]).map(p=>[String(p.set_name||'').toLowerCase(),p]));
    const used=new Set(),out=[];
    for(const c of catalog||[]){
      const p=bySlug.get(String(c.tcgplayer_slug||''))||byName.get(String(c.name||'').toLowerCase())||null;
      if(p)used.add(p.set_slug);
      let d=drafts.get(String(p?.set_slug||c.tcgplayer_slug));
      if(!d){d=p?{...p,_exists:true,_persisted:snapshot(p),_dirty:false,_saving:false,_saveAgain:false,_error:''}:defaults(c);drafts.set(d.set_slug,d)}
      out.push({catalog:c,draft:d});
    }
    for(const p of profiles||[]){
      if(used.has(p.set_slug))continue;
      let d=drafts.get(p.set_slug);if(!d){d={...p,_exists:true,_persisted:snapshot(p),_dirty:false,_saving:false,_saveAgain:false,_error:''};drafts.set(p.set_slug,d)}
      out.push({catalog:{name:p.set_name,code:'',set_type:'existing profile',released_at:null,tcgplayer_slug:p.set_slug},draft:d});
    }
    return out.sort((a,b)=>a.catalog.name.localeCompare(b.catalog.name,undefined,{sensitivity:'base'}));
  }

  function bindRow(row,item){
    const d=item.draft,toggle=row.querySelector('[data-f="enabled"]');
    const onEdit=()=>{readRowIntoDraft(d,row);applyDraftToRow(d,row);markDirty(d,row)};
    toggle.onchange=onEdit;
    row.querySelectorAll('select').forEach(sel=>sel.onchange=onEdit);
    row.querySelector('[data-act="scan"]').onclick=async()=>{const msg=row.querySelector('.cx-scan-msg');msg.textContent='Queueing…';try{await scanNow(d,row)}catch(e){msg.textContent=e.message||String(e)}};
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
      host.innerHTML=`<div class="cx-admin-scan-head"><div><div class="cx-section-title">Marketplace scan configuration</div><p>Changes apply automatically. Grey rows are not scanned; enable one to configure it.</p></div><span>${enabledCount} enabled • ${rows.length} sets</span></div>
        <div class="cx-admin-catalog-tools"><input id="cxSetCatalogSearch" placeholder="Search sets…" value="${esc(searchText)}"><label><input type="checkbox" id="cxShowConfiguredOnly" ${configuredOnlyState?'checked':''}> Configured only</label></div>
        <div class="cx-admin-scan-list">${rows.map(rowHtml).join('')||'<div class="cx-empty">Set catalog is refreshing. Try again shortly.</div>'}</div>`;
      const search=host.querySelector('#cxSetCatalogSearch'),configuredOnly=host.querySelector('#cxShowConfiguredOnly');
      const applyFilter=()=>{searchText=search.value.trim().toLowerCase();configuredOnlyState=configuredOnly.checked;for(const r of host.querySelectorAll('.cx-admin-scan-row')){const name=String(r.dataset.name||''),matches=!searchText||name.includes(searchText),configured=!configuredOnlyState||r.classList.contains('cx-admin-configured');r.hidden=!(matches&&configured)}};
      search.oninput=applyFilter;configuredOnly.onchange=applyFilter;applyFilter();
      host.querySelectorAll('.cx-admin-scan-row').forEach((row,i)=>bindRow(row,rows[i]));
    }catch(e){console.error(e)}finally{loading=false}
  }

  const style=document.createElement('style');style.textContent=`
  .cx-admin-scan-card{margin-top:18px;background:var(--cx-card);border:1px solid var(--cx-line);border-radius:18px;padding:16px}
  .cx-admin-scan-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.cx-admin-scan-head p{margin:4px 0;color:var(--cx-muted)}
  .cx-admin-catalog-tools{display:flex;gap:14px;align-items:center;margin:14px 0}.cx-admin-catalog-tools>input{flex:1;min-width:160px}.cx-admin-catalog-tools label{display:flex;gap:6px;align-items:center;font-size:12px;font-weight:700;color:var(--cx-muted)}
  .cx-admin-scan-list{display:grid;gap:10px}.cx-admin-scan-row{display:grid;grid-template-columns:minmax(235px,1.7fr) repeat(5,minmax(105px,.8fr)) minmax(180px,1.2fr) auto;gap:10px;align-items:end;border:1px solid var(--cx-line);border-radius:14px;padding:12px;background:var(--cx-bg);transition:opacity .12s ease,background .12s ease}
  .cx-admin-unconfigured{opacity:.52}.cx-admin-configured:not(.cx-admin-enabled){opacity:.68}.cx-admin-enabled{opacity:1;background:var(--cx-card)}
  .cx-admin-scan-row label{display:grid;gap:4px;font-size:10px;font-weight:800;color:var(--cx-muted)}.cx-admin-scan-row select{min-width:0}.cx-admin-scan-row select:disabled,.cx-admin-scan-row button:disabled{opacity:.48}
  .cx-admin-scan-main{display:flex;gap:10px;align-items:center}.cx-admin-scan-main strong,.cx-admin-scan-main small{display:block}.cx-admin-scan-main small{color:var(--cx-muted);margin-top:2px}
  .cx-admin-switch input{width:18px;height:18px}.cx-admin-scan-time{display:flex;gap:12px;color:var(--cx-muted)}.cx-admin-scan-time b{color:var(--cx-text);font-weight:700}.cx-admin-scan-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.cx-scan-msg{color:var(--cx-muted);min-width:72px}.cx-save-error{color:#b42318}
  @media(max-width:980px){.cx-admin-scan-row{grid-template-columns:1fr 1fr}.cx-admin-scan-main,.cx-admin-scan-time,.cx-admin-scan-actions{grid-column:1/-1}.cx-admin-catalog-tools{align-items:stretch;flex-direction:column}.cx-admin-scan-card{padding:12px}}
  `;document.head.appendChild(style);
  const mo=new MutationObserver(()=>{if(document.getElementById('cxAdmin')?.classList.contains('active')&&!document.getElementById('cxAdminScanConfig'))setTimeout(render,0)});mo.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});document.addEventListener('click',e=>{if(e.target.closest?.('[data-cx-page="admin"]'))setTimeout(render,50)},true);
})();