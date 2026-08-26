import { registerComponent } from './lifecycle.js';
import store from '../state/store.js';
import { primeResources } from '../state/resources.js';

const loaded=new Set();
const loading=new Map();
const prefetched=new Map();
const prefetching=new Map();

const pageModules={
  signals:()=>import('../modules/signals/index.js'),
  sealed:()=>import('../modules/sealed/index.js'),
  seller:()=>import('../modules/seller/index.js'),
  syp:()=>import('../modules/seller/syp.js'),
  inventory:()=>import('../modules/seller/inventory-index.js'),
  admin:()=>import('../modules/admin/index.js')
};
const routePrime={
  sealed:[
    {key:'sealed.rows',scope:'user',maxStale:7*24*60*60*1000},
    {key:'sealed.setTypes',scope:'user',maxStale:30*24*60*60*1000}
  ]
};
const title=p=>p==='syp'?'SYP':p[0].toUpperCase()+p.slice(1);
const host=page=>document.getElementById(`cx${page==='syp'?'Syp':page[0].toUpperCase()+page.slice(1)}`);
const buildId=()=>document.querySelector('meta[name="collectish-build"]')?.content?.trim()||'unknown';
const dynamicImportFailure=err=>/failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module/i.test(String(err?.message||err||''));

function moduleFor(page){
  if(prefetched.has(page))return prefetched.get(page);
  const importer=pageModules[page];
  if(!importer)return null;
  const job=importer().catch(error=>{prefetched.delete(page);throw error});
  prefetched.set(page,job);
  return job;
}

export function prefetchPage(page){
  if(!pageModules[page]||loaded.has(page)||loading.has(page))return null;
  if(prefetching.has(page))return prefetching.get(page);
  const started=performance.now();
  const jobs=[moduleFor(page)];
  if(routePrime[page]?.length)jobs.push(primeResources(routePrime[page]).catch(()=>0));
  const job=Promise.all(jobs).then(()=>{
    document.dispatchEvent(new CustomEvent('collectish:lazy-page-prefetched',{detail:{page,ms:Math.round(performance.now()-started)}}));
  }).catch(()=>{}).finally(()=>prefetching.delete(page));
  prefetching.set(page,job);
  return job;
}

function recoverStaleModule(page,err){
  if(!dynamicImportFailure(err))return false;
  const key=`collectishLazyRecover:${buildId()}:${page}`;
  try{
    if(sessionStorage.getItem(key)==='1')return false;
    sessionStorage.setItem(key,'1');
  }catch{}
  store.update('runtime',{lazyPage:page,lazyStatus:'recovering',lazyError:String(err?.message||err)});
  const next=new URL(location.href);
  next.searchParams.set('_lazy_recover',Date.now().toString());
  location.replace(next.toString());
  return true;
}

function setLoading(page,isLoading){
  const h=host(page);if(!h)return;
  h.dataset.cxLazyStatus=isLoading?'loading':'ready';
  if(isLoading)h.setAttribute('aria-busy','true');else h.removeAttribute('aria-busy');
}
function showError(page,err){const h=host(page);if(!h)return;h.dataset.cxLazyStatus='error';h.removeAttribute('aria-busy');h.innerHTML=`<div class="cx-page-head"><div><h2>${title(page)}</h2></div></div><div class="cx-card"><div class="cx-empty">Could not load ${title(page)}${err?`: ${String(err.message||err)}`:''}. Reopen the tab to retry.</div></div>`}

export async function loadPage(page){
  if(!pageModules[page]||loaded.has(page))return;
  if(loading.has(page))return loading.get(page);
  setLoading(page,true);
  const started=performance.now();
  store.update('runtime',{lazyPage:page,lazyStatus:'loading'});
  const job=(async()=>{
    const m=await moduleFor(page);
    await m.install();
  })().then(()=>{
    loaded.add(page);
    const h=host(page);if(h)h.dataset.cxLazyReady='1';
    setLoading(page,false);
    store.update('runtime',{lazyPage:page,lazyStatus:'ready'});
    document.dispatchEvent(new CustomEvent('collectish:lazy-page-loaded',{detail:{page,ms:Math.round(performance.now()-started)}}));
  }).catch(err=>{
    loaded.delete(page);
    if(recoverStaleModule(page,err))return;
    store.update('runtime',{lazyPage:page,lazyStatus:'error',lazyError:String(err?.message||err)});
    showError(page,err);
    throw err;
  }).finally(()=>loading.delete(page));
  loading.set(page,job);
  return job;
}

registerComponent('lazy-pages',{
  onPage(page){if(pageModules[page])loadPage(page).catch(()=>{})}
});

window.CollectishLazyDataPages={load:loadPage,prefetch:prefetchPage};
