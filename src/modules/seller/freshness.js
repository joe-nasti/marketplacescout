import store from '../../state/store.js';
import { rest } from '../../core/rest.js';
import { readSession } from '../../core/session.js';

const KNOWN_KEY='collectishSellerKnownOrder';
const AUTO_UI_CHECK_MS=24*60*60*1000;
const MANUAL_WATCH_MS=5_000;
const MANUAL_WATCH_LIMIT=84; // Up to ~7 minutes while Collectish advances Seller history.
const SELLER_INTERACTIVE_PRIORITY=1; // Lower numbers claim first; historical detail backfill is priority 5.
let timer=null;
let polling=false;
let manualWatch=null;

const fmt=t=>t?new Date(t).toLocaleString():'—';
const age=t=>{
  if(!t)return 'never';
  const ms=Math.max(0,Date.now()-new Date(t).getTime());
  if(ms<60_000)return 'just now';
  if(ms<3_600_000)return `${Math.max(1,Math.round(ms/60_000))}m ago`;
  if(ms<86_400_000)return `${Math.round(ms/3_600_000)}h ago`;
  return `${Math.round(ms/86_400_000)}d ago`;
};
const enc=v=>encodeURIComponent(String(v??''));
const startUtcDay=value=>{const d=new Date(value);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())).toISOString()};
const tomorrowUtc=()=>{const d=new Date();return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+1)).toISOString()};
const num=v=>Number.isFinite(Number(v))?Number(v):null;

function navButtons(){return [...document.querySelectorAll('[data-cx-page="seller"]')]}
function sellerActive(){return document.getElementById('cxSeller')?.classList.contains('active')}
function knownOrder(){return localStorage.getItem(KNOWN_KEY)||''}
function setKnown(order){if(order)localStorage.setItem(KNOWN_KEY,String(order))}

function applyNavBadge(hasNew){
  navButtons().forEach(b=>{
    b.classList.toggle('cx-has-new-order',Boolean(hasNew));
    b.setAttribute('aria-label',hasNew?'Seller — new order available':'Seller');
  });
}

function bindRefresh(){
  const button=document.getElementById('cxSellerParityRefresh');
  if(!button||button.dataset.cxSellerManual==='1')return;
  button.dataset.cxSellerManual='1';
  button.onclick=()=>requestSellerSync().catch(error=>{
    store.update('seller',{manualSyncStatus:'error',manualSyncError:String(error?.message||error)});
    renderFreshness();
  });
}

function ensureProgress(head){
  let box=head.querySelector('.cx-seller-sync-progress');
  if(box)return box;
  box=document.createElement('div');
  box.className='cx-seller-sync-progress';
  box.hidden=true;
  box.innerHTML='<div class="cx-seller-sync-progress-row"><span class="cx-seller-sync-progress-label">Seller history</span><span class="cx-seller-sync-progress-pct">0%</span></div><div class="cx-seller-sync-progress-track"><div class="cx-seller-sync-progress-fill"></div></div><div class="cx-seller-sync-progress-detail"></div>';
  head.append(box);
  return box;
}

function renderProgress({visible=false,percent=0,detail=''}={}){
  const head=document.querySelector('#cxSeller .cx-page-head>div');
  if(!head)return;
  const box=ensureProgress(head);
  box.hidden=!visible;
  if(!visible)return;
  const pct=Math.max(0,Math.min(100,Math.round(Number(percent)||0)));
  const fill=box.querySelector('.cx-seller-sync-progress-fill');
  const pctEl=box.querySelector('.cx-seller-sync-progress-pct');
  const detailEl=box.querySelector('.cx-seller-sync-progress-detail');
  if(fill)fill.style.width=`${pct}%`;
  if(pctEl)pctEl.textContent=`${pct}%`;
  if(detailEl)detailEl.textContent=detail||'Working…';
}

