// Collectish Admin navigation — sticky filters and A–Z jump rail for long set catalogs.
(() => {
  let mode='all';
  let raf=0;

  function rows(){return [...document.querySelectorAll('#cxAdminScanConfig .cx-admin-scan-row')];}
  function tools(){return document.querySelector('#cxAdminScanConfig .cx-admin-catalog-tools');}

  function ensure(){
    const host=document.getElementById('cxAdminScanConfig'),base=tools();
    if(!host||!base)return false;
    const oldConfigured=document.getElementById('cxShowConfiguredOnly');
    if(oldConfigured?.closest('label')) oldConfigured.closest('label').style.display='none';
    let nav=host.querySelector('.cx-admin-smart-nav');
    if(!nav){
      nav=document.createElement('div');
      nav.className='cx-admin-smart-nav';
      nav.innerHTML=`<div class="cx-admin-mode-chips" role="group" aria-label="Set visibility">
        <button type="button" data-mode="all">All</button>
        <button type="button" data-mode="enabled">Enabled</button>
        <button type="button" data-mode="configured">Configured</button>
      </div><div class="cx-admin-alpha" aria-label="Jump to set letter"></div>`;
      base.insertAdjacentElement('afterend',nav);
      nav.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;syncMode();});
      const alpha=nav.querySelector('.cx-admin-alpha');
      alpha.innerHTML='#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(x=>`<button type="button" data-letter="${x}">${x}</button>`).join('');
      alpha.querySelectorAll('[data-letter]').forEach(b=>b.onclick=()=>jump(b.dataset.letter));
    }
    syncMode();
    return true;
  }

  function visibleByBase(r){
    const s=document.getElementById('cxSetCatalogSearch');
    const q=String(s?.value||'').trim().toLowerCase();
    const name=String(r.dataset.name||'');
    return !q||name.includes(q);
  }

  function syncMode(){
    const configuredBox=document.getElementById('cxShowConfiguredOnly');
    if(configuredBox)configuredBox.checked=false;
    for(const r of rows()){
      const base=visibleByBase(r);
      const configured=r.classList.contains('cx-admin-configured');
      const enabled=r.classList.contains('cx-admin-enabled');
      const keep=mode==='all'||(mode==='enabled'&&enabled)||(mode==='configured'&&configured);
      r.hidden=!(base&&keep);
    }
    document.querySelectorAll('.cx-admin-mode-chips [data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
    refreshLetters();
  }

  function letterFor(r){
    const n=String(r.dataset.name||'').trim();
    const ch=n.charAt(0).toUpperCase();
    return /[A-Z]/.test(ch)?ch:'#';
  }

  function refreshLetters(){
    const available=new Set(rows().filter(r=>!r.hidden).map(letterFor));
    document.querySelectorAll('.cx-admin-alpha [data-letter]').forEach(b=>b.disabled=!available.has(b.dataset.letter));
  }

  function jump(letter){
    const target=rows().find(r=>!r.hidden&&letterFor(r)===letter);
    if(!target)return;
    target.scrollIntoView({behavior:'smooth',block:'start'});
    target.classList.add('cx-admin-jump-flash');
    setTimeout(()=>target.classList.remove('cx-admin-jump-flash'),900);
  }

  function schedule(){cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>{ensure();syncMode();});}

  document.addEventListener('input',e=>{if(e.target?.id==='cxSetCatalogSearch')schedule()},true);
  document.addEventListener('change',e=>{if(e.target?.closest?.('#cxAdminScanConfig'))schedule()},true);
  document.addEventListener('click',e=>{if(e.target.closest?.('[data-cx-page="admin"]'))setTimeout(schedule,80)},true);
  const mo=new MutationObserver(()=>schedule());
  mo.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden']});

  const style=document.createElement('style');
  style.textContent=`
    .cx-admin-smart-nav{position:sticky;top:0;z-index:8;margin:0 -4px 12px;padding:8px 4px;background:color-mix(in srgb,var(--cx-card) 94%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--cx-line)}
    .cx-admin-mode-chips{display:flex;gap:6px;margin-bottom:8px}.cx-admin-mode-chips button,.cx-admin-alpha button{border:1px solid var(--cx-line);background:var(--cx-card);color:var(--cx-muted);border-radius:999px;font-weight:800;cursor:pointer}
    .cx-admin-mode-chips button{padding:7px 11px;font-size:11px}.cx-admin-mode-chips button.active{background:var(--cx-blue,#2f6df6);color:#fff;border-color:transparent}
    .cx-admin-alpha{display:flex;gap:4px;overflow-x:auto;padding-bottom:2px;scrollbar-width:none}.cx-admin-alpha::-webkit-scrollbar{display:none}.cx-admin-alpha button{flex:0 0 28px;width:28px;height:28px;padding:0;font-size:10px}.cx-admin-alpha button:disabled{opacity:.22;cursor:default}
    .cx-admin-scan-row{scroll-margin-top:92px}.cx-admin-jump-flash{outline:2px solid var(--cx-blue,#2f6df6);outline-offset:2px}
    @media(max-width:980px){.cx-admin-smart-nav{top:0;margin-left:-8px;margin-right:-8px;padding:8px}.cx-admin-mode-chips{overflow-x:auto}.cx-admin-alpha button{flex-basis:30px;width:30px;height:30px}.cx-admin-scan-row{scroll-margin-top:105px}}
  `;
  document.head.appendChild(style);
  setTimeout(schedule,200);
})();
