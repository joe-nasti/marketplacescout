import store from '../../state/store.js';
import { invokeFunction } from '../../core/functions.js';
import { prefetchAskCardContext } from './ask-prefetch.js';
import { readScoutDetail } from './cache-read.js';

let installed=false;
const skuOf=value=>String(value??'');
const discoveryRecent=new Map();
const discoveryInflight=new Map();
const DISCOVERY_TTL=6*60*60*1000;
function scheduleDiscovery(detail){
  const run=()=>void discoverProduct(detail);
  if('requestIdleCallback' in window)requestIdleCallback(run,{timeout:5000});
  else setTimeout(run,1500);
}

function resolveSummary(detail={}){
  const sku=skuOf(detail.sku_id??detail.sku);
  if(!sku)return detail?.product_id?detail:null;
  const state=store.get().scout||{};
  const row=(state.rows||[]).find(r=>skuOf(r.sku_id)===sku);
  if(row)return {...detail,...row};
  return {...detail,sku_id:detail.sku_id??detail.sku,product_id:detail.product_id,product_name:detail.product_name||detail.card_name||'',card_name:detail.card_name||detail.product_name||''};
}
const productIdOf=row=>String(row?.product_id||row?.productId||row?.entity?.product_id||'').trim();
function shouldDiscover(row,force=false){const pid=productIdOf(row);if(!pid)return false;if(force)return true;const last=Number(discoveryRecent.get(pid)||0);if(Date.now()-last<DISCOVERY_TTL)return false;discoveryRecent.set(pid,Date.now());return true}
async function discoverProduct(row,{desiredFinish=null,force=false,reason='scout_card_open_discovery'}={}){const pid=productIdOf(row);if(!pid||!shouldDiscover(row,force))return null;if(discoveryInflight.has(pid))return discoveryInflight.get(pid);const task=(async()=>{try{const data=await invokeFunction('scout-tcgplayer-sku-discovery',{product_id:pid,...(desiredFinish?{desired_finish:desiredFinish}:{}),desired_condition:'NEAR MINT',desired_language:'ENGLISH',persist:true,force,reason});document.dispatchEvent(new CustomEvent('collectish:scout-sku-discovery-complete',{detail:{productId:pid,skuId:skuOf(row?.sku_id),learned:Number(data?.materialized_nm_english_count||0),data}}));return data}catch(error){console.warn('Scout on-demand SKU discovery failed',error);document.dispatchEvent(new CustomEvent('collectish:scout-sku-discovery-failed',{detail:{productId:pid,skuId:skuOf(row?.sku_id),error:String(error?.message||error)}}));return null}finally{discoveryInflight.delete(pid)}})();discoveryInflight.set(pid,task);return task}

async function hydrateAndRender(row){
  const renderer=window.CollectishScoutRenderer;if(!renderer?.renderDetail||!row?.sku_id)return;
  const detail=await readScoutDetail(row).catch(()=>row);
  if(!detail)return;
  await renderer.prefetchCard?.(detail);
  await renderer.renderDetail(detail,true);
  void prefetchAskCardContext(detail);
  scheduleDiscovery(detail);
}
export function openScoutDetail(detail={}){
  const renderer=window.CollectishScoutRenderer;if(!renderer?.renderDetail)return false;
  if(!document.getElementById('cxParityDetail'))return false;
  const row=resolveSummary(detail);if(!row?.sku_id)return false;
  const sku=skuOf(row.sku_id);store.update('scout',{selectedSku:row.sku_id});
  document.querySelectorAll('#cxParityCards .cx-scout-card[data-sku]').forEach(card=>card.classList.toggle('selected',skuOf(card.dataset.sku)===sku));
  void renderer.renderDetail(row,true);
  void hydrateAndRender(row);
  return true;
}
function click(e){const hit=e.target.closest?.('#cxScout .cx-scout-card[data-sku], #cxScout [data-quick-turn-sku]');if(!hit)return;const detail=hit.dataset.quickTurnSku?{sku_id:hit.dataset.quickTurnSku}:{sku_id:hit.dataset.sku};if(!openScoutDetail(detail))return;e.preventDefault();e.stopImmediatePropagation()}
function openEvent(e){const detail=e.detail||{};if(!openScoutDetail(detail)&&detail?.product_id)void discoverProduct(detail)}
export function installScoutDetailNavigation(){if(installed)return;installed=true;document.addEventListener('click',click,true);document.addEventListener('collectish:open-scout-card',openEvent)}
installScoutDetailNavigation();
window.CollectishScoutDetailNavigation={open:openScoutDetail};
window.CollectishScoutSkuDiscovery={discover:(row,options={})=>discoverProduct(row,options),discoverProduct:(pid,options={})=>discoverProduct({product_id:String(pid)},options)};
