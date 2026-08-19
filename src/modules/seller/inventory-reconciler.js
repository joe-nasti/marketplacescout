import { rest } from '../../core/rest.js';
import { readSession } from '../../core/session.js';
import store from '../../state/store.js';

const POLL_MS=60_000;
const MAX_ITEMS_PER_PASS=250;
const MAX_PRODUCTS_PER_PASS=30;
const SWEEP_INTERVAL_MS=15*60_000;
const SWEEP_PRODUCTS=8;
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
    if(oq!==nq){changes++;await event({event_key:escKey(`qty:${productId}:${id}:${cur.captured_at||isoNow()}:${oq}->${nq}`),detected_at:isoNow(),product_id:String(productId),product_condition_id:id,change_type:'quantity_change',source:context.saleQty?'sale_reconcile':'store_observed',order_number:context.orderNumber||null,order_item_row_id:context.rowId||null,old_quantity:oq,new_quantity:nq,metadata:{expectedSaleQty:context.saleQty||0,sweep:Boolean(context.sweep),priorityScore:context.priorityScore??null,priorityReasons:context.priorityReasons||[]}})}
    if(op!==np){changes++;await event({event_key:escKey(`price:${productId}:${id}:${cur.captured_at||isoNow()}:${op}->${np}`),detected_at:isoNow(),product_id:String(productId),product_condition_id:id,change_type:'price_change',source:'store_observed',order_number:context.orderNumber||null,order_item_row_id:context.rowId||null,old_price:op,new_price:np,metadata:{externalCandidate:true,sweep:Boolean(context.sweep),priorityScore:context.priorityScore??null,priorityReasons:context.priorityReasons||[]}})}
  }
  return changes;
}

async function reconcileProduct(productId,context={}){
  const inv=window.CollectishInventory;
  if(!inv?.enrich)throw new Error('Inventory detail bridge unavailable');
  const before=await exactBefore(productId);
  const hadExact=before.length>0;
  await inv.enrich(String(productId),{quiet:true});
  await sleep(100);
  const after=await exactBefore(productId);
  const changes=await compareExact(productId,before,after,context);
  if(!hadExact&&after.length){await event({event_key:escKey(`coverage:${productId}:${after[0]?.captured_at||isoNow()}`),detected_at:isoNow(),product_id:String(productId),change_type:'exact_coverage_added',source:context.saleQty?'sale_reconcile':'priority_sweep',metadata:{rowsAdded:after.length,priorityScore:context.priorityScore??null,priorityReasons:context.priorityReasons||[]}})}
  return {changes,coverageAdded:!hadExact&&after.length>0};
}

async function recentSales(s){
  const since=s?.last_order_item_collected_at||new Date(Date.now()-6*60*60*1000).toISOString();
  return await rest(`seller_order_items?select=row_id,order_number,order_date,product_id,sku_id,quantity,collected_at,source_updated_at&product_id=not.is.null&collected_at=gt.${encodeURIComponent(since)}&order=collected_at.asc&limit=${MAX_ITEMS_PER_PASS}`);
}

function addCandidate(map,pid,patch){
  pid=String(pid||'');if(!pid)return;
  const x=map.get(pid)||{productId:pid,quantity:0,scoutScore:0,unitsSold:0,lastSoldAt:null,lastExactAt:null,hasExact:false};
  Object.assign(x,patch);map.set(pid,x);
}

