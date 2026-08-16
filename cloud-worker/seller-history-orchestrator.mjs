// Collectish Seller History orchestrator.
//
// IMPORTANT: this process never calls TCGplayer itself. It only coordinates
// bounded read-only jobs that must be executed inside an already-authenticated
// Collectish Android Seller Portal WebView. The Android native policy remains
// the authority for allowed hosts, methods, paths, and body sizes.
import {
  validateOrderSearchResponse,
  normalizeSummaryOrder,
  normalizeOrderDetail,
  detailOrderNumberFromSearchRow
} from './seller-history-normalizer.mjs';

const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){
  const headers={...H,...(prefer?{Prefer:prefer}:{})};
  const response=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{
    method,headers,body:body===undefined?undefined:JSON.stringify(body)
  });
  const text=await response.text();
  let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!response.ok)throw new Error(data?.message||data?.hint||`Supabase HTTP ${response.status}: ${String(text).slice(0,220)}`);
  return data;
}
const enc=v=>encodeURIComponent(String(v??''));
const DAY=86400000;
function startUtcDay(value){const d=new Date(value);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())).toISOString()}
function tomorrowUtc(){const d=new Date();return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+1)).toISOString()}
function probeBody(job){return job?.progress_json?.readOnlyProbe?.body ?? null}
function probeUrl(job){return String(job?.payload_json?.probe?.url||job?.payload_json?.config?.url||'')}
function kind(job){
  const explicit=job?.payload_json?.sellerHistoryKind;
  if(explicit)return explicit;
  const url=probeUrl(job);
  if(/\/Account\/auth-detail/i.test(url))return 'auth_detail';
  if(/\/orders\/search(?:\?|$)/i.test(url))return 'order_search';
  if(/\/orders\/[^/?]+\?api-version=2\.0/i.test(url))return 'order_detail';
  return null;
}
async function markOrchestrated(job,extra={}){
  const progress={...(job.progress_json||{}),orchestratedAt:new Date().toISOString(),...extra};
  await sb(`collector_jobs?job_id=eq.${enc(job.job_id)}`,{method:'PATCH',body:{progress_json:progress},prefer:'return=minimal'});
}
async function latestOrderDate(userId){
  const rows=await sb(`seller_orders?select=order_date&user_id=eq.${enc(userId)}&order=order_date.desc.nullslast&limit=1`);
  return rows?.[0]?.order_date||null;
}
async function activeProbeJobs(userId){
  return await sb(`collector_jobs?select=job_id,status,payload_json,progress_json&user_id=eq.${enc(userId)}&source=eq.agent&action=eq.seller_portal_readonly_probe&status=in.(queued,claimed,running,completed)&order=created_at.desc&limit=500`);
}
async function hasSearchWork(userId){
  const rows=await activeProbeJobs(userId);
  return (rows||[]).some(j=>kind(j)==='order_search' && (
    ['queued','claimed','running'].includes(j.status) ||
    (j.status==='completed' && !j.progress_json?.orchestratedAt)
  ));
}
async function queueIncrementalSearch(authJob,sellerKey){
  if(await hasSearchWork(authJob.user_id))return false;
  const latest=await latestOrderDate(authJob.user_id);
  const baseline=latest?new Date(latest):new Date(Date.now()-30*DAY);
  const from=startUtcDay(new Date(baseline.getTime()-7*DAY));
  const to=tomorrowUtc();
  const now=new Date().toISOString();
  const body={searchRange:'Custom',filters:{sellerKey,orderDate:{from,to}},sortBy:[{sortingType:'orderDate',direction:'descending'}],from:0,size:1000};
  await sb('collector_jobs',{method:'POST',body:[{
    user_id:authJob.user_id,source:'agent',action:'seller_portal_readonly_probe',status:'queued',priority:4,
    required_capability:'tcgplayer_authenticated_session',preferred_executor:'android_agent',
    payload_json:{sellerHistoryKind:'order_search',sellerHistoryParentJobId:authJob.job_id,windowFrom:from,windowTo:to,pageFrom:0,pageSize:1000,
      probe:{mode:'fetch_json',method:'POST',url:'https://order-management-api.tcgplayer.com/orders/search?api-version=2.0',body}},
    progress_json:{stage:'queued',percent:0,detail:'Seller History incremental order-summary probe queued',updatedAt:now},max_attempts:3
  }],prefer:'return=minimal'});
  return true;
}
async function fetchExistingWindow(userId,from,to){
  if(!from||!to)return [];
  return await sb(`seller_orders?select=order_number,order_date,order_status,order_channel,order_fulfillment,buyer_name,shipping_type,has_details&user_id=eq.${enc(userId)}&order_date=gte.${enc(from)}&order_date=lt.${enc(to)}&limit=5000`);
}
function summaryNeedsDetail(raw,normalized,existing){
  if(!existing||!existing.has_details)return true;
  const checks=[[raw?.orderStatus??raw?.status,existing.order_status],[raw?.orderChannel,existing.order_channel],[raw?.orderFulfillment,existing.order_fulfillment],[raw?.buyerName,existing.buyer_name],[raw?.shippingType,existing.shipping_type]];
  for(const [incoming,current] of checks)if(incoming!=null&&String(incoming)!==String(current??''))return true;
  if(normalized?.order_date&&existing.order_date){const a=new Date(normalized.order_date).getTime(),b=new Date(existing.order_date).getTime();if(Number.isFinite(a)&&Number.isFinite(b)&&a!==b)return true;}
  return false;
}
async function upsertSummaryRows(rows){if(rows.length)await sb('seller_orders?on_conflict=user_id,order_number',{method:'POST',body:rows,prefer:'resolution=merge-duplicates,return=minimal'});}
async function hasSearchPageWork(userId,windowFrom,windowTo,pageFrom){
  const rows=await activeProbeJobs(userId);
  return (rows||[]).some(j=>kind(j)==='order_search'&&String(j.payload_json?.windowFrom||'')===String(windowFrom||'')&&String(j.payload_json?.windowTo||'')===String(windowTo||'')&&Number(j.payload_json?.pageFrom||0)===Number(pageFrom||0)&&(['queued','claimed','running'].includes(j.status)||(j.status==='completed'&&!j.progress_json?.orchestratedAt)));
}
async function queueNextSearchPage(job,nextFrom){
  const payload=job.payload_json||{};if(await hasSearchPageWork(job.user_id,payload.windowFrom,payload.windowTo,nextFrom))return false;
  const body={...(payload.probe?.body||{}),from:nextFrom};const now=new Date().toISOString();
  await sb('collector_jobs',{method:'POST',body:[{user_id:job.user_id,source:'agent',action:'seller_portal_readonly_probe',status:'queued',priority:4,required_capability:'tcgplayer_authenticated_session',preferred_executor:'android_agent',
    payload_json:{sellerHistoryKind:'order_search',sellerHistoryParentJobId:payload.sellerHistoryParentJobId||job.job_id,windowFrom:payload.windowFrom,windowTo:payload.windowTo,pageFrom:nextFrom,pageSize:Number(body.size||1000),probe:{mode:'fetch_json',method:'POST',url:'https://order-management-api.tcgplayer.com/orders/search?api-version=2.0',body}},
    progress_json:{stage:'queued',percent:0,detail:`Seller History order-summary page ${nextFrom} queued`,updatedAt:now},max_attempts:3}],prefer:'return=minimal'});return true;
}
async function queueDetailJobs(searchJob,orderNumbers){
  const unique=[...new Set((orderNumbers||[]).map(String).filter(Boolean))];if(!unique.length)return 0;
  const existing=await activeProbeJobs(searchJob.user_id);
  const active=new Set((existing||[]).filter(j=>kind(j)==='order_detail'&&['queued','claimed','running'].includes(j.status)).map(j=>String(j.payload_json?.orderNumber||'')));
  const toQueue=unique.filter(id=>!active.has(id));const now=new Date().toISOString();let queued=0;
  for(let i=0;i<toQueue.length;i+=100){
    const batch=toQueue.slice(i,i+100).map(orderNumber=>({user_id:searchJob.user_id,source:'agent',action:'seller_portal_readonly_probe',status:'queued',priority:5,
      required_capability:'tcgplayer_authenticated_session',preferred_executor:'android_agent',
      payload_json:{sellerHistoryKind:'order_detail',sellerHistoryParentJobId:searchJob.job_id,orderNumber,probe:{mode:'fetch_json',method:'GET',url:`https://order-management-api.tcgplayer.com/orders/${encodeURIComponent(orderNumber)}?api-version=2.0`}},
      progress_json:{stage:'queued',percent:0,detail:`Fresh Seller History detail probe queued for ${orderNumber}`,updatedAt:now},max_attempts:3}));
    if(batch.length){await sb('collector_jobs',{method:'POST',body:batch,prefer:'return=minimal'});queued+=batch.length;}
  }
  return queued;
}
async function processSearchJob(job){
  const checked=validateOrderSearchResponse(probeBody(job));
  if(!checked.ok){await markOrchestrated(job,{orchestratorStatus:'search_shape_rejected',orchestratorError:checked.error});return {accepted:false,detailsQueued:0,nextQueued:false};}
  const payload=job.payload_json||{},collectedAt=new Date().toISOString();
  const existing=await fetchExistingWindow(job.user_id,payload.windowFrom,payload.windowTo),existingById=new Map((existing||[]).map(r=>[String(r.order_number),r]));
  const normalized=checked.orders.map(o=>normalizeSummaryOrder(job.user_id,o,collectedAt)).filter(Boolean),details=[];
  for(let i=0;i<checked.orders.length;i++){const raw=checked.orders[i],row=normalized.find(r=>r.order_number===detailOrderNumberFromSearchRow(raw));if(!row)continue;const current=existingById.get(row.order_number);if(summaryNeedsDetail(raw,row,current))details.push(row.order_number);}
  await upsertSummaryRows(normalized);
  const detailsQueued=await queueDetailJobs(job,details),pageFrom=Number(payload.pageFrom??payload.probe?.body?.from??0),returned=checked.orders.length;
  let nextQueued=false;if(returned>0&&pageFrom+returned<checked.totalOrders)nextQueued=await queueNextSearchPage(job,pageFrom+returned);
  const incomplete=returned===0&&pageFrom<checked.totalOrders;
  await markOrchestrated(job,{orchestratorStatus:incomplete?'search_pagination_stalled':'search_normalized',searchTotalOrders:checked.totalOrders,searchReturned:returned,summaryRowsUpserted:normalized.length,detailJobsQueued:detailsQueued,nextPageQueued:nextQueued});
  return {accepted:!incomplete,detailsQueued,nextQueued};
}
async function upsertDetailBundle(job){
  const bundle=normalizeOrderDetail(job.user_id,probeBody(job),new Date().toISOString());
  await sb('seller_orders?on_conflict=user_id,order_number',{method:'POST',body:[bundle.order],prefer:'resolution=merge-duplicates,return=minimal'});
  if(bundle.items.length)await sb('seller_order_items?on_conflict=user_id,row_id',{method:'POST',body:bundle.items,prefer:'resolution=merge-duplicates,return=minimal'});
  if(bundle.refunds.length)await sb('seller_refunds?on_conflict=user_id,refund_id',{method:'POST',body:bundle.refunds,prefer:'resolution=merge-duplicates,return=minimal'});
  if(bundle.review)await sb('seller_reviews?on_conflict=user_id,order_number',{method:'POST',body:[bundle.review],prefer:'resolution=merge-duplicates,return=minimal'});
  await markOrchestrated(job,{orchestratorStatus:'order_detail_normalized',normalizedOrderNumber:bundle.order.order_number,normalizedItems:bundle.items.length,normalizedRefunds:bundle.refunds.length,normalizedReview:Boolean(bundle.review)});
  return bundle.order.order_number;
}
async function main(){
  const completed=await sb('collector_jobs?select=*&source=eq.agent&action=eq.seller_portal_readonly_probe&status=eq.completed&order=completed_at.desc&limit=500');
  let authProcessed=0,searchProcessed=0,detailProcessed=0,other=0;
  for(const job of completed||[]){if(job.progress_json?.orchestratedAt)continue;const k=kind(job);try{
    if(k==='auth_detail'){const body=probeBody(job),sellerKey=body?.seller?.sellerKey;if(!sellerKey){await markOrchestrated(job,{orchestratorStatus:'auth_result_missing_seller_key'});continue;}const queued=await queueIncrementalSearch(job,String(sellerKey));await markOrchestrated(job,{orchestratorStatus:queued?'incremental_search_queued':'incremental_search_already_active'});authProcessed++;continue;}
    if(k==='order_search'){await processSearchJob(job);searchProcessed++;continue;}
    if(k==='order_detail'){await upsertDetailBundle(job);detailProcessed++;continue;}
    other++;
  }catch(error){await markOrchestrated(job,{orchestratorStatus:'normalization_failed',orchestratorError:String(error?.message||error)});}}
  console.log(`Seller History orchestrator: ${authProcessed} auth, ${searchProcessed} search, ${detailProcessed} detail result(s) processed; ${other} unrelated.`);
}
await main();