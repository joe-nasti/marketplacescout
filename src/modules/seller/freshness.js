import store from '../../state/store.js';
import { rest } from '../../core/rest.js';

const KNOWN_KEY='collectishSellerKnownOrder';
const POLL_MS=60_000;
let timer=null;
let polling=false;

const fmt=t=>t?new Date(t).toLocaleString():'—';
const age=t=>{
  if(!t)return 'never';
  const ms=Math.max(0,Date.now()-new Date(t).getTime());
  if(ms<60_000)return 'just now';
  if(ms<3_600_000)return `${Math.max(1,Math.round(ms/60_000))}m ago`;
  if(ms<86_400_000)return `${Math.round(ms/3_600_000)}h ago`;
  return `${Math.round(ms/86_400_000)}d ago`;
};

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

function renderFreshness(){
  const s=store.get().seller||{};
  const head=document.querySelector('#cxSeller .cx-page-head>div');
  if(!head)return;
  let line=head.querySelector('.cx-seller-freshness');
  if(!line){line=document.createElement('div');line.className='cx-seller-freshness';head.append(line)}
  const synced=s.lastSyncedAt;
  const stale=synced?Date.now()-new Date(synced).getTime()>15*60_000:true;
  line.classList.toggle('stale',stale);
  line.classList.toggle('new-order',Boolean(s.hasNewOrder));
  const newText=s.hasNewOrder?' · NEW ORDER':'';
  line.textContent=`Seller data synced ${age(synced)}${synced?` · ${fmt(synced)}`:''}${newText}`;
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
    const prev=store.get().seller?.latestOrderNumber||knownOrder();
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

function kick(){if(!document.hidden)checkSellerFreshness().catch(()=>{})}
function install(){
  clearInterval(timer);
  timer=setInterval(kick,POLL_MS);
  setTimeout(kick,1500);
  document.addEventListener('collectish:seller-rendered',renderFreshness);
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
window.CollectishSellerFreshness={check:checkSellerFreshness,clear:clearNewOrder};
