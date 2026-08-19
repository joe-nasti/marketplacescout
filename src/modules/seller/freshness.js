import store from '../../state/store.js';
import { rest } from '../../core/rest.js';
import { readSession } from '../../core/session.js';

const KNOWN_KEY='collectishSellerKnownOrder';
const AUTO_UI_CHECK_MS=24*60*60*1000;
const MANUAL_WATCH_MS=15_000;
const MANUAL_WATCH_LIMIT=28; // up to ~7 minutes while the orchestrator advances the completed probe.
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
  const suffix=status==='queued'||status==='running'?' · syncing now':status==='waiting'?' · sync queued':status==='error'?' · sync failed':s.hasNewOrder?' · NEW ORDER':'';
  line.textContent=`Seller data synced ${age(synced)}${synced?` · ${fmt(synced)}`:''}${suffix}`;
  const button=document.getElementById('cxSellerParityRefresh');
  if(button){
    const busy=status==='queued'||status==='running';
    button.textContent=busy?'Syncing…':'Refresh';
    button.disabled=busy;
  }
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
  return await rest(`collector_jobs?select=job_id,status,payload_json,progress_json,created_at,completed_at&user_id=eq.${enc(userId)}&source=eq.agent&action=eq.seller_portal_readonly_probe&order=created_at.desc&limit=100`);
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

async function queueManualJob(userId,jobs){
  const active=(jobs||[]).find(j=>['queued','claimed','running'].includes(j.status)&&['auth_detail','order_search'].includes(j.payload_json?.sellerHistoryKind));
  if(active)return {kind:active.payload_json?.sellerHistoryKind||'sync',alreadyActive:true};
  const sellerKey=sellerKeyFromJobs(jobs);
  const now=new Date().toISOString();
  if(sellerKey){
    const latest=await latestSnapshot();
    const baseline=latest?.order_date?new Date(latest.order_date):new Date(Date.now()-30*86400000);
    const from=startUtcDay(new Date(baseline.getTime()-7*86400000));
    const to=tomorrowUtc();
    const body={searchRange:'Custom',filters:{sellerKey,orderDate:{from,to}},sortBy:[{sortingType:'orderDate',direction:'descending'}],from:0,size:1000};
    await rest('collector_jobs',{method:'POST',body:[{
      user_id:userId,source:'agent',action:'seller_portal_readonly_probe',status:'queued',priority:9,
      required_capability:'tcgplayer_authenticated_session',preferred_executor:'android_agent',
      payload_json:{sellerHistoryKind:'order_search',windowFrom:from,windowTo:to,pageFrom:0,pageSize:1000,manualSellerRefresh:true,probe:{mode:'fetch_json',method:'POST',url:'https://order-management-api.tcgplayer.com/orders/search?api-version=2.0',body}},
      progress_json:{stage:'queued',percent:0,detail:'Manual Seller refresh queued',updatedAt:now},max_attempts:3
    }],prefer:'return=minimal'});
    return {kind:'order_search',alreadyActive:false};
  }
  await rest('collector_jobs',{method:'POST',body:[{
    user_id:userId,source:'agent',action:'seller_portal_readonly_probe',status:'queued',priority:9,
    required_capability:'tcgplayer_authenticated_session',preferred_executor:'android_agent',
    payload_json:{sellerHistoryKind:'auth_detail',manualSellerRefresh:true,probe:{mode:'fetch_json',method:'GET',url:'https://sp-api.tcgplayer.com/Account/auth-detail'}},
    progress_json:{stage:'queued',percent:0,detail:'Manual Seller refresh auth check queued',updatedAt:now},max_attempts:3
  }],prefer:'return=minimal'});
  return {kind:'auth_detail',alreadyActive:false};
}

function watchManualResult(before){
  clearInterval(manualWatch);
  let checks=0;
  manualWatch=setInterval(async()=>{
    if(document.hidden)return;
    checks++;
    try{
      const row=await latestSnapshot();
      const changed=row?.collected_at&&row.collected_at!==before;
      if(changed){
        clearInterval(manualWatch);manualWatch=null;
        store.update('seller',{manualSyncStatus:'done'});
        await checkSellerFreshness({forceReload:true});
        return;
      }
    }catch{}
    if(checks>=MANUAL_WATCH_LIMIT){
      clearInterval(manualWatch);manualWatch=null;
      store.update('seller',{manualSyncStatus:'waiting'});
      renderFreshness();
    }
  },MANUAL_WATCH_MS);
}

export async function requestSellerSync(){
  const session=readSession();
  const userId=session?.user?.id;
  if(!userId)throw new Error('Sign in required');
  const before=(await latestSnapshot())?.collected_at||null;
  store.update('seller',{manualSyncStatus:'queued',manualSyncError:null});
  renderFreshness();
  const jobs=await sellerJobs(userId);
  const queued=await queueManualJob(userId,jobs);
  store.update('seller',{manualSyncStatus:'running',manualSyncKind:queued.kind,manualSyncRequestedAt:new Date().toISOString()});
  renderFreshness();
  // If this is the Android app and the Seller Portal session is available, don't
  // wait for the normal 15-second agent cadence.
  window.CollectishSellerAgent?.run?.().catch?.(()=>{});
  watchManualResult(before);
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