function renderFreshness(){
  const s=store.get().seller||{};
  const head=document.querySelector('#cxSeller .cx-page-head>div');
  if(!head)return;
  let line=head.querySelector('.cx-seller-freshness');
  if(!line){line=document.createElement('div');line.className='cx-seller-freshness';head.append(line)}
  const synced=s.lastSyncedAt;
  const stale=synced?Date.now()-new Date(synced).getTime()>26*60*60_000:true;
  line.classList.toggle('stale',stale);
  line.classList.toggle('new-order',Boolean(s.hasNewOrder));
  const status=s.manualSyncStatus;
  const suffix=status==='queued'||status==='running'?' · priority refresh':status==='waiting'?' · priority refresh waiting':status==='error'?' · sync failed':s.hasNewOrder?' · NEW ORDER':'';
  line.textContent=`Seller data synced ${age(synced)}${synced?` · ${fmt(synced)}`:''}${suffix}`;
  const button=document.getElementById('cxSellerParityRefresh');
  if(button){
    const busy=status==='queued'||status==='running';
    button.textContent=busy?'Refreshing…':'Refresh';
    button.disabled=busy;
  }
  if(['queued','running','waiting'].includes(status)){
    renderProgress({visible:true,percent:s.manualSyncPercent??5,detail:s.manualSyncDetail||'Priority refresh queued · background history continues'});
  }else if(status==='done'){
    renderProgress({visible:true,percent:100,detail:s.manualSyncDetail||'Seller refresh complete'});
  }else if(status==='error'){
    renderProgress({visible:true,percent:s.manualSyncPercent??0,detail:s.manualSyncError||'Seller refresh failed'});
  }else renderProgress({visible:false});
  bindRefresh();
}

function clearNewOrder(){
  const s=store.get().seller||{};
  if(s.latestOrderNumber)setKnown(s.latestOrderNumber);
  store.update('seller',{hasNewOrder:false});
  applyNavBadge(false);
  renderFreshness();
}

async function latestSnapshot(){
  const rows=await rest('seller_orders?select=order_number,order_date,collected_at&order=order_date.desc.nullslast&limit=1');
  return rows?.[0]||null;
}

export async function checkSellerFreshness({forceReload=false}={}){
  if(polling)return;
  polling=true;
  try{
    const row=await latestSnapshot();
    if(!row)return;
    const incoming=String(row.order_number||'');
    const baseline=knownOrder();
    let hasNew=Boolean(store.get().seller?.hasNewOrder);
    if(!baseline&&incoming)setKnown(incoming);
    else if(incoming&&baseline&&incoming!==baseline)hasNew=true;
    store.update('seller',{
      latestOrderNumber:incoming||null,
      latestOrderDate:row.order_date||null,
      lastSyncedAt:row.collected_at||null,
      lastCheckedAt:new Date().toISOString(),
      hasNewOrder:hasNew
    });
    if(hasNew&&sellerActive()){
      await window.CollectishSeller?.load?.();
      setKnown(incoming);
      hasNew=false;
      store.update('seller',{hasNewOrder:false});
    }else if(forceReload&&sellerActive()){
      await window.CollectishSeller?.load?.();
    }
    applyNavBadge(hasNew);
    renderFreshness();
  }catch(error){
    store.update('seller',{freshnessError:String(error?.message||error),lastCheckedAt:new Date().toISOString()});
  }finally{polling=false}
}

async function sellerJobs(userId){
  return await rest(`collector_jobs?select=job_id,status,payload_json,progress_json,created_at,claimed_at,completed_at,error_message&user_id=eq.${enc(userId)}&source=eq.agent&action=eq.seller_portal_readonly_probe&order=created_at.desc&limit=100`);
}

function sellerKeyFromJobs(jobs){
  for(const job of jobs||[]){
    if(job.status!=='completed'||job.payload_json?.sellerHistoryKind!=='auth_detail')continue;
    const probe=job.progress_json?.readOnlyProbe;
    const body=probe?.body||probe;
    const key=body?.seller?.sellerKey;
    if(key)return String(key);
  }
  return '';
}

function orderSearchBody(job){
  const probe=job?.progress_json?.readOnlyProbe;
  const body=probe?.body||probe;
  return body&&typeof body==='object'?body:null;
}

function normalizeOrder(userId,o,collectedAt){
  const orderNumber=String(o?.orderNumber||'').trim();
  if(!orderNumber)return null;
  return {
    user_id:userId,
    order_number:orderNumber,
    order_date:o.orderDate||null,
    created_at_source:o.createdAt||null,
    order_status:o.orderStatus||null,
    order_channel:o.orderChannel||null,
    order_fulfillment:o.orderFulfillment||null,
    buyer_name:o.buyerName||null,
    payment_type:o.paymentType||null,
    shipping_type:o.shippingType||null,
    estimated_delivery_date:o.estimatedDeliveryDate||null,
    product_amount:num(o.productAmount),
    shipping_amount:num(o.shippingAmount),
    gross_amount:num(o.grossAmount??o.totalAmount),
    fee_amount:num(o.feeAmount),
    direct_fee_amount:num(o.directFeeAmount),
    net_amount:num(o.netAmount),
    tax_amount:num(o.taxAmount),
    refund_total:num(o.refundTotal),
    refund_status:o.refundStatus||null,
    review_rating:num(o.reviewRating),
    review_text:o.reviewText||null,
    review_created_at:o.reviewCreatedAt||null,
    destination_state:o.destinationState||null,
    destination_country:o.destinationCountry||null,
    tracking_status:o.trackingStatus||null,
    source_updated_at:jobTime(o)||null,
    collected_at:collectedAt,
    raw_json:o
  };
}
function jobTime(o){return o?.updatedAt||o?.sourceUpdatedAt||o?.orderDate||null}

