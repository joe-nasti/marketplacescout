// Enforce Collectish Marketplace executor/capability routing before workers claim jobs.
// All Marketplace scan_set execution is cloud-only. No browser connector fallback.
const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const h={...H,...(prefer?{Prefer:prefer}:{})};const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok)throw new Error(data?.message||data?.hint||`Supabase HTTP ${r.status}`);return data}
const enc=v=>encodeURIComponent(String(v??''));
const patch=async(job,body)=>sb(`collector_jobs?job_id=eq.${enc(job.job_id)}&status=eq.queued`,{method:'PATCH',body,prefer:'return=minimal'});

async function main(){
  const jobs=await sb('collector_jobs?source=eq.marketplace&action=eq.scan_set&status=eq.queued&order=created_at.asc&limit=500');
  let cloud=0,verification=0,untouched=0;
  for(const job of jobs||[]){
    const payload=job.payload_json||{};
    const preferred=job.preferred_executor||null;
    const capability=job.required_capability||null;
    const verificationCloud=payload.verificationRole==='cloud'||preferred==='verification';

    // Cloud-side manual verification is allowed to keep its dedicated executor tag.
    // A legacy PC verification job is deliberately migrated to the normal cloud worker.
    if(verificationCloud&&payload.verificationRole!=='pc'){
      if(preferred!=='verification'||capability!=='marketplace_public_api'){
        await patch(job,{preferred_executor:'verification',required_capability:'marketplace_public_api',payload_json:{...payload,executionClass:'cloud_verification',pcFallback:false,pcFallbackQueued:false,cloudOnly:true}});verification++;
      }else untouched++;
      continue;
    }

    const cleanPayload={
      ...payload,
      cloudPrimary:true,
      cloudOnly:true,
      pcFallback:false,
      pcFallbackQueued:false,
      executionClass:'cloud_public',
      ...(payload.verificationRole==='pc'?{verificationRole:'cloud',verificationMigratedFrom:'pc'}:{})
    };
    if(preferred!=='cloud_worker'||capability!=='marketplace_public_api'||payload.executionClass!=='cloud_public'||payload.pcFallback===true||payload.cloudOnly!==true){
      await patch(job,{preferred_executor:'cloud_worker',required_capability:'marketplace_public_api',payload_json:cleanPayload});cloud++;
    }else untouched++;
  }
  console.log(`Marketplace routing normalized: ${cloud} cloud-only, ${verification} cloud verification, ${untouched} unchanged; 0 browser routes.`);
}
await main();
