// One-time bootstrap for the first cloud parity test.
// Prefer cloning the latest completed Marketplace PC collector job. If older PC
// runs predate collector_jobs, fall back to the latest non-cloud Marketplace scan.

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
  const pcJob=(completed||[]).find(j=>j.preferred_executor!=="verification"&&j.claimed_by!=="cloud-marketplace-worker");

  let userId=null,profile=null,sourceRef=null;
  if(pcJob){
    userId=pcJob.user_id;
    profile=pcJob.payload_json?.profile||pcJob.payload_json||{};
    sourceRef={verificationOfJobId:pcJob.job_id};
  }else{
    const scans=await sb("marketplace_scans?select=user_id,scan_id,set_slug,set_name,printing,condition,language,profile_json,captured_at&order=captured_at.desc&limit=50");
    const pcScan=(scans||[]).find(s=>s.profile_json?.executor!=="cloud_worker");
    if(!pcScan){console.log("No completed PC Marketplace job or non-cloud scan found to clone for verification.");return}
    userId=pcScan.user_id;
    profile={
      setSlug:pcScan.set_slug,
      setName:pcScan.set_name,
      printing:pcScan.printing||pcScan.profile_json?.printing||"Both",
      condition:pcScan.condition||pcScan.profile_json?.condition||"Near Mint",
      language:pcScan.language||pcScan.profile_json?.language||"English",
      salesEnrich:Number(pcScan.profile_json?.salesEnrich||0),
      scanDepth:"Full"
    };
    sourceRef={verificationOfScanId:pcScan.scan_id};
  }

  if(!profile?.setSlug)throw new Error("Verification baseline has no setSlug");
  const now=new Date().toISOString();
  await sb("collector_jobs",{method:"POST",body:[{
    user_id:userId,source:"marketplace",action:"scan_set",status:"queued",priority:50,
    required_capability:"marketplace_scan",preferred_executor:"verification",
    payload_json:{profile:{...profile,scanDepth:"Full"},...sourceRef,bootstrap:true},
    progress_json:{stage:"queued",percent:0,detail:`Automatic first cloud verification of ${profile.setName||profile.setSlug}`,updatedAt:now},
    max_attempts:3
  }],prefer:"return=minimal"});
  console.log(`Queued first verification clone of ${profile.setName||profile.setSlug}.`);
}

await main();
