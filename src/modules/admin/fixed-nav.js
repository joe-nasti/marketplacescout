// Collectish Admin Singles navigator — in-flow sticky A–Z and configured/enabled filters.
(() => {
  let mode='all',activeLetter='',scrollRaf=0,suppressScrollTrackUntil=0;
  const letters='#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const rows=()=>[...document.querySelectorAll('#cxAdminScanConfig .cx-admin-scan-row')];
  const singlesActive=()=>Boolean(document.getElementById('cxAdmin')?.classList.contains('active')&&document.getElementById('cxAdminConsole')?.dataset.activeSection==='singles');
  const searchValue=()=>String(document.getElementById('cxSetCatalogSearch')?.value||'').trim().toLowerCase();
  const letterFor=r=>{const ch=String(r.dataset.name||'').trim().charAt(0).toUpperCase();return /[A-Z]/.test(ch)?ch:'#';};

  function target(){return document.querySelector('#cxAdminSinglesModules')}
  function ensureNav(){
    let nav=document.getElementById('cxAdminFixedNav');
    const parent=target();if(!parent)return nav;
    if(!nav){
      nav=document.createElement('div');nav.id='cxAdminFixedNav';nav.className='cx-admin-fixed-nav cx-ui-tabs';
      nav.innerHTML=`<div class="cx-admin-fixed-modes"><button type="button" data-mode="all">All</button><button type="button" data-mode="enabled">Enabled</button><button type="button" data-mode="configured">Configured</button></div><div class="cx-admin-fixed-alpha">${letters.map(l=>`<button type="button" data-letter="${l}">${l}</button>`).join('')}</div>`;
      nav.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;apply();trackCurrentLetter(true)});
      nav.querySelectorAll('[data-letter]').forEach(b=>b.onclick=()=>jump(b.dataset.letter));
    }
    if(nav.parentElement!==parent)parent.prepend(nav);
    return nav;
  }
  function baseVisible(r){const q=searchValue();return !q||String(r.dataset.name||'').includes(q)}
  function setActiveLetter(letter,center=false){const nav=ensureNav();if(!nav||!letter)return;activeLetter=letter;nav.querySelectorAll('[data-letter]').forEach(b=>b.classList.toggle('active-letter',b.dataset.letter===letter));const btn=nav.querySelector(`[data-letter="${letter}"]`);if(btn&&center)try{btn.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'})}catch{}}
  function apply(){
    const nav=ensureNav();if(!nav)return;const active=singlesActive()&&rows().length>0;
    nav.classList.toggle('show',active);if(!active)return;
    const old=document.getElementById('cxShowConfiguredOnly');if(old?.closest('label'))old.closest('label').style.display='none';
    for(const r of rows()){const configured=r.classList.contains('cx-admin-configured'),enabled=r.classList.contains('cx-admin-enabled'),keep=mode==='all'||(mode==='enabled'&&enabled)||(mode==='configured'&&configured);r.hidden=!(baseVisible(r)&&keep)}
    nav.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
    const available=new Set(rows().filter(r=>!r.hidden).map(letterFor));nav.querySelectorAll('[data-letter]').forEach(b=>b.disabled=!available.has(b.dataset.letter));if(activeLetter&&!available.has(activeLetter))activeLetter='';trackCurrentLetter(false);
  }
  function jump(letter){const targetRow=rows().find(r=>!r.hidden&&letterFor(r)===letter);if(!targetRow)return;setActiveLetter(letter,true);suppressScrollTrackUntil=Date.now()+700;targetRow.scrollIntoView({behavior:'smooth',block:'start'});targetRow.classList.add('cx-admin-jump-flash');setTimeout(()=>targetRow.classList.remove('cx-admin-jump-flash'),900)}
  function trackCurrentLetter(center=false){if(!singlesActive()||Date.now()<suppressScrollTrackUntil)return;const visible=rows().filter(r=>!r.hidden);if(!visible.length)return;const guide=Math.max(130,window.innerHeight*.18);let current=visible[0];for(const r of visible){if(r.getBoundingClientRect().top<=guide)current=r;else break}const letter=letterFor(current);if(letter!==activeLetter||center)setActiveLetter(letter,true)}
  function onScroll(){if(scrollRaf)return;scrollRaf=requestAnimationFrame(()=>{scrollRaf=0;trackCurrentLetter(false)})}

  const style=document.createElement('style');style.textContent=`
.cx-admin-fixed-nav{display:none;position:sticky;top:58px;z-index:34;padding:8px;margin:0 0 10px;border:1px solid var(--color-border);border-radius:12px;background:color-mix(in srgb,var(--color-bg-surface) 96%,transparent);box-shadow:var(--shadow-card);backdrop-filter:blur(12px)}.cx-admin-fixed-nav.show{display:block}.cx-admin-fixed-modes,.cx-admin-fixed-alpha{display:flex;gap:5px;overflow-x:auto;scrollbar-width:none}.cx-admin-fixed-alpha{margin-top:6px;scroll-behavior:smooth}.cx-admin-fixed-modes::-webkit-scrollbar,.cx-admin-fixed-alpha::-webkit-scrollbar{display:none}.cx-admin-fixed-modes button,.cx-admin-fixed-alpha button{border:1px solid var(--color-border);background:var(--color-bg-surface);color:var(--color-text-secondary);border-radius:999px;font-weight:800;white-space:nowrap}.cx-admin-fixed-modes button{padding:6px 10px;font-size:10px}.cx-admin-fixed-modes button.active,.cx-admin-fixed-alpha button.active-letter{background:var(--color-accent);color:#fff;border-color:transparent}.cx-admin-fixed-alpha button{flex:0 0 28px;width:28px;height:28px;padding:0;font-size:9px}.cx-admin-fixed-alpha button:disabled{opacity:.22}#cxAdmin .cx-admin-scan-row{scroll-margin-top:170px}#cxAdmin .cx-admin-jump-flash{outline:2px solid var(--color-accent);outline-offset:2px}@media(max-width:560px){.cx-admin-fixed-nav{top:52px;margin:0 0 8px;padding:7px}.cx-admin-fixed-modes button{padding:6px 9px}.cx-admin-fixed-alpha button{flex-basis:27px;width:27px;height:27px}}
`;document.head.appendChild(style);
  document.addEventListener('input',e=>{if(e.target?.id==='cxSetCatalogSearch')setTimeout(()=>{apply();trackCurrentLetter(true)},0)},true);
  document.addEventListener('change',e=>{if(e.target?.closest?.('#cxAdminScanConfig'))setTimeout(()=>{apply();trackCurrentLetter(true)},0)},true);
  document.addEventListener('collectish:admin-section-change',()=>setTimeout(()=>{apply();trackCurrentLetter(true)},0));
  document.addEventListener('collectish:admin-modules-ready',()=>setTimeout(()=>{ensureNav();apply()},40));
  document.addEventListener('click',e=>{if(e.target.closest?.('[data-cx-page]'))setTimeout(()=>{ensureNav();apply();trackCurrentLetter(true)},120)},true);
  window.addEventListener('scroll',onScroll,{passive:true});document.addEventListener('scroll',onScroll,{passive:true,capture:true});
  setTimeout(()=>{ensureNav();apply();trackCurrentLetter(true)},250);
})();
