// Collectish Admin Sealed catalog browser — loads only when Sealed Admin section is active.
(() => {
  let loading=false,timer=0,lastKey='';
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const money=n=>n==null||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
  const fmt=d=>d?new Date(d+'T00:00:00').toLocaleDateString():'—';
  function active(){return document.getElementById('cxAdmin')?.classList.contains('active')&&document.getElementById('cxAdminConsole')?.dataset.activeSection==='sealed'}
  function ensure(){
    const panel=document.querySelector('[data-admin-panel="sealed"]');if(!panel)return null;
    let card=panel.querySelector('#cxAdminSealedCatalog');if(card)return card;
    card=document.createElement('section');card.id='cxAdminSealedCatalog';card.className='cx-admin-catalog-card';
    card.innerHTML=`<div class="cx-admin-catalog-head"><div><div class="cx-section-title">Sealed product catalog</div><p>Browse the full MTGJSON sealed universe. Scout Sealed currently scores only the promoted precon pipeline.</p></div><span id="cxAdminSealedCount" class="cx-sub"></span></div>
      <div class="cx-admin-sealed-tools"><input id="cxAdminSealedSearch" placeholder="Search sealed products… e.g. Secret Lair"><select id="cxAdminSealedType"><option value="">All product types</option><option value="secret_lair">Secret Lair drops</option><option value="secret_lair_bundle">Secret Lair bundles</option><option value="commander">Commander decks</option></select><select id="cxAdminSealedMapping"><option value="">All identity</option><option value="mapped">TCG mapped</option><option value="unmapped">Needs TCG match</option></select></div>
      <div id="cxAdminSealedResults" class="cx-admin-sealed-results"><div class="cx-admin-loading">Open Sealed to load catalog…</div></div>`;
    panel.appendChild(card);
    const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>load(true),220)};
    card.querySelector('#cxAdminSealedSearch').addEventListener('input',schedule);
    card.querySelector('#cxAdminSealedType').addEventListener('change',()=>load(true));
    card.querySelector('#cxAdminSealedMapping').addEventListener('change',()=>load(true));
    return card;
  }
  async function load(force=false){
    if(!active()||loading)return;const card=ensure();if(!card)return;
    const q=String(card.querySelector('#cxAdminSealedSearch')?.value||'').trim();
    const subtype=String(card.querySelector('#cxAdminSealedType')?.value||'');
    const mapping=String(card.querySelector('#cxAdminSealedMapping')?.value||'');
    const key=`${q}|${subtype}|${mapping}`;if(!force&&key===lastKey)return;lastKey=key;loading=true;
    const out=card.querySelector('#cxAdminSealedResults'),count=card.querySelector('#cxAdminSealedCount');if(out)out.innerHTML='<div class="cx-admin-loading">Loading sealed catalog…</div>';
    try{
      let path='mtgjson_sealed_products?select=uuid,name,set_code,category,subtype,release_date,tcgplayer_product_id,cardkingdom_id&order=release_date.desc.nullslast,name.asc&limit=60';
      if(q)path+=`&name=ilike.*${encodeURIComponent(q)}*`;
      if(subtype)path+=`&subtype=eq.${encodeURIComponent(subtype)}`;
      if(mapping==='mapped')path+='&tcgplayer_product_id=not.is.null';
      if(mapping==='unmapped')path+='&tcgplayer_product_id=is.null';
      const rows=await rest(path);
      const ids=(rows||[]).map(x=>x.uuid).filter(Boolean);
      let prices=[];
      if(ids.length){
        try{prices=await rest(`sealed_product_price_current?select=sealed_uuid,source,market_price,low_price,captured_at&sealed_uuid=in.(${ids.map(encodeURIComponent).join(',')})`)}catch{}
      }
      const pm=new Map();for(const p of prices||[]){const k=String(p.sealed_uuid);if(!pm.has(k))pm.set(k,[]);pm.get(k).push(p)}
      if(count)count.textContent=`${(rows||[]).length}${(rows||[]).length===60?'+' : ''} shown`;
      if(!rows?.length){out.innerHTML='<div class="cx-admin-sealed-empty">No sealed products match these filters.</div>';return}
      out.innerHTML=rows.map(r=>{
        const pp=pm.get(String(r.uuid))||[],tcg=pp.find(x=>x.source==='tcgplayer_public'),ck=pp.find(x=>x.source==='cardkingdom_public');
        const mapped=Boolean(r.tcgplayer_product_id),priceTracked=Boolean(tcg||ck);
        const tags=[`<span class="cx-admin-sealed-tag">${esc(r.category||'unknown')}</span>`,`<span class="cx-admin-sealed-tag">${esc(r.subtype||'—')}</span>`,mapped?'<span class="cx-admin-sealed-tag good">TCG mapped</span>':'<span class="cx-admin-sealed-tag warn">Needs TCG match</span>',priceTracked?'<span class="cx-admin-sealed-tag good">Price tracked</span>':'<span class="cx-admin-sealed-tag">Catalog only</span>'].join('');
        const px=tcg?.low_price??tcg?.market_price??ck?.market_price??null;
        return `<div class="cx-admin-sealed-product" data-sealed="${esc(r.uuid)}"><div><strong>${esc(r.name)}</strong><small>${esc(r.set_code||'—')} · ${esc(fmt(r.release_date))}${r.tcgplayer_product_id?` · TCG #${esc(r.tcgplayer_product_id)}`:''}</small><div class="cx-admin-sealed-tags">${tags}</div></div><div class="cx-admin-sealed-price"><small>${priceTracked?'Observed':'No sealed price'}</small><strong>${money(px)}</strong></div></div>`;
      }).join('');
    }catch(e){if(out)out.innerHTML=`<div class="cx-admin-error">Couldn’t load sealed catalog: ${esc(e.message||e)}</div>`}
    finally{loading=false}
  }
  document.addEventListener('collectish:admin-section-change',e=>{if(e.detail?.section==='sealed')setTimeout(()=>{ensure();load(true)},40)});
  document.addEventListener('click',e=>{if(e.target?.closest?.('[data-cx-page="admin"]'))setTimeout(()=>{ensure();if(active())load(false)},240)},true);
  window.CollectishAdminSealedCatalog={refresh:()=>load(true)};
})();