async function importCompletedOrderSearch(userId,job){
  if(!job||job.status!=='completed'||job.payload_json?.sellerHistoryKind!=='order_search')return {imported:0};
  const body=orderSearchBody(job);
  const orders=Array.isArray(body?.orders)?body.orders:[];
  if(!orders.length)return {imported:0};
  const collectedAt=job.completed_at||job.progress_json?.updatedAt||new Date().toISOString();
  const rows=orders.map(o=>normalizeOrder(userId,o,collectedAt)).filter(Boolean);
  if(!rows.length)return {imported:0};
  store.update('seller',{manualSyncStatus:'running',manualSyncPercent:82,manualSyncDetail:`Saving ${rows.length.toLocaleString()} orders…`});
  renderFreshness();
  for(let i=0;i<rows.length;i+=200){
    const batch=rows.slice(i,i+200);
    await rest('seller_orders?on_conflict=user_id,order_number',{method:'POST',body:batch,prefer:'resolution=merge-duplicates,return=minimal'});
    const pct=82+Math.round(15*Math.min(1,(i+batch.length)/rows.length));
    store.update('seller',{manualSyncPercent:pct,manualSyncDetail:`Saved ${Math.min(i+batch.length,rows.length).toLocaleString()} of ${rows.length.toLocaleString()} orders`});
    renderFreshness();
  }
  return {imported:rows.length,totalOrders:Number(body?.totalOrders)||rows.length};
}

async function queueManualJob(userId,jobs){
  // Only another user-triggered refresh may coalesce this request. Background
  // auth/search work must not absorb an explicit UI action.
  const active=(jobs||[]).find(j=>['queued','claimed','running'].includes(j.status)&&j.payload_json?.manualSellerRefresh===true&&['auth_detail','order_search'].includes(j.payload_json?.sellerHistoryKind));
  if(active)return {kind:active.payload_json?.sellerHistoryKind||'sync',alreadyActive:true,job:active};
  const sellerKey=sellerKeyFromJobs(jobs);
  const now=new Date().toISOString();
  if(sellerKey){
    const latest=await latestSnapshot();
    const baseline=latest?.order_date?new Date(latest.order_date):new Date(Date.now()-30*86400000);
    const from=startUtcDay(new Date(baseline.getTime()-7*86400000));
    const to=tomorrowUtc();
    const body={searchRange:'Custom',filters:{sellerKey,orderDate:{from,to}},sortBy:[{sortingType:'orderDate',direction:'descending'}],from:0,size:1000};
    await rest('collector_jobs',{method:'POST',body:[{
      user_id:userId,source:'agent',action:'seller_portal_readonly_probe',status:'queued',priority:SELLER_INTERACTIVE_PRIORITY,
      required_capability:'tcgplayer_authenticated_session',preferred_executor:'android_agent',
      payload_json:{sellerHistoryKind:'order_search',windowFrom:from,windowTo:to,pageFrom:0,pageSize:1000,manualSellerRefresh:true,requestClass:'interactive',requestedFrom:'seller_ui',probe:{mode:'fetch_json',method:'POST',url:'https://order-management-api.tcgplayer.com/orders/search?api-version=2.0',body}},
      progress_json:{stage:'queued',percent:0,detail:'Priority Seller refresh queued · background history continues',updatedAt:now},max_attempts:3
    }],prefer:'return=minimal'});
    return {kind:'order_search',alreadyActive:false};
  }
  await rest('collector_jobs',{method:'POST',body:[{
    user_id:userId,source:'agent',action:'seller_portal_readonly_probe',status:'queued',priority:SELLER_INTERACTIVE_PRIORITY,
    required_capability:'tcgplayer_authenticated_session',preferred_executor:'android_agent',
    payload_json:{sellerHistoryKind:'auth_detail',manualSellerRefresh:true,requestClass:'interactive',requestedFrom:'seller_ui',probe:{mode:'fetch_json',method:'GET',url:'https://sp-api.tcgplayer.com/Account/auth-detail'}},
    progress_json:{stage:'queued',percent:0,detail:'Priority Seller auth check queued · background history continues',updatedAt:now},max_attempts:3
  }],prefer:'return=minimal'});
  return {kind:'auth_detail',alreadyActive:false};
}

