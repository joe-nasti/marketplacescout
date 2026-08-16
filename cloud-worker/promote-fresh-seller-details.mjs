const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){
  const headers={...H,...(prefer?{Prefer:prefer}:{})};
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();
  let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!r.ok)throw new Error(data?.message||data?.hint||`Supabase HTTP ${r.status}: ${String(text).slice(0,220)}`);
  return data;
}
const enc=v=>encodeURIComponent(String(v??''));

async function main(){
  const users=await sb('seller_orders?select=user_id&order=collected_at.desc&limit=200');
  const userIds=[...new Set((users||[]).map(r=>r.user_id).filter(Boolean))];
  let promoted=0;

  for(const userId of userIds){
    const newest=await sb(`seller_orders?select=order_number,order_date&user_id=eq.${enc(userId)}&has_details=eq.false&order=order_date.desc.nullslast&limit=20`);
    const orderNumbers=(newest||[]).map(r=>String(r.order_number||'')).filter(Boolean);
    if(!orderNumbers.length)continue;

    const jobs=await sb(`collector_jobs?select=job_id,priority,status,payload_json&user_id=eq.${enc(userId)}&source=eq.agent&action=eq.seller_portal_readonly_probe&status=eq.queued&priority=gte.3&limit=500`);
    const wanted=new Set(orderNumbers);
    const matches=(jobs||[]).filter(j=>j.payload_json?.sellerHistoryKind==='order_detail'&&wanted.has(String(j.payload_json?.orderNumber||'')));
    for(const job of matches){
      await sb(`collector_jobs?job_id=eq.${enc(job.job_id)}`,{
        method:'PATCH',
        body:{priority:2,progress_json:{...(job.progress_json||{}),stage:'queued',percent:0,detail:'Newest Seller order detail promoted ahead of overlap/backfill work',updatedAt:new Date().toISOString()}},
        prefer:'return=minimal'
      });
      promoted++;
    }
  }
  console.log(`Seller History detail promoter: ${promoted} queued newest-order detail job(s) promoted.`);
}
await main();
