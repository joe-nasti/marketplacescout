// Enforce Collectish Marketplace executor/capability routing before workers claim jobs.
const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const h={...H,...(prefer?{Prefer:prefer}:{})};const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok)throw new Error(data?.message||data?.hint||`Supabase HTTP ${r.status}`);return data}
const enc=v=>encodeURIComponent(String(v??''));
const patch=async(job,body)=>sb(`collector_jobs?job_id=eq.${enc(job.job_id)}&status=eq.queued`,{method:'PATCH',body,prefer:'return=minimal'});

async function main(){
  const jobs=await sb('collector_jobs?source=eq.marketplace&action=eq.scan_set&status=eq.queued&order=created_at.asc&limit=200');
  let cloud=0,fallback=0,auth=0,verification=0,untouched=0;
  for(const job of jobs||[]){
    const payload=job.payload_json||{};
    const preferred=job.preferred_executor||null;
    const capability=job.required_capability||null;
    const authRequired=Boolean(payload.authRequired||payload.requiresAuthenticatedSession||payload.executionClass==='browser_auth');
    const verificationRole=payload.verificationRole||null;
    const verificationPc=verificationRole==='pc';
    const verificationCloud=verificationRole==='cloud'||preferred==='verification';
    // A fresh cloud retry is deliberately a child of the failed job, so parent_job_id
    // alone must not convert it into browser fallback. But once a fallback is created
    // from that fresh retry, cloudFailureJobId/pcFallback/browser_fallback are authoritative.
    const freshCloudRetry=Boolean(
      (payload.cloudFreshRetryOf||Number(payload.cloudFreshRetryCount||0)>0) &&
      !payload.cloudFailureJobId && payload.pcFallback!==true && payload.executionClass!=='browser_fallback'
    );
    const explicitFallback=Boolean(
      payload.pcFallback||payload.cloudFailureJobId||payload.executionClass==='browser_fallback'||
      (!freshCloudRetry&&job.parent_job_id)||verificationPc
    );

    if(authRequired){
      if(preferred!=='browser_connector'||capability!=='tcgplayer_authenticated_session'){
        await patch(job,{preferred_executor:'browser_connector',required_capability:'tcgplayer_authenticated_session',payload_json:{...payload,executionClass:'browser_auth'}});auth++;
      }else untouched++;
      continue;
    }
    if(verificationCloud){
      if(preferred!=='verification'||capability!=='marketplace_public_api'){
        await patch(job,{preferred_executor:'verification',required_capability:'marketplace_public_api',payload_json:{...payload,executionClass:'cloud_verification'}});verification++;
      }else untouched++;
      continue;
    }
    if(freshCloudRetry){
      const cleanPayload={...payload,cloudPrimary:true,executionClass:'cloud_public',pcFallback:false,pcFallbackQueued:false};
      if(preferred!=='cloud_worker'||capability!=='marketplace_public_api'||payload.executionClass!=='cloud_public'||payload.pcFallback===true){
        await patch(job,{preferred_executor:'cloud_worker',required_capability:'marketplace_public_api',payload_json:cleanPayload});cloud++;
      }else untouched++;
      continue;
    }
    if(explicitFallback){
      if(preferred!=='browser_connector'||capability!=='marketplace_browser_fallback'||payload.executionClass!=='browser_fallback'||payload.pcFallback!==true){
        await patch(job,{preferred_executor:'browser_connector',required_capability:'marketplace_browser_fallback',payload_json:{...payload,executionClass:verificationPc?'browser_verification':'browser_fallback',pcFallback:true}});fallback++;
      }else untouched++;
      continue;
    }

    if(preferred!=='cloud_worker'||capability!=='marketplace_public_api'){
      await patch(job,{preferred_executor:'cloud_worker',required_capability:'marketplace_public_api',payload_json:{...payload,cloudPrimary:true,executionClass:'cloud_public'}});cloud++;
    }else untouched++;
  }
  console.log(`Marketplace routing normalized: ${cloud} cloud, ${fallback} browser, ${auth} auth, ${verification} verification, ${untouched} unchanged.`);
}
await main();
