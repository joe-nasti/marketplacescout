// Collectish Admin Sealed catalog — set-first management; loads only when Sealed Admin is active.
(() => {
  let loading=false,timer=0,loaded=false;
  let products=[],prices=[],setNames=new Map(),enabledSets=new Set(),expanded=new Set();
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const money=n=>n==null||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
  const fmt=d=>d?new Date(d+'T00:00:00').toLocaleDateString():'—';
  const session=()=>{try{return JSON.parse(localStorage.getItem('collectishSession')||'null')}catch{return null}};
  const userId=()=>session()?.user?.id||'';
  const active=()=>document.getElementById('cxAdmin')?.classList.contains('active')&&document.getElementById('cxAdminConsole')?.dataset.activeSection==='sealed';

  function ensure(){
    const panel=document.querySelector('[data-admin-panel="sealed"]');if(!panel)return null;
    let card=panel.querySelector('#cxAdminSealedCatalog');if(card)return card;
    card=document.createElement('section');card.id='cxAdminSealedCatalog';card.className='cx-admin-catalog-card';
    card.innerHTML=`<div class="cx-admin-catalog-head"><div><div class="cx-section-title">Sealed set management</div><p>Enable a set to select every sealed product in it. Expand a set to inspect inherited product selection and mapping coverage.</p></div><span id="cxAdminSealedCount" class="cx-sub"></span></div>
      <div class="cx-admin-sealed-tools"><input id="cxAdminSealedSearch" placeholder="Search sets or products… e.g. Secret Lair"><select id="cxAdminSealedType"><option value="">All product types</option><option value="secret_lair">Secret Lair drops</option><option value="secret_lair_bundle">Secret Lair bundles</option><option value="commander">Commander decks</option></select><select id="cxAdminSealedMapping"><option value="">All identity</option><option value="mapped">TCG mapped</option><option value="unmapped">Needs TCG match</option></select><select id="cxAdminSealedEnabled"><option value="">All sets</option><option value="enabled">Enabled sets</option><option value="disabled">Disabled sets</option></select></div>
      <div id="cxAdminSealedResults" class="cx-admin-sealed-results"><div class="cx-admin-loading">Open Sealed to load catalog…</div></div>`;
    panel.appendChild(card);
    const schedule=()=>{clearTimeout(timer);timer=setTimeout(render,140)};
    card.querySelector('#cxAdminSealedSearch').addEventListener('input',schedule);
    card.querySelector('#cxAdminSealedType').addEventListener('change',render);
    card.querySelector('#cxAdminSealedMapping').addEventListener('change',render);
    card.querySelector('#cxAdminSealedEnabled').addEventListener('change',render);
    card.addEventListener('click',e=>{
      const toggle=e.target.closest('[data-sealed-expand]');if(toggle){const code=toggle.dataset.sealedExpand;expanded.has(code)?expanded.delete(code):expanded.add(code);render();return}
    });
    card.addEventListener('change',async e=>{
      const cb=e.target.closest('[data-sealed-set-enable]');if(!cb)return;
      const code=cb.dataset.sealedSetEnable,enabled=cb.checked;cb.disabled=true;
      try{await saveSet(code,enabled);enabled?enabledSets.add(code):enabledSets.delete(code);render()}catch(err){cb.checked=!enabled;alert(`Couldn’t save sealed set: ${err.message||err}`)}finally{cb.disabled=false}
    });
    return card;
  }

  async function saveSet(code,enabled){
    const uid=userId();if(!uid)throw Error('Sign in required');
    await rest('sealed_set_profiles?on_conflict=user_id,set_code',{method:'POST',body:{user_id:uid,set_code:code,enabled,updated_at:new Date().toISOString()},prefer:'resolution=merge-duplicates,return=minimal'});
  }

  function priceMap(){const m=new Map();for(const p of prices||[]){const k=String(p.sealed_uuid);if(!m.has(k))m.set(k,[]);m.get(k).push(p)}return m}
  function filteredRows(){
    const card=ensure(),q=String(card?.querySelector('#cxAdminSealedSearch')?.value||'').trim().toLowerCase(),subtype=String(card?.querySelector('#cxAdminSealedType')?.value||''),mapping=String(card?.querySelector('#cxAdminSealedMapping')?.value||'');
    return products.filter(r=>{
      const hay=`${r.name||''} ${r.set_code||''} ${setNames.get(String(r.set_code||'').toUpperCase())||''}`.toLowerCase();
      if(q&&!hay.includes(q))return false;
      if(subtype&&r.subtype!==subtype)return false;
      if(mapping==='mapped'&&!r.tcgplayer_product_id)return false;
      if(mapping==='unmapped'&&r.tcgplayer_product_id)return false;
      return true;
    });
  }
  function groupRows(rows){
    const map=new Map();
    for(const r of rows){const code=String(r.set_code||'UNKNOWN').toUpperCase();if(!map.has(code))map.set(code,[]);map.get(code).push(r)}
    return [...map.entries()].sort((a,b)=>{
      const ad=Math.max(...a[1].map(x=>x.release_date?new Date(x.release_date).getTime():0)),bd=Math.max(...b[1].map(x=>x.release_date?new Date(x.release_date).getTime():0));return bd-ad||a[0].localeCompare(b[0]);
    });
  }
  function productHtml(r,enabled,pm){
    const pp=pm.get(String(r.uuid))||[],tcg=pp.find(x=>x.source==='tcgplayer_public'),ck=pp.find(x=>x.source==='cardkingdom_public'),mapped=Boolean(r.tcgplayer_product_id),priceTracked=Boolean(tcg||ck),px=tcg?.low_price??tcg?.market_price??ck?.market_price??null;
    const tags=[`<span class="cx-admin-sealed-tag">${esc(r.category||'unknown')}</span>`,`<span class="cx-admin-sealed-tag">${esc(r.subtype||'—')}</span>`,mapped?'<span class="cx-admin-sealed-tag good">TCG mapped</span>':'<span class="cx-admin-sealed-tag warn">Needs TCG match</span>',priceTracked?'<span class="cx-admin-sealed-tag good">Price tracked</span>':'<span class="cx-admin-sealed-tag">Catalog only</span>'].join('');
    return `<div class="cx-admin-sealed-product ${enabled?'selected':''}"><label class="cx-admin-sealed-inherited"><input type="checkbox" ${enabled?'checked':''} disabled><span>${enabled?'Selected by set':'Not selected'}</span></label><div class="cx-admin-sealed-product-main"><strong>${esc(r.name)}</strong><small>${esc(fmt(r.release_date))}${r.tcgplayer_product_id?` · TCG #${esc(r.tcgplayer_product_id)}`:''}</small><div class="cx-admin-sealed-tags">${tags}</div></div><div class="cx-admin-sealed-price"><small>${priceTracked?'Observed':'No sealed price'}</small><strong>${money(px)}</strong></div></div>`;
  }
  function render(){
    if(!active()||!loaded)return;const card=ensure();if(!card)return;
    const out=card.querySelector('#cxAdminSealedResults'),count=card.querySelector('#cxAdminSealedCount'),enabledFilter=String(card.querySelector('#cxAdminSealedEnabled')?.value||'');
    let groups=groupRows(filteredRows());
    if(enabledFilter==='enabled')groups=groups.filter(([code])=>enabledSets.has(code));
    if(enabledFilter==='disabled')groups=groups.filter(([code])=>!enabledSets.has(code));
    if(count)count.textContent=`${groups.length} sets · ${groups.reduce((n,[,r])=>n+r.length,0)} products`;
    if(!groups.length){out.innerHTML='<div class="cx-admin-sealed-empty">No sealed sets match these filters.</div>';return}
    const pm=priceMap();
    out.innerHTML=groups.map(([code,rows])=>{
      const enabled=enabledSets.has(code),mapped=rows.filter(x=>x.tcgplayer_product_id).length,tracked=rows.filter(x=>(pm.get(String(x.uuid))||[]).length).length,latestDate=rows.map(x=>x.release_date).filter(Boolean).sort().at(-1)||null,setName=setNames.get(code)||code,isOpen=expanded.has(code);
      return `<section class="cx-admin-sealed-set ${enabled?'enabled':''}" data-sealed-set="${esc(code)}"><div class="cx-admin-sealed-set-head"><label class="cx-admin-sealed-set-toggle"><input type="checkbox" data-sealed-set-enable="${esc(code)}" ${enabled?'checked':''}><span></span></label><button type="button" class="cx-admin-sealed-set-summary" data-sealed-expand="${esc(code)}"><div><strong>${esc(setName)}</strong><small>${esc(code)} · latest ${esc(fmt(latestDate))}</small></div><div class="cx-admin-sealed-set-stats"><b>${rows.length} products</b><span>${mapped} TCG mapped · ${tracked} priced</span></div><span class="cx-admin-sealed-chevron">${isOpen?'▴':'▾'}</span></button></div>${isOpen?`<div class="cx-admin-sealed-set-products">${rows.sort((a,b)=>String(b.release_date||'').localeCompare(String(a.release_date||''))||String(a.name).localeCompare(String(b.name))).map(r=>productHtml(r,enabled,pm)).join('')}</div>`:''}</section>`;
    }).join('');
  }

  async function load(force=false){
    if(!active()||loading)return;ensure();if(loaded&&!force){render();return}loading=true;
    const out=document.getElementById('cxAdminSealedResults');if(out)out.innerHTML='<div class="cx-admin-loading">Loading sealed sets…</div>';
    try{
      const [p,px,catalog,profiles]=await Promise.all([
        rest('mtgjson_sealed_products?select=uuid,name,set_code,category,subtype,release_date,tcgplayer_product_id,cardkingdom_id&order=release_date.desc.nullslast,name.asc&limit=5000'),
        rest('sealed_product_price_current?select=sealed_uuid,source,market_price,low_price,captured_at'),
        rest('magic_set_catalog?select=code,name&digital=eq.false'),
        rest('sealed_set_profiles?select=set_code,enabled')
      ]);
      products=p||[];prices=px||[];setNames=new Map((catalog||[]).map(x=>[String(x.code||'').toUpperCase(),x.name]));enabledSets=new Set((profiles||[]).filter(x=>x.enabled).map(x=>String(x.set_code||'').toUpperCase()));loaded=true;render();
    }catch(e){if(out)out.innerHTML=`<div class="cx-admin-error">Couldn’t load sealed sets: ${esc(e.message||e)}</div>`}
    finally{loading=false}
  }

  document.addEventListener('collectish:admin-section-change',e=>{if(e.detail?.section==='sealed')setTimeout(()=>{ensure();load(false)},40)});
  document.addEventListener('click',e=>{if(e.target?.closest?.('[data-cx-page="admin"]'))setTimeout(()=>{ensure();if(active())load(false)},240)},true);
  window.CollectishAdminSealedCatalog={refresh:()=>load(true)};
})();