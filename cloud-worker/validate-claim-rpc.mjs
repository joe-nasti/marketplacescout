const U=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const K=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!U||!K)throw new Error('Missing Supabase worker configuration');
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'};
async function req(path,{method='GET',body,prefer}={}){
  const r=await fetch(`${U}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}
  if(!r.ok)throw new Error(`${path} failed: HTTP ${r.status}: ${String(t).slice(0,400)}`);
  return d;
}
async function claim(source,action){return req('rpc/claim_collector_job',{method:'POST',body:{p_source:source,p_action:action,p_preferred_executors:['cloud_worker'],p_required_capability:'marketplace_public_api',p_collector_id:'00000000-0000-4000-8000-000000000001',p_lease_seconds:300}})}

const empty=await claim('collectish_rpc_probe','noop');
if(!Array.isArray(empty)||empty.length)throw new Error('claim_collector_job probe unexpectedly matched a job');

const prior=await req('collector_jobs?select=user_id&order=created_at.desc&limit=1');
const userId=prior?.[0]?.user_id;
if(!userId)throw new Error('Atomic claim self-test needs at least one existing collector_jobs user_id');
const source=`atomic_claim_test_${Date.now()}`,action='noop';
const created=await req('collector_jobs',{method:'POST',body:[{user_id:userId,source,action,status:'queued',priority:1,required_capability:'marketplace_public_api',preferred_executor:'cloud_worker',payload_json:{validationOnly:true},progress_json:{stage:'queued',detail:'Atomic claim validation'}}],prefer:'return=representation'});
const testJobId=created?.[0]?.job_id;if(!testJobId)throw new Error('Atomic claim self-test could not create temporary job');
const [a,b]=await Promise.all([claim(source,action),claim(source,action)]);
const claimed=[...(a||[]),...(b||[])];
if(claimed.length!==1||claimed[0]?.job_id!==testJobId)throw new Error(`Atomic claim exclusivity failed: expected exactly one claim of ${testJobId}, got ${claimed.length}`);
await req(`collector_jobs?job_id=eq.${encodeURIComponent(testJobId)}`,{method:'PATCH',body:{status:'completed',completed_at:new Date().toISOString(),lease_expires_at:null,progress_json:{stage:'complete',percent:100,detail:'Atomic claim validation passed',validationOnly:true}},prefer:'return=minimal'});
console.log(`Atomic claim RPC passed concurrent exclusivity test for ${testJobId}.`);
