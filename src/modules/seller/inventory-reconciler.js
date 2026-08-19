import { rest } from '../../core/rest.js';
import { readSession } from '../../core/session.js';
import store from '../../state/store.js';

const POLL_MS=60_000;
const MAX_ITEMS_PER_PASS=250;
const MAX_PRODUCTS_PER_PASS=30;
const SWEEP_INTERVAL_MS=15*60_000;
const SWEEP_PRODUCTS=5;
const FULL_AUDIT_MS=24*60*60*1000;
let timer=null,busy=false;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const userId=()=>readSession()?.user?.id||'';
const isoNow=()=>new Date().toISOString();
const escKey=s=>String(s??'').replace(/[^A-Za-z0-9_.:-]/g,'_').slice(0,180);

async function state(){const rows=await rest('store_inventory_reconcile_state?select=*&limit=1');return rows?.[0]||null}
async function saveState(patch){const uid=userId();if(!uid)return;await rest('store_inventory_reconcile_state?on_conflict=user_id',{method:'POST',body:[{user_id:uid,updated_at:isoNow(),...patch}],prefer:'resolution=merge-duplicates,return=minimal'})}
async function event(row){const uid=userId();if(!uid)return;await rest('store_inventory_change_events?on_conflict=user_id,event_key',{method:'POST',body:[{user_id:uid,...row}],prefer:'resolution=ignore-duplicates,return=minimal'})}

async function exactBefore(productId){return await rest(`store_inventory_conditions?select=product_condition_id,product_id,quantity,price,captured_at&product_id=eq.${encodeURIComponent(productId)}&limit=1000`)}
function indexRows(rows){const m=new Map();for(const r of rows||[])m.set(String(r.product_condition_id),r);return m}

async function compareExact(productId,before,after,context={}){
  const b=indexRows(before),a=indexRows(after),ids=new Set([...b.keys(),...a.keys()]);
  let changes=0;
  for(const id of ids){
    const old=b.get(id)||{},cur=a.get(id)||{};
    const oq=old.quantity==null?null:Number(old.quantity),nq=cur.quantity==null?null:Number(cur.quantity);
    const op=old.price==null?null:Number(old.price),np=cur.price==null?null:Number(cur.price);
    if(oq!==nq){changes++;await event({event_key:escKey(`qty:${productId}:${id}:${cur.captured_at||isoNow()}:${oq}->${nq}`),detected_at:isoNow(),product_id:String(productId),product_condition_id:id,change_type:'quantity_change',source:context.saleQty?'sale_reconcile':'store_observed',order_number:context.orderNumber||null,order_item_row_id:context.rowId||null,old_quantity:oq,new_quantity:nq,metadata:{expectedSaleQty:context.saleQty||0,sweep:Boolean(context.sweep)}})}
    if(op!==np){changes++;await event({event_key:escKey(`price:${productId}:${id}:${cur.captured_at||isoNow()}:${op}->${np}`),detected_at:isoNow(),product_id:String(productId),product_condition_id:id,change_type:'price_change',source:'store_observed',order_number:context.orderNumber||null,order_item_row_id:context.rowId||null,old_price:op,new_price:np,metadata:{externalCandidate:true,sweep:Boolean(context.sweep)}})}
  }
  return changes;
}

async function reconcileProduct(productId,context={}){
  const inv=window.CollectishInventory;
  if(!inv?.enrich)throw new Error('Inventory detail bridge unavailable');
  const before=await exactBefore(productId);
  await inv.enrich(String(productId),{quiet:true});
  await sleep(100);
  const after=await exactBefore(productId);
  return await compareExact(productId,before,after,context);
}

async function recentSales(s){
  const since=s?.last_order_item_collected_at||new Date(Date.now()-6*60*60*1000).toISOString();
  return await rest(`seller_order_items?select=row_id,order_number,order_date,product_id,sku_id,quantity,collected_at,source_updated_at&product_id=not.is.null&collected_at=gt.${encodeURIComponent(since)}&order=collected_at.asc&limit=${MAX_ITEMS_PER_PASS}`);
}

