// Collectish global web revision badge + build diagnostics.
(() => {
  const version=()=>window.COLLECTISH_WEB_VERSION||'0.9.52';
  const loadedBuild=()=>document.querySelector('meta[name="collectish-build"]')?.content||'unknown';
  const loadedRevision=()=>document.querySelector('meta[name="collectish-revision"]')?.content||'r?';
  const short=s=>String(s||'').slice(0,8)||'unknown';
  const label=()=>`web ${version()} · ${loadedRevision()}`;

  function decorate(){
    const text=label();
    document.querySelectorAll('.cx-top-version,.cx-version').forEach(el=>{
      if(el.textContent!==text)el.textContent=text;
      if(el.dataset.cxBuildBadge!=='1')el.dataset.cxBuildBadge='1';
      if(el.getAttribute('role')!=='button')el.setAttribute('role','button');
      if(el.getAttribute('tabindex')!=='0')el.setAttribute('tabindex','0');
      if(el.getAttribute('aria-label')!=='Show Collectish build details')el.setAttribute('aria-label','Show Collectish build details');
      if(el.title!=='Show build details')el.title='Show build details';
    });
    document.querySelectorAll('.cx-side-meta').forEach(el=>{
      const html=`${text}<br>Smarter data. Better decisions.`;
      if(el.innerHTML!==html)el.innerHTML=html;
      if(el.dataset.cxBuildBadge!=='1')el.dataset.cxBuildBadge='1';
      if(el.getAttribute('role')!=='button')el.setAttribute('role','button');
      if(el.getAttribute('tabindex')!=='0')el.setAttribute('tabindex','0');
      if(el.title!=='Show build details')el.title='Show build details';
    });
    document.querySelectorAll('#cxAdmin .cx-detail-stat').forEach(row=>{
      const k=(row.querySelector('span')?.textContent||'').trim();
      const strong=row.querySelector('strong');
      const next=`${version()} · ${loadedRevision()}`;
      if(k==='Web UI'&&strong&&strong.textContent!==next)strong.textContent=next;
    });
  }

  function modalHtml(info={}){
    const liveBuild=String(info.build||'unknown'),liveRev=info.label|| (info.revision?`r${info.revision}`:'r?');
    const current=liveBuild===loadedBuild();
    const deployed=info.deployed_at?new Date(info.deployed_at).toLocaleString():'—';
    return `<div class="cx-build-dialog-card" role="dialog" aria-modal="true" aria-label="Collectish build details">
      <div class="cx-build-dialog-head"><strong>Collectish web build</strong><button type="button" data-build-close>×</button></div>
      <div class="cx-build-status ${current?'good':'warn'}">${current?'CURRENT':'UPDATE AVAILABLE'}</div>
      <div class="cx-build-grid">
        <span>Web version</span><b>${version()}</b>
        <span>Loaded revision</span><b>${loadedRevision()}</b>
        <span>Latest revision</span><b>${liveRev}</b>
        <span>Loaded build</span><code>${short(loadedBuild())}</code>
        <span>Latest build</span><code>${short(liveBuild)}</code>
        <span>Latest deployed</span><b>${deployed}</b>
      </div>
      ${current?'':'<button type="button" class="cx-build-reload" data-build-reload>Reload latest build</button>'}
    </div>`;
  }

  async function open(){
    document.getElementById('cxBuildDialog')?.remove();
    let info={};
    try{
      const r=await fetch(`build-version.json?cb=${Date.now()}`,{cache:'no-store'});
      if(r.ok)info=await r.json();
    }catch{}
    const wrap=document.createElement('div');
    wrap.id='cxBuildDialog';wrap.className='cx-build-dialog';wrap.innerHTML=modalHtml(info);
    document.body.appendChild(wrap);
    const close=()=>wrap.remove();
    wrap.querySelector('[data-build-close]')?.addEventListener('click',close);
    wrap.addEventListener('click',e=>{if(e.target===wrap)close()});
    wrap.querySelector('[data-build-reload]')?.addEventListener('click',()=>{
      const build=String(info.build||Date.now());
      const u=new URL(location.href);u.searchParams.set('cv',build);u.searchParams.set('_cb',Date.now());location.replace(u.toString());
    });
  }

  document.addEventListener('click',e=>{if(e.target.closest?.('[data-cx-build-badge="1"]'))open()},true);
  document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target?.dataset?.cxBuildBadge==='1'){e.preventDefault();open()}},true);
  document.addEventListener('collectish:ready',()=>{decorate();setTimeout(decorate,250);setTimeout(decorate,1000)});
  const obs=new MutationObserver(()=>queueMicrotask(decorate));
  obs.observe(document.body,{childList:true,subtree:false});
  decorate();
})();