async function prioritySweepCandidates(exclude){
  const [inventory,scout,sales,coverage]=await Promise.all([
    rest('store_inventory_products?select=product_id,quantity,captured_at&quantity=gt.0&order=quantity.desc&limit=500'),
    rest('scout_opportunities_v5?select=product_id,promoted_score,opportunity_score,flag,direct_low,sku_market_price&product_id=not.is.null&order=promoted_score.desc&limit=500'),
    rest('seller_product_summary?select=product_id,units_sold,last_sold_at,revenue&product_id=not.is.null&order=last_sold_at.desc&limit=500'),
    rest('store_inventory_conditions?select=product_id,captured_at&order=captured_at.desc&limit=5000')
  ]);
  const map=new Map(),exactLatest=new Map();
  for(const r of coverage||[]){const pid=String(r.product_id||'');if(!pid)continue;const t=r.captured_at||null;if(!exactLatest.has(pid)||new Date(t)>new Date(exactLatest.get(pid)))exactLatest.set(pid,t)}
  for(const r of inventory||[])addCandidate(map,r.product_id,{quantity:Number(r.quantity||0),inventoryCapturedAt:r.captured_at||null});
  for(const r of scout||[])if(map.has(String(r.product_id||'')))addCandidate(map,r.product_id,{scoutScore:Number(r.promoted_score??r.opportunity_score??0),flag:r.flag||null,directLow:Number(r.direct_low||0),market:Number(r.sku_market_price||0)});
  for(const r of sales||[])if(map.has(String(r.product_id||'')))addCandidate(map,r.product_id,{unitsSold:Number(r.units_sold||0),lastSoldAt:r.last_sold_at||null,revenue:Number(r.revenue||0)});
  for(const [pid,x] of map){x.lastExactAt=exactLatest.get(pid)||null;x.hasExact=Boolean(x.lastExactAt)}
  const now=Date.now();
  return [...map.values()].filter(x=>!exclude.has(x.productId)).map(x=>{
    let score=0;const reasons=[];
    if(!x.hasExact){score+=55;reasons.push('no exact rows')}
    else {const ageDays=(now-new Date(x.lastExactAt).getTime())/86400000;if(ageDays>=7){score+=30;reasons.push('exact >7d old')}else if(ageDays>=1){score+=15;reasons.push('exact >1d old')}}
    if(x.lastSoldAt){const ageHours=(now-new Date(x.lastSoldAt).getTime())/3600000;if(ageHours<=24){score+=40;reasons.push('sold <24h')}else if(ageHours<=168){score+=25;reasons.push('sold <7d')}}
    if(x.unitsSold>0){score+=Math.min(20,Math.log10(1+x.unitsSold)*10);reasons.push(`${x.unitsSold} units sold`)}
    if(x.scoutScore>0){score+=Math.min(35,x.scoutScore*.35);if(x.scoutScore>=70)reasons.push(`Scout ${Math.round(x.scoutScore)}`)}
    if(x.quantity>0){score+=Math.min(20,Math.log10(1+x.quantity)*8);if(x.quantity>=5)reasons.push(`qty ${x.quantity}`)}
    if(x.market>=20||x.directLow>=20){score+=10;reasons.push('higher value')}
    return {...x,priorityScore:Math.round(score),priorityReasons:reasons.slice(0,4)}
  }).sort((a,b)=>b.priorityScore-a.priorityScore).slice(0,SWEEP_PRODUCTS);
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

    let checked=0,changes=0,swept=0,coverageAdded=0;
    for(const [pid,ctx] of [...grouped.entries()].slice(0,MAX_PRODUCTS_PER_PASS)){
      try{const r=await reconcileProduct(pid,ctx);changes+=r.changes;if(r.coverageAdded)coverageAdded++;checked++}catch(e){await event({event_key:escKey(`reconcile-error:${pid}:${Date.now()}`),detected_at:isoNow(),product_id:pid,change_type:'reconcile_error',source:'targeted_check',metadata:{error:String(e?.message||e)}})}
    }

    const lastSweep=s?.detail?.lastSweepAt?new Date(s.detail.lastSweepAt).getTime():0;let topPriority=[];
    if(Date.now()-lastSweep>=SWEEP_INTERVAL_MS){
      const candidates=await prioritySweepCandidates(new Set(grouped.keys()));topPriority=candidates.map(x=>({productId:x.productId,score:x.priorityScore,reasons:x.priorityReasons}));
      for(const x of candidates){try{const r=await reconcileProduct(x.productId,{sweep:true,priorityScore:x.priorityScore,priorityReasons:x.priorityReasons});changes+=r.changes;if(r.coverageAdded)coverageAdded++;swept++}catch{}}
    }

    const syncRows=await rest('store_inventory_sync_state?select=last_completed_at&limit=1').catch(()=>[]);
    const lastFull=s?.last_full_audit_at||syncRows?.[0]?.last_completed_at||null;
    const fullDue=!lastFull||Date.now()-new Date(lastFull).getTime()>=FULL_AUDIT_MS;
    const detail={...(s?.detail||{}),salesObserved:(sales||[]).length,productsChecked:checked,sweepProductsChecked:swept,coverageAdded,changesDetected:changes,fullAuditDue:fullDue,priorityStrategy:'sales+scout+holdings+staleness'};
    if(swept){detail.lastSweepAt=isoNow();detail.lastPriorityBatch=topPriority}
    await saveState({last_order_item_collected_at:watermark,last_targeted_check_at:(checked||swept)?isoNow():s?.last_targeted_check_at||null,last_full_audit_at:lastFull,pending_product_count:Math.max(0,grouped.size-checked),last_error:null,detail});
    store.update('inventory',{reconcile:{salesObserved:(sales||[]).length,productsChecked:checked,sweepProductsChecked:swept,coverageAdded,changesDetected:changes,fullAuditDue:fullDue,lastRunAt:isoNow()}});
  }catch(e){await saveState({last_error:String(e?.message||e)}).catch(()=>{});store.update('inventory',{reconcile:{error:String(e?.message||e),lastRunAt:isoNow()}})}finally{busy=false}
}

function kick(){runPass().catch(()=>{})}
export function installInventoryReconciler(){clearInterval(timer);timer=setInterval(kick,POLL_MS);setTimeout(kick,5000);window.addEventListener('focus',kick);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')kick()})}
installInventoryReconciler();
window.CollectishInventoryReconciler={run:runPass};
