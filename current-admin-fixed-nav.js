// Collectish Admin fixed navigator — resilient mobile A–Z and quick filters outside the Admin renderer.
(() => {
  let mode='all';
  let lastAdminActive=false;
  const letters='#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  const rows=()=>[...document.querySelectorAll('#cxAdminScanConfig .cx-admin-scan-row')];
  const adminActive=()=>Boolean(document.getElementById('cxAdmin')?.classList.contains('active'));
  const searchValue=()=>String(document.getElementById('cxSetCatalogSearch')?.value||'').trim().toLowerCase();
  const letterFor=r=>{const ch=String(r.dataset.name||'').trim().charAt(0).toUpperCase();return /[A-Z]/.test(ch)?ch:'#';};

  function ensureNav(){
    let nav=document.getElementById('cxAdminFixedNav');
    if(nav)return nav;
    nav=document.createElement('div');
    nav.id='cxAdminFixedNav';
    nav.className='cx-admin-fixed-nav';
    nav.innerHTML=`<div class="cx-admin-fixed-modes">
      <button type="button" data-mode="all">All</button>
      <button type="button" data-mode="enabled">Enabled</button>
      <button type="button" data-mode="configured">Configured</button>
    </div><div class="cx-admin-fixed-alpha">${letters.map(l=>`<button type="button" data-letter="${l}">${l}</button>`).join('')}</div>`;
    document.body.appendChild(nav);
    nav.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{mode=b.dataset.mode;apply();}));
    nav.querySelectorAll('[data-letter]').forEach(b=>b.addEventListener('click',()=>jump(b.dataset.letter)));
    return nav;
  }

  function baseVisible(r){const q=searchValue();return !q||String(r.dataset.name||'').includes(q);}

  function apply(){
    const nav=ensureNav();
    const active=adminActive()&&rows().length>0;
    nav.classList.toggle('show',active);
    document.body.classList.toggle('cx-admin-fixed-nav-open',active);
    if(!active)return;

    const old=document.getElementById('cxShowConfiguredOnly');
    if(old?.closest('label'))old.closest('label').style.display='none';

    for(const r of rows()){
      const configured=r.classList.contains('cx-admin-configured');
      const enabled=r.classList.contains('cx-admin-enabled');
      const keep=mode==='all'||(mode==='enabled'&&enabled)||(mode==='configured'&&configured);
      r.hidden=!(baseVisible(r)&&keep);
    }
    nav.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
    const available=new Set(rows().filter(r=>!r.hidden).map(letterFor));
    nav.querySelectorAll('[data-letter]').forEach(b=>b.disabled=!available.has(b.dataset.letter));
  }

  function jump(letter){
    const target=rows().find(r=>!r.hidden&&letterFor(r)===letter);
    if(!target)return;
    target.scrollIntoView({behavior:'smooth',block:'start'});
    target.classList.add('cx-admin-jump-flash');
    setTimeout(()=>target.classList.remove('cx-admin-jump-flash'),900);
  }

  const style=document.createElement('style');
  style.textContent=`
    .cx-admin-fixed-nav{display:none}
    @media(max-width:980px){
      .cx-admin-fixed-nav{position:fixed;left:8px;right:8px;bottom:72px;z-index:9999;padding:8px;border:1px solid var(--cx-line);border-radius:14px;background:rgba(255,255,255,.97);box-shadow:0 8px 28px rgba(15,23,42,.18);backdrop-filter:blur(12px)}
      .cx-admin-fixed-nav.show{display:block}
      .cx-admin-fixed-modes{display:flex;gap:6px;margin-bottom:7px;overflow-x:auto}
      .cx-admin-fixed-modes button,.cx-admin-fixed-alpha button{border:1px solid var(--cx-line);background:var(--cx-card);color:var(--cx-muted);border-radius:999px;font-weight:800}
      .cx-admin-fixed-modes button{padding:7px 11px;font-size:11px}.cx-admin-fixed-modes button.active{background:var(--cx-blue,#2f6df6);color:#fff;border-color:transparent}
      .cx-admin-fixed-alpha{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none}.cx-admin-fixed-alpha::-webkit-scrollbar{display:none}
      .cx-admin-fixed-alpha button{flex:0 0 30px;width:30px;height:30px;padding:0;font-size:10px}.cx-admin-fixed-alpha button:disabled{opacity:.22}
      body.cx-admin-fixed-nav-open #cxAdmin{padding-bottom:150px}
      #cxAdmin .cx-admin-scan-row{scroll-margin-top:18px;scroll-margin-bottom:155px}
      #cxAdmin .cx-admin-jump-flash{outline:2px solid var(--cx-blue,#2f6df6);outline-offset:2px}
    }
  `;
  document.head.appendChild(style);

  document.addEventListener('input',e=>{if(e.target?.id==='cxSetCatalogSearch')setTimeout(apply,0)},true);
  document.addEventListener('change',e=>{if(e.target?.closest?.('#cxAdminScanConfig'))setTimeout(apply,0)},true);
  document.addEventListener('click',e=>{if(e.target.closest?.('[data-cx-page]'))setTimeout(apply,80)},true);

  // Deliberately simple polling makes this independent of Admin re-render timing.
  setInterval(()=>{
    const active=adminActive();
    if(active!==lastAdminActive||active){lastAdminActive=active;apply();}
  },500);
  setTimeout(apply,250);
})();
