// Global web revision/build badge for Collectish.
(() => {
  const VERSION=window.COLLECTISH_WEB_VERSION||'0.9.52';
  const loadedRevision=document.querySelector('meta[name="collectish-revision"]')?.content||'—';
  const loadedBuild=document.querySelector('meta[name="collectish-build"]')?.content||'—';
  let latest=null;

  const fmtDate=v=>{if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString()};
  const short=v=>v&&v!=='—'?String(v).slice(0,8):'—';

  async function fetchLatest(){
    try{
      const r=await fetch(`web-version.json?cb=${Date.now()}`,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
      if(!r.ok)return null;
      latest=await r.json();
      return latest;
    }catch{return null}
  }

  function updateBadge(){
    const text=`web ${VERSION} · ${loadedRevision}`;
    document.querySelectorAll('.cx-top-version,.cx-version').forEach(el=>{
      el.textContent=text;
      el.classList.add('cx-build-badge');
      el.setAttribute('role','button');
      el.setAttribute('tabindex','0');
      el.setAttribute('aria-label','Show web build details');
    });
    document.querySelectorAll('.cx-side-meta').forEach(el=>{
      const lines=String(el.innerHTML||'').split('<br>');
      if(lines.length)el.innerHTML=`${text}<br>${lines.slice(1).join('<br>')}`;
    });
  }

  function close(){document.getElementById('cxBuildInfo')?.remove()}
  async function open(){
    const d=await fetchLatest();
    const current=Boolean(d&&String(d.build||'')===String(loadedBuild||''));
    const wrap=document.createElement('div');wrap.id='cxBuildInfo';wrap.className='cx-build-info';
    wrap.innerHTML=`<div class="cx-build-info-backdrop"></div><section class="cx-build-info-card" role="dialog" aria-modal="true" aria-label="Collectish build details"><div class="cx-build-info-head"><strong>Web build</strong><button type="button" aria-label="Close">×</button></div><div class="cx-build-info-status ${current?'good':d?'warn':'neutral'}">${current?'CURRENT':d?'UPDATE AVAILABLE':'CHECK UNAVAILABLE'}</div><dl><dt>Web version</dt><dd>${VERSION}</dd><dt>Loaded revision</dt><dd>${loadedRevision}</dd><dt>Latest revision</dt><dd>${d?.label||'—'}</dd><dt>Loaded build</dt><dd><code>${short(loadedBuild)}</code></dd><dt>Latest build</dt><dd><code>${short(d?.build)}</code></dd><dt>Deployed</dt><dd>${fmtDate(d?.deployed_at)}</dd></dl>${!current&&d?'<button type="button" class="cx-build-reload">Reload latest</button>':''}</section>`;
    document.body.append(wrap);
    wrap.querySelector('.cx-build-info-backdrop').onclick=close;
    wrap.querySelector('.cx-build-info-head button').onclick=close;
    wrap.querySelector('.cx-build-reload')?.addEventListener('click',()=>{const u=new URL(location.href);u.searchParams.set('cv',String(d.build||Date.now()));u.searchParams.set('_cb',String(Date.now()));location.replace(u.toString())});
  }

  document.addEventListener('click',e=>{if(e.target.closest?.('.cx-top-version,.cx-version'))open()},true);
  document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.closest?.('.cx-top-version,.cx-version')){e.preventDefault();open()}});
  document.addEventListener('collectish:ready',()=>setTimeout(updateBadge,0));
  new MutationObserver(updateBadge).observe(document.documentElement,{childList:true,subtree:true});
  updateBadge();
})();
