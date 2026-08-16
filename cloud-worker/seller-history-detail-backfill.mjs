// Queue bounded historical Seller History order-detail backfill work.
//
// This script never calls TCGplayer. It only examines Supabase state and queues
// read-only order-detail probes for the authenticated Android agent. The native
// Android allowlist remains the authority for hosts, methods, paths and body sizes.
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
async function allRows(path,pageSize=1000,maxRows=5000){
  const out=[];
  for(let offset=0;offset<maxRows;offset+=pageSize){
    const sep=path.includes('?')?'&':'?';
    const rows=await sb(`${path}${sep}offset=${offset}&limit=${Math.min(pageSize,maxRows-offset)}`);
    out.push(...(rows||[]));
    if(!rows||rows.length<pageSize)break;
  }
  return out;
}
const enc=v=>encodeURIComponent(String(v??''));
function probeKind(job){
  const explicit=job?.payload_json?.sellerHistoryKind;
  if(explicit)return explicit;
  const url=String(job?.payload_json?.probe?.url||job?.payload_json?.config?.url||'');
  if(/\/orders\/search(?:\?|$)/i.test(url))return 'order_search';
  if(/\/orders\/[^/?]+\?api-version=2\.0/i.test(url))return 'order_detail';
  if(/\/Account\/auth-detail/i.test(url))return 'auth_detail';
  return null;
}
function isProtected(job){
  if(['queued','claimed','running'].includes(job?.status))return true;
  return job?.status==='completed'&&!job?.progress_json?.orchestratedAt;
}

const MAX_ACTIVE_DETAILS=50;
// Keep a small guaranteed lane for orders that still have no normalized detail.
// Incremental refresh probes can temporarily exceed MAX_ACTIVE_DETAILS after a
// large orders/search delta; without this reserve they could starve historical
// missing-detail backfill for many Android sessions.
const MIN_MISSING_DETAIL_SLOTS=25;
const missing=await allRows(
  'seller_orders?select=user_id,order_number,order_date&or=(has_details.eq.false,has_details.is.null)&order=order_date.asc.nullslast',
  1000,
  5000
);
const byUser=new Map();
for(const row of missing||[]){
  if(!row?.user_id||!row?.order_number)continue;
  if(!byUser.has(row.user_id))byUser.set(row.user_id,[]);
  byUser.get(row.user_id).push(row);
}

let queuedTotal=0;
for(const [userId,rows] of byUser){
  const jobs=await allRows(
    `collector_jobs?select=job_id,status,payload_json,progress_json&user_id=eq.${enc(userId)}&source=eq.agent&action=eq.seller_portal_readonly_probe&status=in.(queued,claimed,running,completed)&order=created_at.desc`,
    1000,
    3000
  );
  const protectedJobs=(jobs||[]).filter(isProtected);
  const searchActive=protectedJobs.some(j=>probeKind(j)==='order_search');
  if(searchActive){
    console.log(`Seller History detail backfill ${userId}: incremental search work is active; skipping this pass.`);
    continue;
  }

  const protectedDetails=protectedJobs.filter(j=>probeKind(j)==='order_detail');
  const activeIds=new Set(protectedDetails.map(j=>String(j.payload_json?.orderNumber||'')).filter(Boolean));
  const missingIds=new Set(rows.map(row=>String(row.order_number||'')).filter(Boolean));
  const activeMissingCount=protectedDetails.reduce((count,j)=>{
    const orderNumber=String(j.payload_json?.orderNumber||'');
    return count+(orderNumber&&missingIds.has(orderNumber)?1:0);
  },0);
  const normalCapacity=Math.max(0,MAX_ACTIVE_DETAILS-protectedDetails.length);
  const missingReserveCapacity=Math.max(0,MIN_MISSING_DETAIL_SLOTS-activeMissingCount);
  const capacity=Math.max(normalCapacity,missingReserveCapacity);
  if(!capacity){
    console.log(`Seller History detail backfill ${userId}: ${protectedDetails.length} detail probes active/pending, including ${activeMissingCount} missing-detail orders.`);
    continue;
  }

  const candidates=[];
  for(const row of rows){
    const orderNumber=String(row.order_number||'');
    if(!orderNumber||activeIds.has(orderNumber))continue;
    candidates.push(orderNumber);
    if(candidates.length>=capacity)break;
  }
  if(!candidates.length)continue;

  const now=new Date().toISOString();
  const batch=candidates.map(orderNumber=>({
    user_id:userId,
    source:'agent',
    action:'seller_portal_readonly_probe',
    status:'queued',
    // Missing historical detail should drain before refresh probes for orders that
    // are already fully normalized, while fresh auth/search work stays ahead.
    priority:5,
    required_capability:'tcgplayer_authenticated_session',
    preferred_executor:'android_agent',
    payload_json:{
      sellerHistoryKind:'order_detail',
      sellerHistoryBackfill:true,
      orderNumber,
      probe:{
        mode:'fetch_json',
        method:'GET',
        url:`https://order-management-api.tcgplayer.com/orders/${encodeURIComponent(orderNumber)}?api-version=2.0`
      }
    },
    progress_json:{stage:'queued',percent:0,detail:`Seller History historical detail backfill queued for ${orderNumber}`,updatedAt:now},
    max_attempts:3
  }));
  await sb('collector_jobs',{method:'POST',body:batch,prefer:'return=minimal'});
  queuedTotal+=batch.length;
  console.log(`Seller History detail backfill ${userId}: queued ${batch.length} order-detail probes (${rows.length} historical summary rows still need details).`);
}
console.log(`Seller History detail backfill: ${queuedTotal} probe(s) queued this pass.`);
