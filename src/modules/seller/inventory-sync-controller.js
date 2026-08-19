import { rest } from '../../core/rest.js';
import { readSession } from '../../core/session.js';
import { registerComponent } from '../../core/lifecycle.js';
import store from '../../state/store.js';

const SEARCH_URL='https://store.tcgplayer.com/admin/product/searchcatalog';
const QUANTITY_URL='https://store.tcgplayer.com/admin/product/updateinstockquantities';
const PAGE_SIZE=250;
const MAX_PAGES=100;
const AUTO_ENRICH=20;
let active=false;
let syncing=false;
let stopped=false;
let host=null;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const userId=()=>readSession()?.user?.id||'';
const bridge=()=>window.CollectishReadOnly;
const patch=p=>store.update('inventory',p);
const timeout=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(`${label} timed out`)),ms))]);

function hasBridge(){const b=bridge();return Boolean(b&&b.startReadOnlyProbe&&b.getReadOnlyProbeState&&b.getReadOnlyProbeResult)}

function setButtons(running){
  const btn=document.getElementById('cxInventorySync');if(btn){btn.textContent=running?'Syncing…':'Sync Store';btn.disabled=running}
  let stop=document.getElementById('cxInventoryStopV2');
  if(running&&!stop&&btn){stop=document.createElement('button');stop.id='cxInventoryStopV2';stop.className='cx-secondary';stop.textContent='Stop';btn.parentElement?.appendChild(stop);stop.onclick=()=>{stopped=true;patch({phase:'stopping'})}}
  if(!running)stop?.remove();
}

async function probe(config,{timeoutMs=45_000}={}){
  if(!hasBridge())throw new Error('Authenticated Store bridge is not available.');
  const b=bridge(),started=Date.now();
  patch({probeState:'starting',probeUrl:config.url,probeMethod:config.method||'GET'});
  b.startReadOnlyProbe(JSON.stringify(config));
  let state='starting';
  while(Date.now()-started<timeoutMs){
    if(stopped)throw new Error('Inventory sync stopped');
    await sleep(300);state=String(b.getReadOnlyProbeState?.()||'unknown');patch({probeState:state});
    if(state==='ready'||state==='error')break;
  }
  let out={};try{out=JSON.parse(String(b.getReadOnlyProbeResult?.()||'{}'))}catch{out={error:'Inventory probe returned invalid JSON'}}
  if(state!=='ready'||out?.error)throw new Error(out?.error||`Store request ${state==='error'?'failed':'timed out'}`);
  patch({probeState:'ready',lastProbeAt:new Date().toISOString()});
  return out;
}

function catalogBody(page){return {SearchOptions:{SearchValue:'',OnlyMyInventory:true,ListingType:'AllListings',SortColumn:'GameName',SortDirection:'ASC',PageIndex:page,ItemsPerPage:String(PAGE_SIZE),CategoryId:'1',SetNameId:'0',Rarity:'0',IsSealed:''}}}
function quantityBody(products){return {productIds:products.map(x=>Number(x.ProductId)),cachedProductQuantities:products.map(x=>Number(x.Quantity||0)),onlyMyInventory:true,onlyListos:false}}
function normalizeProduct(product,quantity,capturedAt){return {user_id:userId(),product_id:String(product.ProductId),product_line:product.ProductLine||null,product_name:product.ProductName||null,set_name:product.SetName||null,rarity:product.Rarity||null,card_number:product.Number||null,image_75:product.Image75||null,image_200:product.Image200||null,image_400:product.Image400||null,quantity:Number(quantity?.Quantity??product.Quantity??0)||0,has_photos:Boolean(quantity?.HasPhotos??product.HasPhotos),is_presale:Boolean(product.IsPresale),captured_at:capturedAt,raw_json:{catalog:product,quantity:quantity||null}}}

async function checkpoint(data){
  const uid=userId();if(!uid)return false;
  try{
    await timeout(rest('store_inventory_sync_state?on_conflict=user_id',{method:'POST',body:[{user_id:uid,updated_at:new Date().toISOString(),...data}],prefer:'resolution=merge-duplicates,return=minimal'}),5000,'Progress checkpoint');
    patch({checkpointState:'saved',checkpointAt:new Date().toISOString(),checkpointError:null});return true;
  }catch(error){patch({checkpointState:'delayed',checkpointError:String(error?.message||error)});return false}
}

function pageSignature(products){return products.slice(0,8).map(x=>String(x.ProductId||'')).join(',')}

