import { rest } from '../../core/rest.js';
import { readSession } from '../../core/session.js';
import { registerComponent } from '../../core/lifecycle.js';
import store from '../../state/store.js';

const SEARCH_URL='https://store.tcgplayer.com/admin/product/searchcatalog';
const QUANTITY_URL='https://store.tcgplayer.com/admin/product/updateinstockquantities';
const MANAGE_URL=id=>`https://store.tcgplayer.com/admin/product/manage/${encodeURIComponent(id)}?OnlyMyInventory=true&CategoryId=1&SetNameId=0&Rarity=0&IsSealed=false&DidSearch=true`;
const REQUESTED_PAGE_SIZE=250;
const AUTO_ENRICH=20;
let syncing=false;
let stopRequested=false;
let selectedProductId=null;
let rows=[];
let conditionRows=[];
let scoutByProduct=new Map();
let salesByProduct=new Map();

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
const num=n=>Number(n||0).toLocaleString();
const fmt=t=>t?new Date(t).toLocaleString():'—';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const userId=()=>readSession()?.user?.id||'';
const bridge=()=>window.CollectishReadOnly;

function syncState(patch){store.update('inventory',patch)}
function hasInventoryBridge(){const b=bridge();return Boolean(b&&typeof b.startReadOnlyProbe==='function'&&typeof b.getReadOnlyProbeState==='function'&&typeof b.getReadOnlyProbeResult==='function')}

async function probe(config,{timeoutMs=60_000}={}){
  const b=bridge();
  if(!hasInventoryBridge())throw new Error('Authenticated Store inventory sync requires the current Collectish Android app.');
  b.startReadOnlyProbe(JSON.stringify(config));
  const started=Date.now();
  let state='starting';
  while(Date.now()-started<timeoutMs){
    await sleep(350);
    state=String(b.getReadOnlyProbeState?.()||'unknown');
    if(state==='ready'||state==='error')break;
  }
  let out={};try{out=JSON.parse(String(b.getReadOnlyProbeResult?.()||'{}'))}catch{out={error:'Inventory probe returned invalid JSON'}}
  if(state!=='ready'||out?.error)throw new Error(out?.error||`Inventory probe ${state==='error'?'failed':'timed out'}`);
  return out;
}

function catalogBody(pageIndex){
  return {SearchOptions:{SearchValue:'',OnlyMyInventory:true,ListingType:'AllListings',SortColumn:'GameName',SortDirection:'ASC',PageIndex:pageIndex,ItemsPerPage:String(REQUESTED_PAGE_SIZE),CategoryId:'1',SetNameId:'0',Rarity:'0',IsSealed:''}};
}

function quantityBody(products){return {productIds:products.map(x=>Number(x.ProductId)),cachedProductQuantities:products.map(x=>Number(x.Quantity||0)),onlyMyInventory:true,onlyListos:false}}

function normalizeProduct(product,quantity,capturedAt){
  return {
    user_id:userId(),product_id:String(product.ProductId),product_line:product.ProductLine||null,product_name:product.ProductName||null,set_name:product.SetName||null,rarity:product.Rarity||null,card_number:product.Number||null,
    image_75:product.Image75||null,image_200:product.Image200||null,image_400:product.Image400||null,quantity:Number(quantity?.Quantity??product.Quantity??0)||0,has_photos:Boolean(quantity?.HasPhotos??product.HasPhotos),is_presale:Boolean(product.IsPresale),captured_at:capturedAt,raw_json:{catalog:product,quantity:quantity||null}
  };
}

