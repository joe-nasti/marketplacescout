// Ensure exactly one useful cloud verification test exists.
const SUPABASE_URL=(process.env.SUPABASE_URL||"").replace(/\/$/,"");
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,"Content-Type":"application/json"};
async function sb(path,{method="GET",body,prefer}={}){const h={...H,...(prefer?{Prefer:prefer}:{})};const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok)throw new Error(data?.message||data?.hint||`Supabase HTTP ${r.status}: ${String(text).slice(0,220)}`);return data}
const enc=x=>encodeURIComponent(String(x??""));
async function main(){
  const jobs=await sb("collector_jobs?source=eq.marketplace&action=eq.scan_set&preferred_executor=eq.verification&order=created_at.desc&limit=30");
  if((jobs||[]).some(j=>["queued","claimed","running"].includes(j.status))){console.log("Verification work already active; nothing to create.");return}
  for(const j of jobs||[]){
    if(j.status!=="completed")continue;
    const ev=await sb(`collector_job_events?job_id=eq.${enc(j.job_id)}&event_type=eq.parity_check&limit=1`);
    if(ev?.length){console.log("A completed verification already has parity results; bootstrap complete.");return}
  }
  const scans=await sb("marketplace_scans?select=*&order=captured_at.desc&limit=50");
  const pc=(scans||[]).find(s=>s.profile_json?.executor!=="cloud_worker");
  if(!pc){console.log("No PC Marketplace scan available for verification baseline.");return}
  const p=pc.profile_json||{};
  const profile={setSlug:pc.set_slug,setName:pc.set_name,printing:pc.printing,condition:pc.condition,language:pc.language,salesEnrich:Number(p.salesEnrich||pc.sales_enriched||0),scanDepth:"Full"};
  const now=new Date().toISOString();
  await sb("collector_jobs",{method:"POST",body:[{user_id:pc.user_id,source:"marketplace",action:"scan_set",status:"queued",priority:50,required_capability:"marketplace_scan",preferred_executor:"verification",payload_json:{profile,verificationOfScanId:pc.scan_id,repairBootstrap:true},progress_json:{stage:"queued",percent:0,detail:`Cloud verification of ${profile.setName}`,updatedAt:now},max_attempts:3}],prefer:"return=minimal"});
  console.log(`Queued fresh cloud verification for ${profile.setName} against PC scan ${pc.scan_id}.`);
}
await main();
