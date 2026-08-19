import { rest } from '../../core/rest.js';
import { readSession } from '../../core/session.js';
import { registerComponent } from '../../core/lifecycle.js';
import store from '../../state/store.js';

const SEARCH_URL='https://store.tcgplayer.com/admin/product/searchcatalog';
const QUANTITY_URL='https://store.tcgplayer.com/admin/product/updateinstockquantities';
const PAGE_SIZE=250;
const MAX_PAGES=100;
const TERMINAL_CONFIRMATIONS=3;
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
function expectedProductCount(body){
  for(const key of ['TotalItemCount','TotalCount','TotalProductCount','RecordCount','TotalRecords','TotalResults']){
    const n=Number(body?.[key]);if(Number.isFinite(n)&&n>0)return n;
  }
  return 0;
}

async function runSync(){
  if(syncing)return;if(!hasBridge())throw new Error('Store inventory sync requires the current Android authenticated Store bridge.');if(!userId())throw new Error('Sign in required');
  syncing=true;stopped=false;setButtons(true);
  const startedAt=new Date().toISOString();let pagesFetched=0,productsSeen=0,productsWithStock=0,reportedTotalPages=0,expectedProducts=0,terminalStreak=0;const all=[];const signatures=new Set();let fullScanConfirmed=false,sawRepeatedPage=false;
  patch({status:'syncing',phase:'starting',startedAt,pagesFetched,productsSeen,productsWithStock,totalPages:0,checkpointState:'saving',error:null});
  try{
    await checkpoint({status:'running',phase:'starting',pages_fetched:0,products_seen:0,products_with_stock:0,conditions_enriched:0,last_started_at:startedAt,last_error:null,detail:{requestedPageSize:PAGE_SIZE,paginationMode:'confirmed-terminal'}});

    for(let page=1;page<=MAX_PAGES;page++){
      if(stopped)throw new Error('Inventory sync stopped');
      patch({phase:'catalog request',currentPage:page,totalPages:reportedTotalPages,pagesFetched,productsSeen,productsWithStock});
      const search=await probe({mode:'fetch_json',method:'POST',url:`${SEARCH_URL}?r=${Date.now()}-${page}`,body:catalogBody(page)});
      const body=search.body||{},products=Array.isArray(body.Products)?body.Products:[];
      const reported=Math.max(0,Number(body.TotalPageCount||0));if(reported)reportedTotalPages=Math.max(reportedTotalPages,reported);
      const expected=expectedProductCount(body);if(expected)expectedProducts=Math.max(expectedProducts,expected);
      patch({totalPages:reportedTotalPages,expectedProducts});

      if(!products.length){
        if(page===1)throw new Error('Store returned no Magic inventory products. Check Store authentication.');
        terminalStreak++;
        await checkpoint({status:'running',phase:'catalog-terminal-check',pages_fetched:pagesFetched,products_seen:productsSeen,products_with_stock:productsWithStock,detail:{reportedTotalPages,expectedProducts,requestedPageSize:PAGE_SIZE,page,returnedRows:0,terminalStreak,paginationMode:'confirmed-terminal'}});
        const reachedReported=reportedTotalPages===0||page>=reportedTotalPages;
        const reachedExpected=expectedProducts===0||productsSeen>=expectedProducts;
        if(terminalStreak>=TERMINAL_CONFIRMATIONS&&reachedReported&&reachedExpected&&!sawRepeatedPage){fullScanConfirmed=true;break;}
        continue;
      }

      const sig=pageSignature(products);
      if(sig&&signatures.has(sig)){
        sawRepeatedPage=true;terminalStreak++;
        await checkpoint({status:'running',phase:'catalog-repeat-check',pages_fetched:pagesFetched,products_seen:productsSeen,products_with_stock:productsWithStock,detail:{reportedTotalPages,expectedProducts,requestedPageSize:PAGE_SIZE,page,returnedRows:products.length,terminalStreak,repeatedPage:true,paginationMode:'confirmed-terminal'}});
        continue;
      }
      if(sig)signatures.add(sig);
      terminalStreak=products.length<PAGE_SIZE?terminalStreak+1:0;

      patch({phase:'quantity request',currentPage:page,totalPages:reportedTotalPages});
      const qtyOut=await probe({mode:'fetch_json',method:'POST',url:QUANTITY_URL,body:quantityBody(products)});
      const quantities=Array.isArray(qtyOut.body)?qtyOut.body:[];
      const normalized=products.map((p,i)=>normalizeProduct(p,quantities[i],startedAt));
      all.push(...normalized);productsSeen+=normalized.length;productsWithStock+=normalized.filter(x=>x.quantity>0).length;

      patch({phase:'saving page',currentPage:page,totalPages:reportedTotalPages,productsSeen,productsWithStock});
      if(normalized.length)await timeout(rest('store_inventory_products?on_conflict=user_id,product_id',{method:'POST',body:normalized,prefer:'resolution=merge-duplicates,return=minimal'}),15000,'Inventory page save');
      pagesFetched++;
      patch({phase:'catalog',pagesFetched,currentPage:page,totalPages:reportedTotalPages,productsSeen,productsWithStock});
      await checkpoint({status:'running',phase:'catalog',pages_fetched:pagesFetched,products_seen:productsSeen,products_with_stock:productsWithStock,detail:{reportedTotalPages,expectedProducts,pageSize:Number(body.PageSize||products.length||0),returnedRows:products.length,page,terminalStreak,requestedPageSize:PAGE_SIZE,paginationMode:'confirmed-terminal'}});

      // A single short page is not enough to declare completion. TCGplayer has
      // intermittently returned early short/empty pages. Require three terminal
      // confirmations, and never stop before an explicit total count/page floor.
      const reachedReported=reportedTotalPages===0||page>=reportedTotalPages;
      const reachedExpected=expectedProducts===0||productsSeen>=expectedProducts;
      if(terminalStreak>=TERMINAL_CONFIRMATIONS&&reachedReported&&reachedExpected&&!sawRepeatedPage){fullScanConfirmed=true;break;}
    }

    if(!fullScanConfirmed){
      const why=sawRepeatedPage?'repeated catalog pages were observed':'no reliable terminal page sequence was confirmed';
      throw new Error(`Inventory scan incomplete: ${why}. ${productsSeen} products were staged; prior inventory was preserved.`);
    }

    patch({phase:'cleaning old rows'});
    await timeout(rest(`store_inventory_products?captured_at=lt.${encodeURIComponent(startedAt)}`,{method:'DELETE'}),15000,'Inventory cleanup');
    const top=all.filter(x=>x.quantity>0).sort((a,b)=>Number(b.quantity)-Number(a.quantity)).slice(0,AUTO_ENRICH);let enriched=0,enrichedProducts=0;
    for(const p of top){
      if(stopped)break;enrichedProducts++;patch({phase:'exact rows',enrichedProducts,enrichTotal:top.length});
      try{enriched+=(await timeout(window.CollectishInventory.enrich(p.product_id,{quiet:true}),45000,'Exact row enrichment')).length}catch{}
      patch({conditionsEnriched:enriched});await sleep(80);
    }
    const completed=new Date().toISOString();
    await checkpoint({status:stopped?'stopped':'complete',phase:stopped?'stopped':'complete',pages_fetched:pagesFetched,products_seen:productsSeen,products_with_stock:productsWithStock,conditions_enriched:enriched,last_completed_at:stopped?null:completed,last_error:null,detail:{reportedTotalPages,expectedProducts,requestedPageSize:PAGE_SIZE,autoEnrichedProducts:top.length,fullScanConfirmed:true,paginationMode:'confirmed-terminal'}});
    patch({status:stopped?'stopped':'ready',phase:stopped?'stopped':'complete',completedAt:completed});
    await window.CollectishInventory.load();
  }catch(error){
    const message=String(error?.message||error),status=stopped?'stopped':'failed';
    patch({status:'error',phase:status,error:message});
    await checkpoint({status,phase:status,pages_fetched:pagesFetched,products_seen:productsSeen,products_with_stock:productsWithStock,last_error:message,detail:{reportedTotalPages,expectedProducts,requestedPageSize:PAGE_SIZE,fullScanConfirmed:false,paginationMode:'confirmed-terminal'}});
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
