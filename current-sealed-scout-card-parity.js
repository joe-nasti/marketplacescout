// Scout Sealed card parity — use Scout card hierarchy for sealed products.
(() => {
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  function enhance(row){
    if(!row||row.dataset.sealedScoutParity==='1'){
      // Images can arrive asynchronously after card structure. Move them into the Scout thumb rail.
      const late=row?.querySelector('.cx-sealed-product-image');
      const thumb=row?.querySelector('.cx-sealed-scout-thumb');
      if(late&&thumb&&!late.closest('.cx-sealed-scout-thumb')){thumb.innerHTML='';thumb.append(late)}
      return;
    }
    const name=row.querySelector('.cx-sealed-name');if(!name)return;
    const title=name.querySelector(':scope > strong')?.textContent?.trim()||'';
    const sub=name.querySelector(':scope > small')?.textContent?.trim()||'';
    const badgeWrap=name.querySelector('.cx-sealed-badges');
    const scoreBadge=[...(badgeWrap?.querySelectorAll('.cx-sealed-badge')||[])].find(x=>/^[A-F]\s*[·•]/i.test(x.textContent.trim()));
    const sm=scoreBadge?.textContent.trim().match(/^([A-F])\s*[·•]\s*([0-9.]+)/i);
    const grade=(sm?.[1]||'—').toUpperCase(),score=sm?.[2]||'';
    scoreBadge?.remove();
    const badges=badgeWrap?.innerHTML||'';
    const metrics=[...row.querySelectorAll(':scope > .cx-sealed-metric')];
    const byLabel=new Map(metrics.map(m=>[(m.querySelector('span')?.textContent||'').trim().toLowerCase(),m]));
    const value=label=>byLabel.get(label)?.querySelector('b')?.textContent?.trim()||'—';
    const img=name.querySelector('.cx-sealed-product-image');
    const thumb=document.createElement('div');thumb.className='cx-scout-thumb cx-sealed-scout-thumb';
    if(img){img.remove();thumb.append(img)}else thumb.innerHTML=`<div class="cx-scout-thumb-placeholder">${esc(grade)}</div>`;
    const body=document.createElement('div');body.className='cx-scout-card-body cx-sealed-scout-card-body';
    body.innerHTML=`<div class="cx-scout-card-top"><span class="cx-grade cx-grade-${esc(grade.toLowerCase())}">${esc(grade)}</span><span class="cx-score-mini">${score?`Scout ${esc(score)}/100`:'Score pending'}</span></div><strong>${esc(title)}</strong><small>${esc(sub)}</small><div class="cx-scout-card-metrics cx-sealed-scout-metrics"><span>Buy <b>${esc(value('sealed buy'))}</b></span><span>Market EV <b>${esc(value('market ev'))}</b></span><span>Direct net <b>${esc(value('direct net'))}</b></span><span>CK BL <b>${esc(value('ck buylist'))}</b></span></div>${badges?`<div class="cx-v5-mini-badges cx-sealed-scout-badges">${badges}</div>`:''}`;
    row.innerHTML='';row.append(thumb,body);row.classList.add('cx-scout-card','cx-sealed-scout-card');row.dataset.sealedScoutParity='1';
  }
  function run(){document.querySelectorAll('#cxSealedRows .cx-sealed-row').forEach(enhance)}
  const mo=new MutationObserver(()=>requestAnimationFrame(run));
  function install(){const h=document.getElementById('cxSealed');if(!h)return;mo.observe(h,{childList:true,subtree:true});run()}
  document.addEventListener('collectish:ready',install);if(document.getElementById('cxSealed'))install();
})();
