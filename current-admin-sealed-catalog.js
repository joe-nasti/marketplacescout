// Collectish Admin Sealed catalog — set-first management; loads only when Sealed Admin is active.
(() => {
  let loading=false,timer=0,loaded=false;
  let products=[],prices=[],evRows=[],pipelineState=null,setNames=new Map(),enabledSets=new Set(),expanded=new Set();
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const money=n=>n==null||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
  const fmt=d=>d?new Date(d+'T00:00:00').toLocaleDateString():'—';
  const session=()=>{try{return JSON.parse(localStorage.getItem('collectishSession')||'null')}catch{return null}};
  const userId=()=>session()?.user?.id||'';
  const active=()=>document.getElementById('cxAdmin')?.classList.contains('active')&&document.getElementById('cxAdminConsole')?.dataset.activeSection==='sealed';
  const lifecycle={catalog_only:['Catalog only','warn'],tcg_mapped:['TCG mapped',''],price_tracked:['Price tracked',''],contents_mapped:['Contents mapped',''],component_priced:['Components priced',''],ev_ready:['EV ready','good'],scout_sealed:['Scout Sealed','good']};

  function ensure(){
    const panel=document.querySelector('[data-admin-panel="sealed"]');if(!panel)return null;
    let card=panel.querySelector('#cxAdminSealedCatalog');if(card)return card;
    card=document.createElement('section');card.id='cxAdminSealedCatalog';card.className='cx-admin-catalog-card';
    card.innerHTML=`<div class="cx-admin-catalog-head"><div><div class="cx-section-title">Sealed set management</div><p>Enable a set to process every sealed product in it through exact identity, pricing, contents, component EV and Scout Sealed scoring.</p><div id="cxAdminSealedPipeline" class="cx-sub"></div></div><span id="cxAdminSealedCount" class="cx-sub"></span></div>
      <div class="cx-admin-sealed-tools">
        <input id="cxAdminSealedSearch" placeholder="Search sets or products… e.g. Secret Lair">
        <select id="cxAdminSealedType"><option value="">All product types</option><option value="secret_lair">Secret Lair drops</option><option value="secret_lair_bundle">Secret Lair bundles</option><option value="commander">Commander decks</option></select>
        <select id="cxAdminSealedMapping"><option value="">All identity</option><option value="mapped">TCG mapped</option><option value="unmapped">Needs exact TCG ID</option></select>
        <select id="cxAdminSealedEnabled"><option value="">All sets</option><option value="enabled">Enabled sets</option><option value="disabled">Disabled sets</option></select>
        <select id="cxAdminSealedLifecycle"><option value="">All lifecycle stages</option><option value="catalog_only">Catalog only</option><option value="tcg_mapped">TCG mapped</option><option value="price_tracked">Price tracked</option><option value="contents_mapped">Contents mapped</option><option value="component_priced">Components priced</option><option value="ev_ready">EV ready</option><option value="scout_sealed">Scout Sealed</option></select>
        <select id="cxAdminSealedPrice"><option value="">All sealed-price states</option><option value="priced">Has sealed price</option><option value="unpriced">Waiting on sealed price</option></select>
        <select id="cxAdminSealedEv"><option value="">All EV states</option><option value="ready">EV calculated</option><option value="not_ready">EV not ready</option><option value="positive">EV above acquisition</option><option value="negative">EV below acquisition</option></select>
        <select id="cxAdminSealedGrade"><option value="">All Scout grades</option><option value="A">Scout A</option><option value="B">Scout B</option><option value="C">Scout C</option><option value="D">Scout D</option><option value="F">Scout F</option><option value="scored">Any Scout score</option><option value="unscored">Not scored</option></select>
        <select id="cxAdminSealedBlocker"><option value="">All blockers</option><option value="blocked">Any blocker</option><option value="clear">No blocker</option><option value="tcg_exact_id_missing">Missing exact TCG ID</option><option value="sealed_price_missing">Missing sealed price</option><option value="no_card_components_after_expansion">No card components</option><option value="market_coverage_below_50pct">Low market coverage</option></select>
        <select id="cxAdminSealedRelease"><option value="">All release dates</option><option value="future">Future releases</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option><option value="2026">2026</option><option value="2025">2025</option><option value="older">2024 or older</option></select>
      </div>
      <div id="cxAdminSealedResults" class="cx-admin-sealed-results"><div class="cx-admin-loading">Open Sealed to load catalog…</div></div>`;
    panel.appendChild(card);
    const schedule=()=>{clearTimeout(timer);timer=setTimeout(render,140)};
    card.querySelector('#cxAdminSealedSearch').addEventListener('input',schedule);
    card.querySelectorAll('.cx-admin-sealed-tools select').forEach(x=>x.addEventListener('change',render));
    card.addEventListener('click',e=>{const toggle=e.target.closest('[data-sealed-expand]');if(toggle){const code=toggle.dataset.sealedExpand;expanded.has(code)?expanded.delete(code):expanded.add(code);render();return}});
    card.addEventListener('change',async e=>{const cb=e.target.closest('[data-sealed-set-enable]');if(!cb)return;const code=cb.dataset.sealedSetEnable,enabled=cb.checked;cb.disabled=true;try{await saveSet(code,enabled);enabled?enabledSets.add(code):enabledSets.delete(code);render()}catch(err){cb.checked=!enabled;alert(`Couldn’t save sealed set: ${err.message||err}`)}finally{cb.disabled=false}});
    return card;
  }

  async function saveSet(code,enabled){const uid=userId();if(!uid)throw Error('Sign in required');await rest('sealed_set_profiles?on_conflict=user_id,set_code',{method:'POST',body:{user_id:uid,set_code:code,enabled,updated_at:new Date().toISOString()},prefer:'resolution=merge-duplicates,return=minimal'});}
  function priceMap(){const m=new Map();for(const p of prices||[]){const k=String(p.sealed_uuid);if(!m.has(k))m.set(k,[]);m.get(k).push(p)}return m}
  function evMap(){return new Map((evRows||[]).map(x=>[String(x.sealed_uuid),x]))}
  function productState(r,pm,em){
    const pp=pm.get(String(r.uuid))||[],tcg=pp.find(x=>x.source==='tcgplayer_public'),ck=pp.find(x=>x.source==='cardkingdom_public'),ev=em.get(String(r.uuid)),mapped=Boolean(r.tcgplayer_product_id),priced=Boolean(tcg||ck),acq=ev?.sealed_acquisition_price==null?null:Number(ev.sealed_acquisition_price),marketEv=ev?.tcg_market_ev==null?null:Number(ev.tcg_market_ev);
    return {pp,tcg,ck,ev,mapped,priced,acq,marketEv,lifecycle:ev?.lifecycle_status||(mapped?(priced?'price_tracked':'tcg_mapped'):'catalog_only')};
  }
  function releaseMatches(date,filter){
    if(!filter)return true;if(!date)return false;const d=new Date(`${date}T00:00:00`),now=new Date(),year=d.getFullYear();
    if(filter==='future')return d>now;if(filter==='2026'||filter==='2025')return year===Number(filter);if(filter==='older')return year<=2024;
    const days=Number(filter);return Number.isFinite(days)&&d<=now&&d>=new Date(now.getTime()-days*86400000);
  }
  function filteredRows(){
    const card=ensure(),pm=priceMap(),em=evMap(),q=String(card?.querySelector('#cxAdminSealedSearch')?.value||'').trim().toLowerCase(),subtype=String(card?.querySelector('#cxAdminSealedType')?.value||''),mapping=String(card?.querySelector('#cxAdminSealedMapping')?.value||''),life=String(card?.querySelector('#cxAdminSealedLifecycle')?.value||''),price=String(card?.querySelector('#cxAdminSealedPrice')?.value||''),evFilter=String(card?.querySelector('#cxAdminSealedEv')?.value||''),grade=String(card?.querySelector('#cxAdminSealedGrade')?.value||''),blocker=String(card?.querySelector('#cxAdminSealedBlocker')?.value||''),release=String(card?.querySelector('#cxAdminSealedRelease')?.value||'');
    return products.filter(r=>{
      const hay=`${r.name||''} ${r.set_code||''} ${setNames.get(String(r.set_code||'').toUpperCase())||''}`.toLowerCase(),s=productState(r,pm,em),e=s.ev;
      if(q&&!hay.includes(q))return false;if(subtype&&r.subtype!==subtype)return false;if(mapping==='mapped'&&!s.mapped)return false;if(mapping==='unmapped'&&s.mapped)return false;if(life&&s.lifecycle!==life)return false;if(price==='priced'&&!s.priced)return false;if(price==='unpriced'&&s.priced)return false;
      if(evFilter==='ready'&&s.marketEv==null)return false;if(evFilter==='not_ready'&&s.marketEv!=null)return false;if(evFilter==='positive'&&!(s.marketEv!=null&&s.acq!=null&&s.marketEv>s.acq))return false;if(evFilter==='negative'&&!(s.marketEv!=null&&s.acq!=null&&s.marketEv<=s.acq))return false;
      if(grade==='scored'&&e?.scout_sealed_score==null)return false;if(grade==='unscored'&&e?.scout_sealed_score!=null)return false;if(['A','B','C','D','F'].includes(grade)&&e?.scout_sealed_grade!==grade)return false;
      if(blocker==='blocked'&&!e?.blocker)return false;if(blocker==='clear'&&e?.blocker)return false;if(blocker&&!['blocked','clear'].includes(blocker)&&e?.blocker!==blocker)return false;if(!releaseMatches(r.release_date,release))return false;
      return true;
    });
  }
  function groupRows(rows){const map=new Map();for(const r of rows){const code=String(r.set_code||'UNKNOWN').toUpperCase();if(!map.has(code))map.set(code,[]);map.get(code).push(r)}return [...map.entries()].sort((a,b)=>{const ad=Math.max(...a[1].map(x=>x.release_date?new Date(x.release_date).getTime():0)),bd=Math.max(...b[1].map(x=>x.release_date?new Date(x.release_date).getTime():0));return bd-ad||a[0].localeCompare(b[0])})}
  function lifecycleTag(row,mapped,priceTracked){const st=row?.lifecycle_status||(mapped?(priceTracked?'price_tracked':'tcg_mapped'):'catalog_only'),meta=lifecycle[st]||[st,''];return `<span class="cx-admin-sealed-tag ${meta[1]}">${esc(meta[0])}</span>`}
  function productHtml(r,enabled,pm,em){
    const s=productState(r,pm,em),tcg=s.tcg,ck=s.ck,ev=s.ev,px=tcg?.low_price??tcg?.market_price??ck?.market_price??null;
    const tags=[`<span class="cx-admin-sealed-tag">${esc(r.category||'unknown')}</span>`,`<span class="cx-admin-sealed-tag">${esc(r.subtype||'—')}</span>`,s.mapped?'<span class="cx-admin-sealed-tag good">Exact TCG ID</span>':'<span class="cx-admin-sealed-tag warn">Needs exact TCG ID</span>',lifecycleTag(ev,s.mapped,s.priced),ev?.scout_sealed_grade?`<span class="cx-admin-sealed-tag good">${esc(ev.scout_sealed_grade)} · ${esc(ev.scout_sealed_score)}</span>`:''].filter(Boolean).join('');
    const blocker=ev?.blocker?`<small class="cx-admin-sealed-blocker">Blocked: ${esc(String(ev.blocker).replaceAll('_',' '))}</small>`:'';
    const evline=ev?.tcg_market_ev!=null?` · EV ${money(ev.tcg_market_ev)}`:'';
    return `<div class="cx-admin-sealed-product ${enabled?'selected':''}"><label class="cx-admin-sealed-inherited"><input type="checkbox" ${enabled?'checked':''} disabled><span>${enabled?'Selected by set':'Not selected'}</span></label><div class="cx-admin-sealed-product-main"><strong>${esc(r.name)}</strong><small>${esc(fmt(r.release_date))}${r.tcgplayer_product_id?` · TCG #${esc(r.tcgplayer_product_id)}`:''}${evline}</small><div class="cx-admin-sealed-tags">${tags}</div>${blocker}</div><div class="cx-admin-sealed-price"><small>${s.priced?'Observed':'No sealed price'}</small><strong>${money(px)}</strong></div></div>`;
  }
  function renderPipeline(){const el=document.getElementById('cxAdminSealedPipeline');if(!el)return;if(!pipelineState){el.textContent='Enabled-set pipeline has not reported a run yet.';return}const d=pipelineState.detail||{},status=String(pipelineState.status||'unknown').replaceAll('_',' '),when=pipelineState.last_completed_at||pipelineState.last_started_at;el.innerHTML=`Pipeline: <strong>${esc(status)}</strong>${when?` · ${esc(new Date(when).toLocaleString())}`:''}${d.breaker?` · <strong>paused safely:</strong> ${esc(d.breaker.reason||'circuit breaker')}`:''}${Array.isArray(d.failures)&&d.failures.length?` · ${d.failures.length} surfaced failure${d.failures.length===1?'':'s'}`:''}`}
  function render(){
    if(!active()||!loaded)return;const card=ensure();if(!card)return;renderPipeline();
    const out=card.querySelector('#cxAdminSealedResults'),count=card.querySelector('#cxAdminSealedCount'),enabledFilter=String(card.querySelector('#cxAdminSealedEnabled')?.value||'');let groups=groupRows(filteredRows());if(enabledFilter==='enabled')groups=groups.filter(([code])=>enabledSets.has(code));if(enabledFilter==='disabled')groups=groups.filter(([code])=>!enabledSets.has(code));if(count)count.textContent=`${groups.length} sets · ${groups.reduce((n,[,r])=>n+r.length,0)} products`;if(!groups.length){out.innerHTML='<div class="cx-admin-sealed-empty">No sealed sets match these filters.</div>';return}
    const pm=priceMap(),em=evMap();
    out.innerHTML=groups.map(([code,rows])=>{const enabled=enabledSets.has(code),mapped=rows.filter(x=>x.tcgplayer_product_id).length,tracked=rows.filter(x=>(pm.get(String(x.uuid))||[]).length).length,scout=rows.filter(x=>em.get(String(x.uuid))?.lifecycle_status==='scout_sealed').length,evReady=rows.filter(x=>['ev_ready','scout_sealed'].includes(em.get(String(x.uuid))?.lifecycle_status)).length,latestDate=rows.map(x=>x.release_date).filter(Boolean).sort().at(-1)||null,setName=setNames.get(code)||code,isOpen=expanded.has(code);return `<section class="cx-admin-sealed-set ${enabled?'enabled':''}" data-sealed-set="${esc(code)}"><div class="cx-admin-sealed-set-head"><label class="cx-admin-sealed-set-toggle"><input type="checkbox" data-sealed-set-enable="${esc(code)}" ${enabled?'checked':''}><span></span></label><button type="button" class="cx-admin-sealed-set-summary" data-sealed-expand="${esc(code)}"><div><strong>${esc(setName)}</strong><small>${esc(code)} · latest ${esc(fmt(latestDate))}</small></div><div class="cx-admin-sealed-set-stats"><b>${rows.length} products</b><span>${mapped} mapped · ${tracked} priced · ${evReady} EV ready · ${scout} Scout</span></div><span class="cx-admin-sealed-chevron">${isOpen?'▴':'▾'}</span></button></div>${isOpen?`<div class="cx-admin-sealed-set-products">${rows.sort((a,b)=>String(b.release_date||'').localeCompare(String(a.release_date||''))||String(a.name).localeCompare(String(b.name))).map(r=>productHtml(r,enabled,pm,em)).join('')}</div>`:''}</section>`}).join('');
  }

  async function load(force=false){
    if(!active()||loading)return;ensure();if(loaded&&!force){render();return}loading=true;const out=document.getElementById('cxAdminSealedResults');if(out)out.innerHTML='<div class="cx-admin-loading">Loading sealed sets…</div>';
    try{const [p,px,ev,catalog,profiles,state]=await Promise.all([
      rest('mtgjson_sealed_products?select=uuid,name,set_code,category,subtype,release_date,tcgplayer_product_id,cardkingdom_id&order=release_date.desc.nullslast,name.asc&limit=5000'),
      rest('sealed_product_price_current?select=sealed_uuid,source,product_id,market_price,low_price,low_with_shipping,captured_at'),
      rest('sealed_ev_current?select=sealed_uuid,set_code,lifecycle_status,blocker,tcg_market_ev,sealed_acquisition_price,scout_sealed_score,scout_sealed_grade,refreshed_at'),
      rest('magic_set_catalog?select=code,name&digital=eq.false'),
      rest('sealed_set_profiles?select=set_code,enabled'),
      rest('mtgjson_sync_state?select=status,last_started_at,last_completed_at,detail&feed=eq.enabled_sealed_pipeline&limit=1')
    ]);products=p||[];prices=px||[];evRows=ev||[];pipelineState=(state||[])[0]||null;setNames=new Map((catalog||[]).map(x=>[String(x.code||'').toUpperCase(),x.name]));enabledSets=new Set((profiles||[]).filter(x=>x.enabled).map(x=>String(x.set_code||'').toUpperCase()));loaded=true;render()}catch(e){if(out)out.innerHTML=`<div class="cx-admin-error">Couldn’t load sealed sets: ${esc(e.message||e)}</div>`}finally{loading=false}
  }

  document.addEventListener('collectish:admin-section-change',e=>{if(e.detail?.section==='sealed')setTimeout(()=>{ensure();load(false)},40)});
  document.addEventListener('click',e=>{if(e.target?.closest?.('[data-cx-page="admin"]'))setTimeout(()=>{ensure();if(active())load(false)},240)},true);
  window.CollectishAdminSealedCatalog={refresh:()=>load(true)};
})();