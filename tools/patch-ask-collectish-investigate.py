from pathlib import Path
import re

p=Path('cloud-worker/marketplace-worker.mjs')
s=p.read_text()

pattern=r'async function main\(\)\{.*?\}\n\nawait main\(\);'
replacement=r'''async function runScoutSalesEnrich(job){
  const productId=String(job.payload_json?.productId||job.payload_json?.product_id||'');
  if(!productId)throw new Error('Ask Collectish Investigate job missing productId');
  await updateJob(job,{status:"running",progress_json:{stage:"sales",percent:15,detail:`Investigating TCG sales history for product ${productId}`}},"running");
  const hist=await getSalesHistory(productId),result=Array.isArray(hist?.result)?hist.result:[];
  const applied=await sb("rpc/apply_scout_sales_cache",{method:"POST",body:{p_user_id:job.user_id,p_product_id:productId,p_result:result}});
  await updateJob(job,{status:"completed",completed_at:new Date().toISOString(),lease_expires_at:null,error_message:null,progress_json:{stage:"complete",percent:100,detail:`Investigate complete: ${result.length} sales SKUs refreshed`,productId,appliedRows:Number(applied||0)}},"completed");
  return {productId,skuCount:result.length,appliedRows:Number(applied||0)};
}

async function main(){
  const ai=await sb(`collector_jobs?source=eq.ask_collectish&action=eq.scout_sales_enrich&status=eq.queued&preferred_executor=in.(cloud-marketplace-worker,cloud_worker,server)&order=created_at.asc&limit=${MAX_JOBS}`)||[];
  const remaining=Math.max(0,MAX_JOBS-ai.length);
  const scans=remaining?await sb(`collector_jobs?source=eq.marketplace&action=eq.scan_set&status=eq.queued&preferred_executor=in.(cloud_worker,server,verification)&order=priority.asc,created_at.asc&limit=${remaining}`):[];
  const jobs=[...ai,...(scans||[])].slice(0,MAX_JOBS);
  if(!jobs.length){console.log("No cloud-targeted Marketplace or Ask Collectish jobs queued.");return}
  for(const candidate of jobs){let job=null;try{
    job=await claim(candidate);if(!job){console.log(`Lost claim for ${candidate.job_id}`);continue}
    if(job.source==='ask_collectish'&&job.action==='scout_sales_enrich'){
      console.log(`Investigating Scout sales for ${job.payload_json?.productId||'unknown product'}`);
      const result=await runScoutSalesEnrich(job);console.log(`Investigate completed for ${result.productId}: ${result.skuCount} sales SKUs`);continue;
    }
    console.log(`Running ${job.job_id}: ${job.payload_json?.profile?.setName||job.payload_json?.profile?.setSlug||"Marketplace scan"}`);
    const scan=await runScan(job);console.log(`Completed ${scan.scanId}: ${scan.setName}, ${scan.uniqueSkus} SKUs`)
  }catch(e){console.error(e);if(job)try{await updateJob(job,{status:"failed",completed_at:new Date().toISOString(),lease_expires_at:null,error_message:String(e.message||e).slice(0,1000),progress_json:{stage:"failed",percent:0,detail:String(e.message||e).slice(0,500)}},"failed")}catch(inner){console.error("Failed to persist job failure",inner)}}}
}

await main();'''

s2,n=re.subn(pattern,replacement,s,count=1,flags=re.S)
if n!=1:
    raise SystemExit('Expected marketplace-worker main() block not found')
p.write_text(s2)
print('Patched marketplace worker for Ask Collectish Investigate jobs')
