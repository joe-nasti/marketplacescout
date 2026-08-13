// One-time bootstrap for the first cloud parity test.
// If the account has never had a verification job, clone the latest completed
// Marketplace PC job into preferred_executor=verification. Subsequent runs do nothing.

const SUPABASE_URL=(process.env.SUPABASE_URL||"").replace(/\/$/,"");
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,"Content-Type":"application/json"};
async function sb(path,{method="GET",body,prefer}={}){
  const h={...H,...(prefer?{Prefer:prefer}:{})};
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!r.ok)throw new Error(data?.message||data?.hint||`Supabase HTTP ${r.status}: ${String(text).slice(0,220)}`);
  return data;
}

async function main(){
  const existing=await sb("collector_jobs?source=eq.marketplace&action=eq.scan_set&preferred_executor=eq.verification&limit=1");
  if(existing?.length){console.log("Verification job already exists; bootstrap not needed.");return}

  const completed=await sb("collector_jobs?source=eq.marketplace&action=eq.scan_set&status=eq.completed&order=completed_at.desc&limit=20");
  const pc=(completed||[]).find(j=>j.preferred_executor!=="verification"&&j.claimed_by!=="cloud-marketplace-worker");
  if(!pc){console.log("No completed PC Marketplace job found to clone for verification.");return}

  const profile=pc.payload_json?.profile||pc.payload_json||{};
  if(!profile.setSlug)throw new Error("Latest PC job has no profile.setSlug");
  const now=new Date().toISOString();
  await sb("collector_jobs",{method:"POST",body:[{
    user_id:pc.user_id,source:"marketplace",action:"scan_set",status:"queued",priority:50,
    required_capability:"marketplace_scan",preferred_executor:"verification",
    payload_json:{profile:{...profile,scanDepth:"Full"},verificationOfJobId:pc.job_id,bootstrap:true},
    progress_json:{stage:"queued",percent:0,detail:`Automatic first cloud verification of ${profile.setName||profile.setSlug}`,updatedAt:now},
    max_attempts:3
  }],prefer:"return=minimal"});
  console.log(`Queued first verification clone of ${profile.setName||profile.setSlug} from PC job ${pc.job_id}.`);
}

await main();
