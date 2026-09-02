import { invokeFunction } from '../../core/functions.js';

const recent=new Map();
const TTL=6*60*60*1000;
let installed=false;
function scheduleDiscovery(row){
  const run=()=>void discover(row);
  if('requestIdleCallback' in window)requestIdleCallback(run,{timeout:5000});
  else setTimeout(run,1500);
}

function rowForButton(button){
  const host=document.getElementById('cxUniversalResults');
  return host?._rows?.get?.(String(button?.dataset?.universalSku||''))||null;
}

function shouldRun(row){
  if(!row?.product_id)return false;
  const key=String(row.product_id);
  const last=Number(recent.get(key)||0);
  if(Date.now()-last<TTL)return false;
  recent.set(key,Date.now());
  return true;
}

async function discover(row){
  if(!shouldRun(row))return null;
  try{
    const data=await invokeFunction('scout-tcgplayer-sku-discovery',{
      product_id:String(row.product_id),
      desired_condition:'NEAR MINT',
      desired_language:'ENGLISH',
      persist:true,
      reason:'scout_user_open_discovery'
    });
    const learned=Number(data?.materialized_nm_english_count||0);
    document.dispatchEvent(new CustomEvent('collectish:scout-sku-discovery-complete',{
      detail:{productId:String(row.product_id),skuId:String(row.sku_id||''),learned,data}
    }));
    return data;
  }catch(error){
    console.warn('Scout on-demand SKU discovery failed',error);
    document.dispatchEvent(new CustomEvent('collectish:scout-sku-discovery-failed',{
      detail:{productId:String(row.product_id),skuId:String(row.sku_id||''),error:String(error?.message||error)}
    }));
    return null;
  }
}

export function installOnDemandSkuDiscovery(){
  if(installed)return;
  installed=true;
  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('[data-universal-sku]');
    if(!button)return;
    const row=rowForButton(button);
    if(row?.product_id)scheduleDiscovery(row);
  },true);
}

installOnDemandSkuDiscovery();
