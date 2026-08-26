import store from '../../state/store.js';

let installed=false;
let globalDetailOpen=false;
const productIdFromHref=href=>String(href||'').match(/\/product\/(\d+)/)?.[1]||'';
const parts=text=>String(text||'').split(' · ').map(x=>x.trim());

function cachedMarketplaceRows(productId){
  const resources=store.get().resources||{};
  const rows=[];
  for(const [key,resource] of Object.entries(resources)){
    if(!key.includes('marketplace_scan_rows?')||!Array.isArray(resource?.data))continue;
    for(const row of resource.data){
      if(String(row?.product_id||'')===String(productId))rows.push(row);
    }
  }
  return rows;
}

function productIdFor(article){
  const link=article?.querySelector('.cx-global-print-foot a[href*="/product/"]');
  return productIdFromHref(link?.href);
}

function displayedVariant(article,target){
  return target?.closest?.('.cx-global-market>div')||article?.querySelector('.cx-global-market>div')||null;
}

function rowFor(article,target){
  const productId=productIdFor(article);
  if(!productId)return null;
  const variant=displayedVariant(article,target);
  if(!variant)return null;
  const [printing='',condition='',language='']=parts(variant.querySelector('span')?.textContent);
  return cachedMarketplaceRows(productId).find(row=>
    String(row?.printing||'')===printing&&
    String(row?.condition||'')===condition&&
    String(row?.language||'')===language&&
    row?.sku_id!=null
  )||null;
}

function globalModeActive(){return !document.getElementById('cxGlobalScoutSearch')?.hidden}
function revealDetailSurface(){
  const scout=document.getElementById('cxScout');
  const layout=scout?.querySelector('.cx-scout-layout');
  if(!layout||!globalModeActive())return;
  globalDetailOpen=true;
  scout.classList.add('cx-global-search-detail-open');
  layout.hidden=false;
}
function restoreGlobalSurface(){
  if(!globalDetailOpen)return;
  globalDetailOpen=false;
  const scout=document.getElementById('cxScout');
  scout?.classList.remove('cx-global-search-detail-open');
  const layout=scout?.querySelector('.cx-scout-layout');
  if(layout&&globalModeActive())layout.hidden=true;
}

function openRow(row){
  if(!row?.sku_id)return false;
  revealDetailSurface();
  const nav=window.CollectishScoutDetailNavigation;
  if(nav?.open?.(row))return true;
  document.dispatchEvent(new CustomEvent('collectish:open-scout-card',{detail:row}));
  return true;
}

function ignoredTarget(target){
  return Boolean(target?.closest?.('a,button,input,select,textarea,label'));
}

function click(event){
  if(event.target?.closest?.('.cx-mobile-detail-close')){
    queueMicrotask(restoreGlobalSurface);
    return;
  }
  if(ignoredTarget(event.target))return;
  const article=event.target?.closest?.('#cxGlobalScoutSearch .cx-global-print');
  if(!article)return;
  const row=rowFor(article,event.target);
  if(!row)return;
  if(openRow(row)){
    event.preventDefault();
    event.stopPropagation();
  }
}

function keydown(event){
  if(event.key==='Escape'&&globalDetailOpen){queueMicrotask(restoreGlobalSurface);return}
  if(event.key!=='Enter'&&event.key!==' ')return;
  const article=event.target?.closest?.('#cxGlobalScoutSearch .cx-global-print[data-detail-ready="true"]');
  if(!article||event.target!==article)return;
  const row=rowFor(article,article);
  if(!row)return;
  event.preventDefault();
  openRow(row);
}

function markSelectable(){
  document.querySelectorAll('#cxGlobalScoutSearch .cx-global-print').forEach(article=>{
    const ready=Boolean(article.querySelector('.cx-global-market>div'));
    article.dataset.detailReady=String(ready);
    if(ready){
      article.tabIndex=0;
      article.setAttribute('role','button');
      article.setAttribute('aria-label','Open card details');
    }else{
      article.removeAttribute('tabindex');
      article.removeAttribute('role');
      article.removeAttribute('aria-label');
    }
  });
}

function install(){
  if(installed)return;
  installed=true;
  document.addEventListener('click',click);
  document.addEventListener('keydown',keydown);
  document.addEventListener('collectish:scout-global-rendered',()=>{restoreGlobalSurface();markSelectable()});
  markSelectable();
  const style=document.createElement('style');
  style.textContent=`#cxGlobalScoutSearch .cx-global-print[data-detail-ready="true"]{cursor:pointer}#cxGlobalScoutSearch .cx-global-print[data-detail-ready="true"]:focus-visible{outline:2px solid var(--cx-primary,#1473e6);outline-offset:2px}#cxGlobalScoutSearch .cx-global-print[data-detail-ready="true"] .cx-global-market>div{cursor:pointer}#cxScout.cx-global-search-detail-open .cx-scout-layout>section{display:none!important}#cxScout.cx-global-search-detail-open .cx-scout-layout{display:block!important}#cxScout.cx-global-search-detail-open #cxParityDetail{display:block!important}@media(max-width:980px){#cxScout.cx-global-search-detail-open .cx-scout-layout{display:block!important}}`;
  document.head.appendChild(style);
}

install();
