import store from '../../state/store.js';

let installed=false;
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

function skuFor(article,target){
  const productId=productIdFor(article);
  if(!productId)return'';
  const variant=displayedVariant(article,target);
  if(!variant)return'';
  const [printing='',condition='',language='']=parts(variant.querySelector('span')?.textContent);
  const rows=cachedMarketplaceRows(productId);
  const exact=rows.find(row=>
    String(row?.printing||'')===printing&&
    String(row?.condition||'')===condition&&
    String(row?.language||'')===language&&
    row?.sku_id!=null
  );
  return String(exact?.sku_id||'');
}

function openSku(sku){
  if(!sku)return false;
  const nav=window.CollectishScoutDetailNavigation;
  if(nav?.open?.({sku_id:sku}))return true;
  document.dispatchEvent(new CustomEvent('collectish:open-scout-card',{detail:{sku_id:sku}}));
  return true;
}

function ignoredTarget(target){
  return Boolean(target?.closest?.('a,button,input,select,textarea,label'));
}

function click(event){
  if(ignoredTarget(event.target))return;
  const article=event.target?.closest?.('#cxGlobalScoutSearch .cx-global-print');
  if(!article)return;
  const sku=skuFor(article,event.target);
  if(!sku)return;
  if(openSku(sku)){
    event.preventDefault();
    event.stopPropagation();
  }
}

function keydown(event){
  if(event.key!=='Enter'&&event.key!==' ')return;
  const article=event.target?.closest?.('#cxGlobalScoutSearch .cx-global-print[data-detail-ready="true"]');
  if(!article||event.target!==article)return;
  const sku=skuFor(article,article);
  if(!sku)return;
  event.preventDefault();
  openSku(sku);
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
  document.addEventListener('collectish:scout-global-rendered',markSelectable);
  markSelectable();
  const style=document.createElement('style');
  style.textContent='#cxGlobalScoutSearch .cx-global-print[data-detail-ready="true"]{cursor:pointer}#cxGlobalScoutSearch .cx-global-print[data-detail-ready="true"]:focus-visible{outline:2px solid var(--cx-primary,#1473e6);outline-offset:2px}#cxGlobalScoutSearch .cx-global-print[data-detail-ready="true"] .cx-global-market>div{cursor:pointer}';
  document.head.appendChild(style);
}

install();