async function runSync(){
  if(syncing)return;if(!hasBridge())throw new Error('Store inventory sync requires the current Android authenticated Store bridge.');if(!userId())throw new Error('Sign in required');
  syncing=true;stopped=false;setButtons(true);
  const startedAt=new Date().toISOString();let pagesFetched=0,productsSeen=0,productsWithStock=0,reportedTotalPages=0;const all=[];const signatures=new Set();let fullScanConfirmed=false;
  patch({status:'syncing',phase:'starting',startedAt,pagesFetched,productsSeen,productsWithStock,totalPages:0,checkpointState:'saving',error:null});
  try{
    await checkpoint({status:'running',phase:'starting',pages_fetched:0,products_seen:0,products_with_stock:0,conditions_enriched:0,last_started_at:startedAt,last_error:null,detail:{requestedPageSize:PAGE_SIZE}});

    for(let page=1;page<=MAX_PAGES;page++){
      if(stopped)throw new Error('Inventory sync stopped');
      patch({phase:'catalog request',currentPage:page,totalPages:reportedTotalPages,pagesFetched,productsSeen,productsWithStock});
      const search=await probe({mode:'fetch_json',method:'POST',url:`${SEARCH_URL}?r=${Date.now()}-${page}`,body:catalogBody(page)});
      const body=search.body||{},products=Array.isArray(body.Products)?body.Products:[];
      const reported=Math.max(0,Number(body.TotalPageCount||0));if(reported)reportedTotalPages=Math.max(reportedTotalPages,reported);
      patch({totalPages:reportedTotalPages});

      if(!products.length){
        if(page===1)throw new Error('Store returned no Magic inventory products. Check Store authentication.');
        fullScanConfirmed=true;break;
      }

      const sig=pageSignature(products);
      if(sig&&signatures.has(sig))throw new Error(`Store repeated catalog page ${page}; keeping prior inventory instead of treating this as a full sync.`);
      if(sig)signatures.add(sig);

      patch({phase:'quantity request',currentPage:page,totalPages:reportedTotalPages});
      const qtyOut=await probe({mode:'fetch_json',method:'POST',url:QUANTITY_URL,body:quantityBody(products)});
      const quantities=Array.isArray(qtyOut.body)?qtyOut.body:[];
      const normalized=products.map((p,i)=>normalizeProduct(p,quantities[i],startedAt));
      all.push(...normalized);productsSeen+=normalized.length;productsWithStock+=normalized.filter(x=>x.quantity>0).length;

      patch({phase:'saving page',currentPage:page,totalPages:reportedTotalPages,productsSeen,productsWithStock});
      if(normalized.length)await timeout(rest('store_inventory_products?on_conflict=user_id,product_id',{method:'POST',body:normalized,prefer:'resolution=merge-duplicates,return=minimal'}),15000,'Inventory page save');
      pagesFetched++;
      patch({phase:'catalog',pagesFetched,currentPage:page,totalPages:reportedTotalPages,productsSeen,productsWithStock});
      await checkpoint({status:'running',phase:'catalog',pages_fetched:pagesFetched,products_seen:productsSeen,products_with_stock:productsWithStock,detail:{reportedTotalPages,pageSize:Number(body.PageSize||products.length||0),requestedPageSize:PAGE_SIZE,paginationMode:'until-short-page'}});

      // Do not trust TotalPageCount as the stop condition. TCGplayer has returned
      // TotalPageCount=1 while still returning a full 250-row page. A short page is
      // the reliable terminal signal; if every page is full, the next empty page is.
      if(products.length<PAGE_SIZE){fullScanConfirmed=true;break;}
    }

    if(!fullScanConfirmed)throw new Error(`Inventory scan hit the ${MAX_PAGES}-page safety limit before a terminal page; prior inventory was preserved.`);

    patch({phase:'cleaning old rows'});
    await timeout(rest(`store_inventory_products?captured_at=lt.${encodeURIComponent(startedAt)}`,{method:'DELETE'}),15000,'Inventory cleanup');
    const top=all.filter(x=>x.quantity>0).sort((a,b)=>Number(b.quantity)-Number(a.quantity)).slice(0,AUTO_ENRICH);let enriched=0,enrichedProducts=0;
    for(const p of top){
      if(stopped)break;enrichedProducts++;patch({phase:'exact rows',enrichedProducts,enrichTotal:top.length});
      try{enriched+=(await timeout(window.CollectishInventory.enrich(p.product_id,{quiet:true}),45000,'Exact row enrichment')).length}catch{}
      patch({conditionsEnriched:enriched});await sleep(80);
    }
    const completed=new Date().toISOString();
    await checkpoint({status:stopped?'stopped':'complete',phase:stopped?'stopped':'complete',pages_fetched:pagesFetched,products_seen:productsSeen,products_with_stock:productsWithStock,conditions_enriched:enriched,last_completed_at:stopped?null:completed,last_error:null,detail:{reportedTotalPages,requestedPageSize:PAGE_SIZE,autoEnrichedProducts:top.length,fullScanConfirmed:true}});
    patch({status:stopped?'stopped':'ready',phase:stopped?'stopped':'complete',completedAt:completed});
    await window.CollectishInventory.load();
  }catch(error){
    const message=String(error?.message||error),status=stopped?'stopped':'failed';
    patch({status:'error',phase:status,error:message});
    await checkpoint({status,phase:status,pages_fetched:pagesFetched,products_seen:productsSeen,products_with_stock:productsWithStock,last_error:message,detail:{reportedTotalPages,requestedPageSize:PAGE_SIZE,fullScanConfirmed:false}});
    throw error;
  }finally{syncing=false;stopped=false;setButtons(false)}
}

function clickCapture(event){
  const sync=event.target.closest?.('#cxInventorySync');if(!sync)return;
  event.preventDefault();event.stopImmediatePropagation();
  runSync().catch(error=>{patch({status:'error',error:String(error?.message||error)});setButtons(false)});
}

function start(){if(active)return;host=document.getElementById('cxInventory');if(!host)return;active=true;host.addEventListener('click',clickCapture,true)}
function stop(){if(!active)return;host?.removeEventListener('click',clickCapture,true);host=null;active=false}
registerComponent('inventory-sync-controller',{onPage(page){if(page==='inventory')start();else stop();}});
window.CollectishInventorySync={run:runSync,getState:()=>({syncing,stopped})};