function extractSearchResults(html){
  const text=String(html||''),marker='searchResults:';
  const i=text.indexOf(marker);if(i<0)throw new Error('Store manage page did not contain searchResults');
  const start=text.indexOf('[',i+marker.length);if(start<0)throw new Error('Store manage searchResults array was missing');
  let depth=0,inString=false,escaped=false,end=-1;
  for(let p=start;p<text.length;p++){
    const ch=text[p];
    if(inString){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')inString=false;continue}
    if(ch==='"'){inString=true;continue}
    if(ch==='[')depth++;
    if(ch===']'){depth--;if(depth===0){end=p+1;break}}
  }
  if(end<0)throw new Error('Store manage searchResults array was incomplete');
  return JSON.parse(text.slice(start,end));
}

function normalizeCondition(x,capturedAt){
  const prices=Array.isArray(x.Prices)?x.Prices:[];
  const primary=prices.find(p=>Number(p.ChannelId||0)===0)||prices[0]||{};
  return {
    user_id:userId(),product_condition_id:String(x.ProductConditionId),product_id:String(x.ProductId),condition_id:x.ConditionId==null?null:Number(x.ConditionId),condition_name:x.ConditionName||null,category_name:x.CategoryName||null,language_name:x.LanguageName||null,sub_type_name:x.SubTypeName||null,
    quantity:x.Quantity==null?null:Number(x.Quantity),pending_quantity:x.PendingQuantity==null?null:Number(x.PendingQuantity),price:x.Price==null?null:Number(x.Price),reserve_quantity:primary.ReserveQuantity==null?null:Number(primary.ReserveQuantity),market_price:x.MarketPrice==null?null:Number(x.MarketPrice),lowest_price:x.LowestPrice==null?null:Number(x.LowestPrice),lowest_shipping:x.LowestShipping==null?null:Number(x.LowestShipping),next_lowest_price:x.NextLowestPrice==null?null:Number(x.NextLowestPrice),next_lowest_shipping:x.NextLowestPriceShipping==null?null:Number(x.NextLowestPriceShipping),last_sold_price:x.LastSoldPrice==null?null:Number(x.LastSoldPrice),last_sold_shipping:x.LastSoldShipping==null?null:Number(x.LastSoldShipping),seller_has_lowest_price:Boolean(x.SellerHasLowestPrice),captured_at:capturedAt,raw_json:x
  };
}

async function upsertSyncState(patch){
  const uid=userId();if(!uid)return;
  await rest('store_inventory_sync_state?on_conflict=user_id',{method:'POST',body:[{user_id:uid,updated_at:new Date().toISOString(),...patch}],prefer:'resolution=merge-duplicates,return=minimal'});
}

async function enrichProduct(productId,{quiet=false}={}){
  if(!productId)return [];
  if(!quiet)syncState({detailStatus:'loading',detailProductId:String(productId)});
  const out=await probe({mode:'fetch_html',method:'GET',url:MANAGE_URL(productId)});
  const capturedAt=new Date().toISOString();
  const parsed=extractSearchResults(out.body);
  const normalized=parsed.map(x=>normalizeCondition(x,capturedAt)).filter(x=>Number(x.quantity||0)>0||Number(x.pending_quantity||0)>0||Number(x.reserve_quantity||0)>0);
  await rest(`store_inventory_conditions?product_id=eq.${encodeURIComponent(productId)}`,{method:'DELETE'});
  if(normalized.length)await rest('store_inventory_conditions?on_conflict=user_id,product_condition_id',{method:'POST',body:normalized,prefer:'resolution=merge-duplicates,return=minimal'});
  if(!quiet){conditionRows=normalized;syncState({detailStatus:'ready',detailProductId:String(productId),conditionRows:normalized});renderDetail()}
  return normalized;
}

async function loadCrossSource(productIds){
  scoutByProduct=new Map();salesByProduct=new Map();
  const ids=[...new Set(productIds.map(String).filter(Boolean))].slice(0,120);if(!ids.length)return;
  const encoded=ids.map(encodeURIComponent).join(',');
  try{
    const s=await rest(`scout_opportunities_v5?select=product_id,promoted_score,promoted_grade,ck_buylist,direct_low,sku_market_price&product_id=in.(${encoded})&order=promoted_score.desc&limit=500`);
    for(const r of s||[]){const k=String(r.product_id||'');if(k&&!scoutByProduct.has(k))scoutByProduct.set(k,r)}
  }catch{}
  try{
    const s=await rest(`seller_product_summary?select=product_id,units_sold,revenue,last_sold_at&product_id=in.(${encoded})&limit=500`);
    for(const r of s||[]){const k=String(r.product_id||'');if(!k)continue;const prev=salesByProduct.get(k)||{units_sold:0,revenue:0,last_sold_at:null};prev.units_sold+=Number(r.units_sold||0);prev.revenue+=Number(r.revenue||0);if(r.last_sold_at&&(!prev.last_sold_at||new Date(r.last_sold_at)>new Date(prev.last_sold_at)))prev.last_sold_at=r.last_sold_at;salesByProduct.set(k,prev)}
  }catch{}
}

async function loadStored(){
  const [products,conditions,stateRows]=await Promise.all([
    rest('store_inventory_products?select=*&quantity=gt.0&order=quantity.desc,product_name.asc&limit=5000'),
    rest('store_inventory_conditions?select=*&quantity=gt.0&order=quantity.desc&limit=5000'),
    rest('store_inventory_sync_state?select=*&limit=1')
  ]);
  rows=products||[];conditionRows=conditions||[];
  syncState({products:rows,conditionRows,status:'ready',syncState:stateRows?.[0]||null});
  await loadCrossSource(rows.map(x=>x.product_id));
  render();
}

function stat(label,value,sub=''){return `<div class="cx-inventory-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`}

function render(){
  const host=document.getElementById('cxInventory');if(!host)return;
  const state=store.get().inventory||{},syncInfo=state.syncState||{};
  const qty=rows.reduce((s,r)=>s+Number(r.quantity||0),0),enrichedProducts=new Set(conditionRows.map(x=>String(x.product_id))).size;
  host.innerHTML=`<div class="cx-page-head"><div><h2>Inventory</h2><p>Authenticated Store inventory with Seller + Scout context.</p><div class="cx-inventory-freshness">Last full sync ${syncInfo.last_completed_at?fmt(syncInfo.last_completed_at):'never'} · ${num(rows.length)} products · ${num(qty)} copies</div></div><div class="cx-inventory-head-actions"><button class="cx-refresh" id="cxInventorySync">${syncing?'Syncing…':'Sync Store'}</button>${syncing?'<button class="cx-secondary" id="cxInventoryStop">Stop</button>':''}</div></div>
    <div class="cx-inventory-kpis">${stat('Products',num(rows.length))}${stat('Copies',num(qty))}${stat('Exact rows',num(conditionRows.length),`${enrichedProducts} products enriched`)}${stat('Store session',hasInventoryBridge()?'Android ready':'Read-only view',hasInventoryBridge()?'sync available':'update app for sync')}</div>
    <div class="cx-inventory-toolbar"><input id="cxInventorySearch" placeholder="Search product or set…"><select id="cxInventoryDetailFilter"><option value="">All products</option><option value="enriched">Exact rows loaded</option><option value="needs">Needs detail</option></select></div>
    <div class="cx-inventory-layout"><section id="cxInventoryList" class="cx-inventory-list"></section><aside id="cxInventoryDetail" class="cx-card cx-inventory-detail"><div class="cx-empty">Select a product for exact condition / foil pricing.</div></aside></div>`;
  host.querySelector('#cxInventorySync').onclick=()=>syncCatalog().catch(showSyncError);
  host.querySelector('#cxInventoryStop')?.addEventListener('click',()=>{stopRequested=true});
  host.querySelector('#cxInventorySearch').oninput=renderList;
  host.querySelector('#cxInventoryDetailFilter').onchange=renderList;
  renderList();if(selectedProductId)renderDetail();
}

function filteredRows(){
  const q=document.getElementById('cxInventorySearch')?.value.trim().toLowerCase()||'',f=document.getElementById('cxInventoryDetailFilter')?.value||'',enriched=new Set(conditionRows.map(x=>String(x.product_id)));
  return rows.filter(r=>(!q||`${r.product_name} ${r.set_name} ${r.product_id}`.toLowerCase().includes(q))&&(!f||(f==='enriched'?enriched.has(String(r.product_id)):!enriched.has(String(r.product_id)))));
}

function renderList(){
  const host=document.getElementById('cxInventoryList');if(!host)return;const list=filteredRows();
  if(!list.length){host.innerHTML='<div class="cx-card cx-empty">No inventory matches these filters.</div>';return}
  host.innerHTML=list.slice(0,500).map(r=>{const s=scoutByProduct.get(String(r.product_id)),sales=salesByProduct.get(String(r.product_id)),exact=conditionRows.filter(x=>String(x.product_id)===String(r.product_id)),myPrice=exact.length?Math.min(...exact.map(x=>Number(x.price)).filter(Number.isFinite)):null;return `<button type="button" class="cx-inventory-row ${String(selectedProductId)===String(r.product_id)?'selected':''}" data-product="${esc(r.product_id)}"><img src="${esc(r.image_200||r.image_75||'')}" alt="" loading="lazy"><div class="cx-inventory-row-main"><strong>${esc(r.product_name||r.product_id)}</strong><small>${esc(r.set_name||'')} · Product ${esc(r.product_id)}</small><div class="cx-inventory-row-metrics"><span>Qty <b>${num(r.quantity)}</b></span><span>My price <b>${money(myPrice)}</b></span><span>Scout <b>${s?`${esc(s.promoted_grade||'—')} ${Number(s.promoted_score||0)}`:'—'}</b></span><span>Sold <b>${sales?num(sales.units_sold):'—'}</b></span></div></div><span class="cx-inventory-detail-state">${exact.length?`${exact.length} exact`:'Detail ›'}</span></button>`}).join('');
  host.querySelectorAll('[data-product]').forEach(b=>b.onclick=()=>selectProduct(b.dataset.product));
}

async function selectProduct(productId){
  selectedProductId=String(productId);renderList();
  let exact=conditionRows.filter(x=>String(x.product_id)===selectedProductId);
  if(!exact.length&&hasInventoryBridge()){
    const detail=document.getElementById('cxInventoryDetail');if(detail)detail.innerHTML='<div class="cx-empty">Loading exact Store rows…</div>';
    try{exact=await enrichProduct(selectedProductId)}catch(e){if(detail)detail.innerHTML=`<div class="cx-empty">${esc(e.message||e)}</div>`;return}
    conditionRows=[...conditionRows.filter(x=>String(x.product_id)!==selectedProductId),...exact];syncState({conditionRows});
  }
  renderDetail();renderList();
}

function renderDetail(){
  const host=document.getElementById('cxInventoryDetail');if(!host||!selectedProductId)return;
  const product=rows.find(x=>String(x.product_id)===selectedProductId),exact=conditionRows.filter(x=>String(x.product_id)===selectedProductId),scout=scoutByProduct.get(selectedProductId),sales=salesByProduct.get(selectedProductId);
  if(!product){host.innerHTML='<div class="cx-empty">Product not found.</div>';return}
  host.innerHTML=`<div class="cx-inventory-detail-head"><img src="${esc(product.image_400||product.image_200||'')}" alt=""><div><div class="cx-section-title">${esc(product.product_name||product.product_id)}</div><span class="cx-sub">${esc(product.set_name||'')} · ${num(product.quantity)} copies</span></div></div>
    <div class="cx-inventory-context">${stat('Scout',scout?`${esc(scout.promoted_grade||'—')} ${Number(scout.promoted_score||0)}`:'—')}${stat('CK BL',money(scout?.ck_buylist))}${stat('Direct',money(scout?.direct_low))}${stat('Seller units',sales?num(sales.units_sold):'—',sales?.last_sold_at?`last ${new Date(sales.last_sold_at).toLocaleDateString()}`:'')}</div>
    <div class="cx-section-title cx-inventory-exact-title">Exact Store rows</div>${exact.length?`<div class="cx-inventory-exact">${exact.map(x=>{const lowShip=(Number(x.lowest_price||0)+Number(x.lowest_shipping||0))||null,lastShip=(Number(x.last_sold_price||0)+Number(x.last_sold_shipping||0))||null,delta=x.market_price&&x.price?((Number(x.price)/Number(x.market_price)-1)*100):null;return `<div class="cx-inventory-condition"><div><strong>${esc(x.condition_name||`Condition ${x.condition_id}`)}</strong><small>Store row ${esc(x.product_condition_id)} · Qty ${num(x.quantity)}${Number(x.pending_quantity||0)?` · ${num(x.pending_quantity)} pending`:''}</small></div><div class="cx-inventory-pricegrid"><span>My price<b>${money(x.price)}</b>${delta!=null?`<small>${delta>=0?'+':''}${delta.toFixed(1)}% vs market</small>`:''}</span><span>Market<b>${money(x.market_price)}</b></span><span>Low + S<b>${money(lowShip)}</b></span><span>Next + S<b>${money((Number(x.next_lowest_price||0)+Number(x.next_lowest_shipping||0))||null)}</b></span><span>Last sale<b>${money(lastShip)}</b></span></div><button class="cx-secondary cx-inventory-edit" disabled title="Price writes will be enabled only after the exact-row write bridge is separately verified.">Edit price</button></div>`}).join('')}</div>`:`<div class="cx-empty">${hasInventoryBridge()?'No in-stock exact rows were returned for this product.':'Exact pricing needs the updated Android authenticated Store bridge.'}</div>`}`;
}

async function syncCatalog(){
  if(syncing)return;if(!hasInventoryBridge())throw new Error('Store inventory sync requires the updated Android app and an authenticated Seller/Store session.');
  const uid=userId();if(!uid)throw new Error('Sign in required');
  syncing=true;stopRequested=false;const startedAt=new Date().toISOString();let pagesFetched=0,productsSeen=0,productsWithStock=0,totalPages=1,all=[];
  syncState({status:'syncing',phase:'catalog',startedAt});render();
  await upsertSyncState({status:'running',phase:'catalog',pages_fetched:0,products_seen:0,products_with_stock:0,conditions_enriched:0,last_started_at:startedAt,last_error:null,detail:{requestedPageSize:REQUESTED_PAGE_SIZE}});
  try{
    for(let page=1;page<=totalPages;page++){
      if(stopRequested)throw new Error('Inventory sync stopped');
      syncState({phase:`catalog ${page}/${totalPages||'?'}`});
      const search=await probe({mode:'fetch_json',method:'POST',url:`${SEARCH_URL}?r=${Date.now()}${page}`,body:catalogBody(page)});
      const body=search.body||{},products=Array.isArray(body.Products)?body.Products:[];
      totalPages=Math.max(1,Number(body.TotalPageCount||1));
      if(!products.length&&page===1)throw new Error('Store returned no Magic inventory products. Check Store authentication.');
      const qtyOut=products.length?await probe({mode:'fetch_json',method:'POST',url:QUANTITY_URL,body:quantityBody(products)}):{body:[]};
      const quantities=Array.isArray(qtyOut.body)?qtyOut.body:[];
      const normalized=products.map((p,i)=>normalizeProduct(p,quantities[i],startedAt));
      all.push(...normalized);productsSeen+=normalized.length;productsWithStock+=normalized.filter(x=>x.quantity>0).length;pagesFetched++;
      if(normalized.length)await rest('store_inventory_products?on_conflict=user_id,product_id',{method:'POST',body:normalized,prefer:'resolution=merge-duplicates,return=minimal'});
      syncState({pagesFetched,productsSeen,productsWithStock,totalPages});
      await upsertSyncState({status:'running',phase:'catalog',pages_fetched:pagesFetched,products_seen:productsSeen,products_with_stock:productsWithStock,detail:{totalPages,pageSize:Number(body.PageSize||products.length||0),requestedPageSize:REQUESTED_PAGE_SIZE}});
      await sleep(80);
    }
    await rest(`store_inventory_products?captured_at=lt.${encodeURIComponent(startedAt)}`,{method:'DELETE'});
    const top=all.filter(x=>x.quantity>0).sort((a,b)=>Number(b.quantity)-Number(a.quantity)).slice(0,AUTO_ENRICH);let enriched=0;
    syncState({phase:'exact rows'});
    for(const p of top){if(stopRequested)break;try{enriched+=(await enrichProduct(p.product_id,{quiet:true})).length}catch{}await sleep(100)}
    const completed=new Date().toISOString();
    await upsertSyncState({status:'complete',phase:'complete',pages_fetched:pagesFetched,products_seen:productsSeen,products_with_stock:productsWithStock,conditions_enriched:enriched,last_completed_at:completed,last_error:null,detail:{totalPages,requestedPageSize:REQUESTED_PAGE_SIZE,autoEnrichedProducts:top.length}});
    syncState({status:'ready',phase:'complete'});await loadStored();
  }catch(error){await upsertSyncState({status:stopRequested?'stopped':'failed',phase:'error',pages_fetched:pagesFetched,products_seen:productsSeen,products_with_stock:productsWithStock,last_error:String(error?.message||error)}).catch(()=>{});throw error}
  finally{syncing=false;stopRequested=false;render()}
}

function showSyncError(error){syncState({status:'error',error:String(error?.message||error)});const host=document.getElementById('cxInventory');if(host){let e=host.querySelector('.cx-inventory-error');if(!e){e=document.createElement('div');e.className='cx-inventory-error';host.prepend(e)}e.textContent=String(error?.message||error)}render()}

registerComponent('store-inventory',{
  onPage(page){if(page==='inventory')loadStored().catch(showSyncError)}
});

window.CollectishInventory={load:loadStored,sync:syncCatalog,enrich:enrichProduct};
