// Ensure Seller History has a bounded recurring authenticated starting point.
// The Android agent executes the private Seller Portal auth-detail request; this
// cloud process only coordinates jobs and never calls TCGplayer itself.
const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const h={...H,...(prefer?{Prefer:prefer}:{})};const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok)throw new Error(data?.message||data?.hint||`Supabase HTTP ${r.status}: ${String(text).slice(0,220)}`);return data}
const enc=v=>encodeURIComponent(String(v??''));
// Automatic Seller Portal checks are intentionally daily. The orchestrator may
// run more frequently, but it must not create another authenticated sync seed
// until the last auth/search sync is at least 24 hours old.
const cutoff=new Date(Date.now()-24*60*60*1000).toISOString();

async function main(){
  const users=await sb('seller_orders?select=user_id&order=collected_at.desc&limit=500');
  const ids=[...new Set((users||[]).map(r=>r.user_id).filter(Boolean))];
  let queued=0,skipped=0;
  for(const userId of ids){
    const active=await sb(`collector_jobs?select=job_id,status,payload_json,created_at,completed_at&user_id=eq.${enc(userId)}&source=eq.agent&action=eq.seller_portal_readonly_probe&status=in.(queued,claimed,running)&order=created_at.desc&limit=200`);
    const activeSync=(active||[]).some(j=>['auth_detail','order_search'].includes(j.payload_json?.sellerHistoryKind));
    if(activeSync){skipped++;continue;}
    const recent=await sb(`collector_jobs?select=job_id,status,payload_json,created_at,completed_at&user_id=eq.${enc(userId)}&source=eq.agent&action=eq.seller_portal_readonly_probe&status=eq.completed&completed_at=gte.${enc(cutoff)}&order=completed_at.desc&limit=100`);
    const recentSync=(recent||[]).some(j=>['auth_detail','order_search'].includes(j.payload_json?.sellerHistoryKind));
    if(recentSync){skipped++;continue;}
    const now=new Date().toISOString();
    await sb('collector_jobs',{method:'POST',body:[{
      user_id:userId,source:'agent',action:'seller_portal_readonly_probe',status:'queued',priority:3,
      required_capability:'tcgplayer_authenticated_session',preferred_executor:'android_agent',
      payload_json:{sellerHistoryKind:'auth_detail',probe:{mode:'fetch_json',method:'GET',url:'https://sp-api.tcgplayer.com/Account/auth-detail'}},
      progress_json:{stage:'queued',percent:0,detail:'Daily Seller History auth-detail seed queued for incremental sync',updatedAt:now},
      max_attempts:3
    }],prefer:'return=minimal'});queued++;
  }
  console.log(`Seller History daily seed: ${queued} auth-detail probe(s) queued, ${skipped} user(s) already active/recent.`);
}
await main();
