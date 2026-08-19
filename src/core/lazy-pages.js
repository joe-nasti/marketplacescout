import { registerComponent } from './lifecycle.js';
import store from '../state/store.js';

const loaded=new Set();
const loading=new Map();
const pageLoaders={
  sealed:async()=>{const m=await import('../modules/sealed/index.js');await m.install()},
  seller:async()=>{const m=await import('../modules/seller/index.js');await m.install()},
  syp:async()=>{const m=await import('../modules/seller/syp.js');await m.install()}
};
const title=p=>p==='syp'?'SYP':p[0].toUpperCase()+p.slice(1);
const host=page=>document.getElementById(`cx${page==='syp'?'Syp':page[0].toUpperCase()+page.slice(1)}`);

function showLoading(page){const h=host(page);if(!h||h.dataset.cxLazyReady==='1')return;h.innerHTML=`<div class="cx-page-head"><div><h2>${title(page)}</h2><p>Loading ${title(page)}…</p></div></div><div class="cx-card"><div class="cx-empty">Preparing ${title(page)} data…</div></div>`}
function showError(page,err){const h=host(page);if(!h)return;h.innerHTML=`<div class="cx-page-head"><div><h2>${title(page)}</h2></div></div><div class="cx-card"><div class="cx-empty">Could not load ${title(page)}${err?`: ${String(err.message||err)}`:''}. Reopen the tab to retry.</div></div>`}

export async function loadPage(page){
  const loader=pageLoaders[page];
  if(!loader||loaded.has(page))return;
  if(loading.has(page))return loading.get(page);
  showLoading(page);
  const started=performance.now();
  store.update('runtime',{lazyPage:page,lazyStatus:'loading'});
  const job=loader().then(()=>{
    loaded.add(page);
    const h=host(page);if(h)h.dataset.cxLazyReady='1';
    store.update('runtime',{lazyPage:page,lazyStatus:'ready'});
    document.dispatchEvent(new CustomEvent('collectish:lazy-page-loaded',{detail:{page,ms:Math.round(performance.now()-started)}}));
  }).catch(err=>{
    loaded.delete(page);
    store.update('runtime',{lazyPage:page,lazyStatus:'error',lazyError:String(err?.message||err)});
    showError(page,err);
    throw err;
  }).finally(()=>loading.delete(page));
  loading.set(page,job);
  return job;
}

registerComponent('lazy-pages',{
  onPage(page){if(pageLoaders[page])loadPage(page).catch(()=>{})}
});

window.CollectishLazyDataPages={load:loadPage};
