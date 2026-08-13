// Ensure one fresh paired PC/cloud Marketplace verification exists.
const SUPABASE_URL=(process.env.SUPABASE_URL||"").replace(/\/$/,"");
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,"Content-Type":"application/json"};
async function sb(path,{method="GET",body,prefer}={}){const h={...H,...(prefer?{Prefer:prefer}:{})};const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok)throw new Error(data?.message||data?.hint||`Supabase HTTP ${r.status}: ${String(text).slice(0,220)}`);return data}

async function main(){
  const recent=await sb("collector_jobs?source=eq.marketplace&action=eq.scan_set&order=created_at.desc&limit=100");
  const paired=(recent||[]).filter(j=>j.payload_json?.verificationPairId);
  const latestPair=paired[0]?.payload_json?.verificationPairId||null;
  if(latestPair){
    const pairJobs=paired.filter(j=>j.payload_json?.verificationPairId===latestPair);
    const cloud=pairJobs.find(j=>j.payload_json?.verificationRole==="cloud");
    const linkedParity=cloud?.progress_json?.parity?.baselineSource==="linked_pair";
    if(cloud && !linkedParity && !cloud.progress_json?.parityStatus){console.log(`Existing pair ${latestPair} still awaiting linked PC parity; not creating another.`);return}
    const created=new Date(pairJobs[0]?.created_at||0).getTime();
    if(linkedParity && Date.now()-created<6*60*60*1000){console.log(`Recent paired verification ${latestPair} has linked-pair parity; not creating another yet.`);return}
  }

  const scans=await sb("marketplace_scans?select=user_id,set_slug,set_name,printing,condition,language,profile_json,captured_at&order=captured_at.desc&limit=100");
  const pc=(scans||[]).find(s=>s.profile_json?.executor!=="cloud_worker");
  if(!pc){console.log("No PC Marketplace scan exists to seed a paired verification.");return}
  const profile={setSlug:pc.set_slug,setName:pc.set_name,printing:pc.printing||"Both",condition:pc.condition||"Near Mint",language:pc.language||"English",salesEnrich:Number(pc.profile_json?.salesEnrich||0),scanDepth:"Full"};
  const pairId=crypto.randomUUID(),now=new Date().toISOString();
  const base={user_id:pc.user_id,source:"marketplace",action:"scan_set",status:"queued",priority:40,required_capability:"marketplace_scan",max_attempts:3};
  await sb("collector_jobs",{method:"POST",body:[
    {...base,preferred_executor:"browser_connector",payload_json:{profile,verificationPairId:pairId,verificationRole:"pc",automaticPair:true},progress_json:{stage:"queued",percent:0,detail:"Automatic paired verification: waiting for PC connector",pairId,updatedAt:now}},
    {...base,preferred_executor:"verification",payload_json:{profile,verificationPairId:pairId,verificationRole:"cloud",automaticPair:true},progress_json:{stage:"queued",percent:0,detail:"Automatic paired verification: waiting for cloud worker",pairId,updatedAt:now}}
  ],prefer:"return=minimal"});
  console.log(`Queued paired verification ${pairId} for ${profile.setName}.`);
}
await main();