function jobProgress(job){
  if(!job)return {percent:5,detail:'Priority refresh queued · background history continues'};
  if(job.status==='queued')return {percent:10,detail:'Priority refresh queued · next Android Seller slot'};
  if(job.status==='claimed'||job.status==='running')return {percent:45,detail:'Checking Seller Portal for new orders now…'};
  if(job.status==='failed')return {percent:Number(job.progress_json?.percent)||45,detail:job.error_message||job.progress_json?.detail||'Seller refresh failed'};
  if(job.status==='completed')return {percent:78,detail:'New-order check received · updating Seller history…'};
  return {percent:Number(job.progress_json?.percent)||20,detail:job.progress_json?.detail||'Seller refresh working…'};
}

function watchManualResult(before,userId){
  clearInterval(manualWatch);
  let checks=0;
  let importedJobId='';
  const check=async()=>{
    if(document.hidden)return;
    checks++;
    try{
      const jobs=await sellerJobs(userId);
      const relevant=(jobs||[]).find(j=>j.payload_json?.manualSellerRefresh&&['auth_detail','order_search'].includes(j.payload_json?.sellerHistoryKind));
      if(relevant){
        const p=jobProgress(relevant);
        store.update('seller',{manualSyncStatus:relevant.status==='failed'?'error':'running',manualSyncPercent:p.percent,manualSyncDetail:p.detail,manualSyncError:relevant.status==='failed'?p.detail:null});
        renderFreshness();
        if(relevant.status==='completed'&&relevant.payload_json?.sellerHistoryKind==='auth_detail'){
          await queueManualJob(userId,jobs);
          window.CollectishSellerAgent?.run?.().catch?.(()=>{});
        }else if(relevant.status==='completed'&&relevant.payload_json?.sellerHistoryKind==='order_search'&&relevant.job_id!==importedJobId){
          importedJobId=relevant.job_id;
          const result=await importCompletedOrderSearch(userId,relevant);
          const row=await latestSnapshot();
          const changed=row?.collected_at&&row.collected_at!==before;
          store.update('seller',{manualSyncStatus:'done',manualSyncPercent:100,manualSyncDetail:`Priority refresh complete · ${result.imported.toLocaleString()} orders checked`});
          renderFreshness();
          clearInterval(manualWatch);manualWatch=null;
          await checkSellerFreshness({forceReload:true});
          if(changed)return;
          return;
        }else if(relevant.status==='failed'){
          clearInterval(manualWatch);manualWatch=null;
          return;
        }
      }
    }catch(error){
      store.update('seller',{manualSyncError:String(error?.message||error)});
    }
    if(checks>=MANUAL_WATCH_LIMIT){
      clearInterval(manualWatch);manualWatch=null;
      store.update('seller',{manualSyncStatus:'waiting',manualSyncPercent:20,manualSyncDetail:'Priority refresh still waiting; background history continues'});
      renderFreshness();
    }
  };
  manualWatch=setInterval(check,MANUAL_WATCH_MS);
  setTimeout(check,500);
}

export async function requestSellerSync(){
  const session=readSession();
  const userId=session?.user?.id;
  if(!userId)throw new Error('Sign in required');
  const before=(await latestSnapshot())?.collected_at||null;
  store.update('seller',{manualSyncStatus:'queued',manualSyncError:null,manualSyncPercent:5,manualSyncDetail:'Preparing priority Seller refresh…'});
  renderFreshness();
  const jobs=await sellerJobs(userId);
  const queued=await queueManualJob(userId,jobs);
  store.update('seller',{manualSyncStatus:'running',manualSyncKind:queued.kind,manualSyncRequestedAt:new Date().toISOString(),manualSyncPercent:10,manualSyncDetail:queued.alreadyActive?'Priority refresh already active':'Priority refresh queued · background history continues'});
  renderFreshness();
  window.CollectishSellerAgent?.run?.().catch?.(()=>{});
  watchManualResult(before,userId);
  return queued;
}

function kick(){if(!document.hidden)checkSellerFreshness().catch(()=>{})}
function install(){
  clearInterval(timer);
  timer=setInterval(kick,AUTO_UI_CHECK_MS);
  setTimeout(kick,1500);
  document.addEventListener('collectish:seller-rendered',()=>{renderFreshness();bindRefresh()});
  document.addEventListener('collectish:page-change',e=>{
    if(e.detail?.page==='seller'){
      clearNewOrder();
      checkSellerFreshness({forceReload:true}).catch(()=>{});
    }
  });
  window.addEventListener('collectishAgentSessionChanged',()=>setTimeout(kick,500));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)kick()});
  window.addEventListener('pageshow',kick);
}

install();
window.CollectishSellerFreshness={check:checkSellerFreshness,clear:clearNewOrder,manualSync:requestSellerSync};
