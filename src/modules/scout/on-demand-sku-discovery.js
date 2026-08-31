import { invokeFunction } from '../../core/functions.js';

const recent=new Map();
const inflight=new Map();
const TTL=6*60*60*1000;
let installed=false;

const productId=row=>String(row?.product_id||row?.productId||row?.entity?.product_id||'').trim();
const skuId=row=>String(row?.sku_id||row?.skuId||row?.entity?.sku_id||'').trim();

function rowForButton(button){
  const host=document.getElementById('cxUniversalResults');
  return host?._rows?.get?.(String(button?.dataset?.universalSku||''))||null;
}

function finishFor(row){
  const raw=String(row?.printing||row?.finish||row?.variant||'').trim();
  if(!raw)return null;
  const s=raw.toLowerCase();
  if(s.includes('etched'))return'etched foil';
  if(s.includes('foil')&&!s.includes('non foil')&&!s.includes('non-foil'))return'foil';
  if(s.includes('non foil')||s.includes('non-foil')||s==='normal'||s==='regular')return'nonfoil';
  return null;
}

function shouldRun(row,force=false){
  const pid=productId(row);
  if(!pid)return false;
  if(force)return true;
  const last=Number(recent.get(pid)||0);
  if(Date.now()-last<TTL)return false;
  recent.set(pid,Date.now());
  return true;
}

async function discover(row,{desiredFinish=null,force=false,reason='scout_user_open_discovery'}={}){
  const pid=productId(row);
  if(!pid||!shouldRun(row,force))return null;
  if(inflight.has(pid))return inflight.get(pid);
  const task=(async()=>{
    try{
      const data=await invokeFunction('scout-tcgplayer-sku-discovery',{
        product_id:pid,
        ...(desiredFinish?{desired_finish:desiredFinish}:{}),
        desired_condition:'NEAR MINT',
        desired_language:'ENGLISH',
        persist:true,
        force,
        reason
      });
      const learned=Number(data?.materialized_nm_english_count||0);
      document.dispatchEvent(new CustomEvent('collectish:scout-sku-discovery-complete',{
        detail:{productId:pid,skuId:skuId(row),learned,data}
      }));
      return data;
    }catch(error){
      console.warn('Scout on-demand SKU discovery failed',error);
      document.dispatchEvent(new CustomEvent('collectish:scout-sku-discovery-failed',{
        detail:{productId:pid,skuId:skuId(row),error:String(error?.message||error)}
      }));
      return null;
    }finally{
      inflight.delete(pid);
    }
  })();
  inflight.set(pid,task);
  return task;
}

function discoverOpenedRow(row,reason='scout_card_open_discovery'){
  if(!productId(row))return;
  // Deliberately omit desired_finish here. Opening any known product should teach
  // Collectish every NM English sibling SKU TCGplayer exposes for that product,
  // then queue refreshes for the discovered siblings in the same call.
  void discover(row,{reason});
}

export function installOnDemandSkuDiscovery(){
  if(installed)return;
  installed=true;

  // Universal-search clicks can happen before the detail-open event is emitted.
  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('[data-universal-sku]');
    if(!button)return;
    const row=rowForButton(button);
    if(row?.product_id)discoverOpenedRow(row,'scout_universal_open_discovery');
  },true);

  // This is the shared Scout hook. Normal list/detail opens, global-search opens,
  // Signal handoffs, and other callers already converge on collectish:open-scout-card.
  document.addEventListener('collectish:open-scout-card',event=>{
    discoverOpenedRow(event?.detail,'scout_card_open_discovery');
  },true);

  // Give Ask/Signals/other first-party surfaces one small client API when they
  // already know a product but have not opened the detail surface yet.
  window.CollectishScoutSkuDiscovery={
    discover:(row,options={})=>discover(row,options),
    discoverProduct:(pid,options={})=>discover({product_id:String(pid)},options)
  };
}

installOnDemandSkuDiscovery();