async function sweepCandidates(exclude){
  const rows=await rest(`store_inventory_conditions?select=product_id,captured_at&quantity=gt.0&order=captured_at.asc&limit=500`);
  const seen=new Set(),out=[];
  for(const r of rows||[]){const pid=String(r.product_id||'');if(!pid||seen.has(pid)||exclude.has(pid))continue;seen.add(pid);out.push(pid);if(out.length>=SWEEP_PRODUCTS)break}
  return out;
}

async function runPass(){
  if(busy||document.hidden)return;
  const uid=userId();if(!uid)return;
  busy=true;
  try{
    const s=await state();
    const sales=await recentSales(s);
    const grouped=new Map();let watermark=s?.last_order_item_collected_at||null;
    for(const x of sales||[]){
      if(x.collected_at&&(!watermark||new Date(x.collected_at)>new Date(watermark)))watermark=x.collected_at;
      const pid=String(x.product_id||'');if(!pid)continue;
      const g=grouped.get(pid)||{saleQty:0,orderNumber:x.order_number||null,rowId:x.row_id||null};g.saleQty+=Number(x.quantity||0);grouped.set(pid,g);
      await event({event_key:escKey(`sale:${x.row_id||`${x.order_number}:${pid}:${x.sku_id||''}`}`),detected_at:x.collected_at||isoNow(),product_id:pid,change_type:'sale_observed',source:'seller_order',order_number:x.order_number||null,order_item_row_id:x.row_id||null,metadata:{skuId:x.sku_id||null,quantity:Number(x.quantity||0),orderDate:x.order_date||null}});
    }

    let checked=0,changes=0,swept=0;
    for(const [pid,ctx] of [...grouped.entries()].slice(0,MAX_PRODUCTS_PER_PASS)){
      try{changes+=await reconcileProduct(pid,ctx);checked++}catch(e){await event({event_key:escKey(`reconcile-error:${pid}:${Date.now()}`),detected_at:isoNow(),product_id:pid,change_type:'reconcile_error',source:'targeted_check',metadata:{error:String(e?.message||e)}})}
    }

    const lastSweep=s?.detail?.lastSweepAt?new Date(s.detail.lastSweepAt).getTime():0;
    if(Date.now()-lastSweep>=SWEEP_INTERVAL_MS){
      const candidates=await sweepCandidates(new Set(grouped.keys()));
      for(const pid of candidates){try{changes+=await reconcileProduct(pid,{sweep:true});swept++}catch{}}
    }

    const syncRows=await rest('store_inventory_sync_state?select=last_completed_at&limit=1').catch(()=>[]);
    const lastFull=s?.last_full_audit_at||syncRows?.[0]?.last_completed_at||null;
    const fullDue=!lastFull||Date.now()-new Date(lastFull).getTime()>=FULL_AUDIT_MS;
    const detail={...(s?.detail||{}),salesObserved:(sales||[]).length,productsChecked:checked,sweepProductsChecked:swept,changesDetected:changes,fullAuditDue:fullDue};
    if(swept)detail.lastSweepAt=isoNow();
    await saveState({last_order_item_collected_at:watermark,last_targeted_check_at:(checked||swept)?isoNow():s?.last_targeted_check_at||null,last_full_audit_at:lastFull,pending_product_count:Math.max(0,grouped.size-checked),last_error:null,detail});
    store.update('inventory',{reconcile:{salesObserved:(sales||[]).length,productsChecked:checked,sweepProductsChecked:swept,changesDetected:changes,fullAuditDue:fullDue,lastRunAt:isoNow()}});
  }catch(e){await saveState({last_error:String(e?.message||e)}).catch(()=>{});store.update('inventory',{reconcile:{error:String(e?.message||e),lastRunAt:isoNow()}})}finally{busy=false}
}

function kick(){runPass().catch(()=>{})}
export function installInventoryReconciler(){clearInterval(timer);timer=setInterval(kick,POLL_MS);setTimeout(kick,5000);window.addEventListener('focus',kick);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')kick()})}
installInventoryReconciler();
window.CollectishInventoryReconciler={run:runPass};
