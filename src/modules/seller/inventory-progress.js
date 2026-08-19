import { rest } from '../../core/rest.js';
import { registerComponent } from '../../core/lifecycle.js';
import store from '../../state/store.js';

let active=false;
let persisted=null;
let renderTimer=null;
let pollTimer=null;
let unsubscribe=null;

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const num=n=>Number(n||0).toLocaleString();
const fmtElapsed=t=>{if(!t)return '—';const ms=Math.max(0,Date.now()-new Date(t).getTime()),s=Math.floor(ms/1000),m=Math.floor(s/60),h=Math.floor(m/60);return h?`${h}h ${m%60}m`:m?`${m}m ${s%60}s`:`${s}s`};

function bridgeState(){
  try{return String(window.CollectishReadOnly?.getReadOnlyProbeState?.()||'unavailable')}catch{return 'unavailable'}
}

async function pollPersisted(){
  if(!active)return;
  try{const rows=await rest('store_inventory_sync_state?select=*&limit=1');persisted=rows?.[0]||null}catch{}
  render();
}

function ensurePanel(){
  const host=document.getElementById('cxInventory');if(!host)return null;
  let panel=host.querySelector('#cxInventoryProgress');
  if(panel)return panel;
  panel=document.createElement('section');panel.id='cxInventoryProgress';panel.className='cx-inventory-progress cx-card';
  const head=host.querySelector('.cx-page-head');
  if(head?.nextSibling)host.insertBefore(panel,head.nextSibling);else if(head)head.after(panel);else host.prepend(panel);
  return panel;
}

function render(){
  if(!active)return;
  const panel=ensurePanel();if(!panel)return;
  const local=store.get().inventory||{};
  const running=local.status==='syncing'||persisted?.status==='running';
  const phase=local.phase||persisted?.phase||(running?'starting':'idle');
  const pages=Number(local.pagesFetched??persisted?.pages_fetched??0);
  const total=Number(local.totalPages??persisted?.detail?.totalPages??0);
  const seen=Number(local.productsSeen??persisted?.products_seen??0);
  const stocked=Number(local.productsWithStock??persisted?.products_with_stock??0);
  const exact=Number(persisted?.conditions_enriched??0);
  const started=local.startedAt||persisted?.last_started_at||null;
  const dbCheckpoint=persisted?.updated_at?new Date(persisted.updated_at).toLocaleTimeString():'none yet';
  const err=local.error||persisted?.last_error||'';
  const pct=phase.startsWith('catalog')&&total>0?Math.max(0,Math.min(100,Math.round((pages/total)*100))):phase==='complete'?100:0;
  let title='Inventory sync idle',detail='Tap Sync Store to pull the latest authenticated Store inventory.';
  if(running){
    if(phase.startsWith('catalog')){title=`Catalog scan${total?` — page ${Math.min(pages+1,total)} of ${total}`:''}`;detail=`${num(seen)} products scanned · ${num(stocked)} with stock`;}
    else if(phase==='exact rows'){title='Exact pricing enrichment';detail=`Catalog complete · enriching priority condition / foil rows`;}
    else{title='Starting inventory sync';detail='Waiting for the first authenticated Store response.';}
  } else if(local.status==='error'||persisted?.status==='failed'){title='Inventory sync failed';detail=err||'The last sync did not complete.';}
  else if(persisted?.status==='complete'){title='Last inventory sync complete';detail=`${num(persisted.products_seen)} products scanned · ${num(persisted.products_with_stock)} with stock · ${num(exact)} exact rows`;}

  panel.innerHTML=`<div class="cx-inventory-progress-head"><div><strong>${esc(title)}</strong><span>${esc(detail)}</span></div><b>${running?`${pct}%`:persisted?.status==='complete'?'Done':'—'}</b></div>
    <div class="cx-inventory-progress-bar"><i style="width:${pct}%"></i></div>
    <div class="cx-inventory-progress-meta"><span>Elapsed <b>${esc(fmtElapsed(started))}</b></span><span>Store request <b>${esc(bridgeState())}</b></span><span>DB checkpoint <b>${esc(dbCheckpoint)}</b></span></div>
    <details><summary>Sync details</summary><div class="cx-inventory-progress-details"><span>Phase <b>${esc(phase)}</b></span><span>Pages saved <b>${num(pages)}${total?` / ${num(total)}`:''}</b></span><span>Products seen <b>${num(seen)}</b></span><span>With stock <b>${num(stocked)}</b></span><span>Exact rows <b>${num(exact)}</b></span>${err?`<span class="error">Last error <b>${esc(err)}</b></span>`:''}</div></details>`;
}

function start(){
  if(active)return;active=true;
  unsubscribe=store.subscribe(s=>s.inventory,()=>render());
  renderTimer=setInterval(render,1000);
  pollPersisted();pollTimer=setInterval(pollPersisted,3000);
  render();
}
function stop(){active=false;unsubscribe?.();unsubscribe=null;clearInterval(renderTimer);clearInterval(pollTimer);renderTimer=pollTimer=null;}

registerComponent('inventory-progress',{onPage(page){if(page==='inventory')start();else stop();}});
