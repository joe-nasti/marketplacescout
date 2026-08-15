// Collectish Seller History orchestrator.
//
// IMPORTANT: this process never calls TCGplayer itself. It only coordinates
// bounded read-only jobs that must be executed inside an already-authenticated
// Collectish Android Seller Portal WebView. The Android native policy remains
// the authority for allowed hosts, methods, paths, and body sizes.
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
async function hasSearchWork(userId){
  const rows=await sb(`collector_jobs?select=job_id,status,payload_json&user_id=eq.${enc(userId)}&source=eq.agent&action=eq.seller_portal_readonly_probe&status=in.(queued,claimed,running,completed)&order=created_at.desc&limit=50`);
  return (rows||[]).some(j=>kind(j)==='order_search' && !j.progress_json?.orchestratedAt);
}
async function queueIncrementalSearch(authJob,sellerKey){
  if(await hasSearchWork(authJob.user_id))return false;
  const latest=await latestOrderDate(authJob.user_id);
  // Preserve the extension's overlap strategy. Existing cloud history is already
  // backfilled, so normal migration starts with a seven-day overlap. If there is
  // no baseline, use a bounded 30-day bootstrap first rather than attempting a
  // massive request in one probe.
  const baseline=latest?new Date(latest):new Date(Date.now()-30*DAY);
  const from=startUtcDay(new Date(baseline.getTime()-7*DAY));
  const to=tomorrowUtc();
  const now=new Date().toISOString();
  const body={
    searchRange:'Custom',
    filters:{sellerKey,orderDate:{from,to}},
    sortBy:[{sortingType:'orderDate',direction:'descending'}],
    from:0,
    size:1000
  };
  await sb('collector_jobs',{method:'POST',body:[{
    user_id:authJob.user_id,
    source:'agent',
    action:'seller_portal_readonly_probe',
    status:'queued',
    priority:7,
    required_capability:'tcgplayer_authenticated_session',
    preferred_executor:'android_agent',
    payload_json:{
      sellerHistoryKind:'order_search',
      sellerHistoryParentJobId:authJob.job_id,
      windowFrom:from,
      windowTo:to,
      pageFrom:0,
      pageSize:1000,
      probe:{
        mode:'fetch_json',method:'POST',
        url:'https://order-management-api.tcgplayer.com/orders/search?api-version=2.0',
        body
      }
    },
    progress_json:{stage:'queued',percent:0,detail:'Seller History incremental order-summary probe queued',updatedAt:now},
    max_attempts:3
  }],prefer:'return=minimal'});
  return true;
}

async function main(){
  const completed=await sb('collector_jobs?select=*&source=eq.agent&action=eq.seller_portal_readonly_probe&status=eq.completed&order=completed_at.asc&limit=100');
  let authProcessed=0,searchReady=0,other=0;
  for(const job of completed||[]){
    if(job.progress_json?.orchestratedAt)continue;
    const k=kind(job);
    if(k==='auth_detail'){
      const body=probeBody(job);
      const sellerKey=body?.seller?.sellerKey;
      if(!sellerKey){
        await markOrchestrated(job,{orchestratorStatus:'auth_result_missing_seller_key'});
        continue;
      }
      const queued=await queueIncrementalSearch(job,String(sellerKey));
      await markOrchestrated(job,{orchestratorStatus:queued?'incremental_search_queued':'incremental_search_already_active'});
      authProcessed++;
      continue;
    }
    if(k==='order_search'){
      // Deliberately stop at the exact response-shape boundary for now. The next
      // normalizer step will be enabled only after a live v0.1.10 response proves
      // the private endpoint payload matches the HAR-backed extension contract.
      await markOrchestrated(job,{orchestratorStatus:'search_response_ready_for_normalization'});
      searchReady++;
      continue;
    }
    other++;
  }
  console.log(`Seller History orchestrator: ${authProcessed} auth result(s), ${searchReady} search result(s) ready, ${other} unrelated completed probe(s).`);
}
await main();
