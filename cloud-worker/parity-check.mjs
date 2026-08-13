// Collectish Marketplace cloud parity checker v0.2.0
// Compares a completed cloud-verification scan with a linked PC scan when available,
// otherwise falls back to the latest matching PC scan.

const SUPABASE_URL=(process.env.SUPABASE_URL||"").replace(/\/$/,"");
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
const WORKER_ID="cloud-marketplace-worker";
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

function headers(extra={}){return {apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,"Content-Type":"application/json",...extra}}
async function sb(path,{method="GET",body,prefer}={}){
  const h=headers(prefer?{Prefer:prefer}:{});
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!r.ok)throw new Error(data?.message||data?.hint||`Supabase HTTP ${r.status}: ${String(text).slice(0,220)}`);
  return data;
}
async function allRows(basePath,pageSize=1000){
  const out=[];for(let offset=0;;offset+=pageSize){const sep=basePath.includes("?")?"&":"?";const page=await sb(`${basePath}${sep}limit=${pageSize}&offset=${offset}`);out.push(...(page||[]));if(!page||page.length<pageSize)break}return out;
}
const enc=x=>encodeURIComponent(String(x??""));
const pct=(n,d)=>d?100*n/d:100;
const close=(a,b,tol=.01)=>a==null&&b==null||Number.isFinite(Number(a))&&Number.isFinite(Number(b))&&Math.abs(Number(a)-Number(b))<=tol;
const tolerantPrice=(a,b)=>{
  if(a==null&&b==null)return true;if(!Number.isFinite(Number(a))||!Number.isFinite(Number(b)))return false;
  const x=Number(a),y=Number(b),tol=Math.max(.05,Math.max(Math.abs(x),Math.abs(y))*.01);return Math.abs(x-y)<=tol;
};
const eq=(a,b)=>String(a??"")===String(b??"");

async function pendingVerification(){
  const jobs=await sb("collector_jobs?source=eq.marketplace&action=eq.scan_set&preferred_executor=eq.verification&status=eq.completed&order=completed_at.desc&limit=20");
  for(const job of jobs||[]){const exists=await sb(`collector_job_events?job_id=eq.${enc(job.job_id)}&event_type=eq.parity_check&limit=1`);if(!exists?.length)return job}return null;
}
async function findCloudScan(job){
  const scanId=job.progress_json?.resultScanId||job.progress_json?.result_scan_id||null;
  if(scanId){const rows=await sb(`marketplace_scans?user_id=eq.${enc(job.user_id)}&scan_id=eq.${enc(scanId)}&limit=1`);if(rows?.[0])return rows[0]}
  const p=job.payload_json?.profile||job.payload_json||{};
  const rows=await sb(`marketplace_scans?user_id=eq.${enc(job.user_id)}&set_slug=eq.${enc(p.setSlug)}&printing=eq.${enc(p.printing||"Both")}&condition=eq.${enc(p.condition||"Near Mint")}&language=eq.${enc(p.language||"English")}&order=captured_at.desc&limit=20`);
  return (rows||[]).find(s=>s.profile_json?.executor==="cloud_worker")||null;
}
async function linkedPcScan(job){
  const pairId=job.payload_json?.verificationPairId;if(!pairId)return null;
  const jobs=await sb(`collector_jobs?user_id=eq.${enc(job.user_id)}&source=eq.marketplace&action=eq.scan_set&preferred_executor=eq.browser_connector&status=eq.completed&order=completed_at.desc&limit=50`);
  const pcJob=(jobs||[]).find(j=>j.payload_json?.verificationPairId===pairId);
  if(!pcJob)return null;
  const events=await sb(`collector_job_events?job_id=eq.${enc(pcJob.job_id)}&event_type=eq.completed&order=created_at.desc&limit=5`);
  const scanId=(events||[]).map(e=>e.metadata_json?.resultScanId).find(Boolean)||pcJob.progress_json?.resultScanId||null;
  if(!scanId)return null;
  const scans=await sb(`marketplace_scans?user_id=eq.${enc(job.user_id)}&scan_id=eq.${enc(scanId)}&limit=1`);
  return scans?.[0]||null;
}
async function findPcBaseline(job,cloudScan){
  const linked=await linkedPcScan(job);if(linked)return linked;
  const p=job.payload_json?.profile||job.payload_json||{};
  const rows=await sb(`marketplace_scans?user_id=eq.${enc(job.user_id)}&set_slug=eq.${enc(p.setSlug)}&printing=eq.${enc(p.printing||"Both")}&condition=eq.${enc(p.condition||"Near Mint")}&language=eq.${enc(p.language||"English")}&order=captured_at.desc&limit=40`);
  return (rows||[]).find(s=>s.scan_id!==cloudScan.scan_id&&s.profile_json?.executor!=="cloud_worker")||null;
}

async function compare(job,cloudScan,pcScan){
  const select="sku_id,product_name,direct_low,sku_market_price,direct_listings,direct_available,avg_daily_qty_sold,opportunity_score,flag,raw_json";
  const cloudRows=await allRows(`marketplace_scan_rows?select=${select}&user_id=eq.${enc(job.user_id)}&scan_id=eq.${enc(cloudScan.scan_id)}`);
  const pcRows=await allRows(`marketplace_scan_rows?select=${select}&user_id=eq.${enc(job.user_id)}&scan_id=eq.${enc(pcScan.scan_id)}`);
  const cm=new Map(cloudRows.map(r=>[String(r.sku_id),r])),pm=new Map(pcRows.map(r=>[String(r.sku_id),r]));
  const union=new Set([...cm.keys(),...pm.keys()]),common=[...cm.keys()].filter(k=>pm.has(k));
  let directLow=0,directLowTol=0,market=0,directAvail=0,directListings=0,totalListings=0,sales=0,score=0,flag=0;
  const samples=[];
  for(const k of common){
    const c=cm.get(k),p=pm.get(k),m={skuId:k,productName:c.product_name||p.product_name||null};let changed=false;
    if(close(c.direct_low,p.direct_low,.01))directLow++;else{m.directLow={pc:p.direct_low,cloud:c.direct_low};changed=true}
    if(tolerantPrice(c.direct_low,p.direct_low))directLowTol++;
    if(close(c.sku_market_price,p.sku_market_price,.01))market++;
    if(eq(c.direct_available,p.direct_available))directAvail++;else{m.directAvailable={pc:p.direct_available,cloud:c.direct_available};changed=true}
    if(eq(c.direct_listings,p.direct_listings))directListings++;else{m.directListings={pc:p.direct_listings,cloud:c.direct_listings};changed=true}
    if(eq(c.raw_json?.totalMarketplaceListings,p.raw_json?.totalMarketplaceListings))totalListings++;else{m.marketplaceListings={pc:p.raw_json?.totalMarketplaceListings,cloud:c.raw_json?.totalMarketplaceListings};changed=true}
    if(close(c.avg_daily_qty_sold,p.avg_daily_qty_sold,.001))sales++;else{m.salesVelocity={pc:p.avg_daily_qty_sold,cloud:c.avg_daily_qty_sold};changed=true}
    if(eq(c.opportunity_score,p.opportunity_score))score++;else{m.score={pc:p.opportunity_score,cloud:c.opportunity_score};changed=true}
    if(eq(c.flag,p.flag))flag++;else{m.flag={pc:p.flag,cloud:c.flag};changed=true}
    if(changed&&samples.length<15)samples.push(m);
  }
  const minutesApart=Math.round(Math.abs(new Date(cloudScan.captured_at)-new Date(pcScan.captured_at))/60000);
  const metrics={cloudScanId:cloudScan.scan_id,pcScanId:pcScan.scan_id,cloudCapturedAt:cloudScan.captured_at,pcCapturedAt:pcScan.captured_at,minutesApart,
    cloudSkus:cloudRows.length,pcSkus:pcRows.length,commonSkus:common.length,cloudOnly:[...cm.keys()].filter(k=>!pm.has(k)).length,pcOnly:[...pm.keys()].filter(k=>!cm.has(k)).length,
    skuOverlapPct:Number(pct(common.length,union.size).toFixed(2)),directLowMatchPct:Number(pct(directLow,common.length).toFixed(2)),directLowTolerantMatchPct:Number(pct(directLowTol,common.length).toFixed(2)),marketPriceMatchPct:Number(pct(market,common.length).toFixed(2)),directAvailableMatchPct:Number(pct(directAvail,common.length).toFixed(2)),directListingsMatchPct:Number(pct(directListings,common.length).toFixed(2)),marketplaceListingsMatchPct:Number(pct(totalListings,common.length).toFixed(2)),salesVelocityMatchPct:Number(pct(sales,common.length).toFixed(2)),scoreMatchPct:Number(pct(score,common.length).toFixed(2)),flagMatchPct:Number(pct(flag,common.length).toFixed(2)),mismatchSamples:samples,paired:Boolean(job.payload_json?.verificationPairId)};
  const stableCore=metrics.skuOverlapPct>=99&&metrics.marketPriceMatchPct>=98&&metrics.directAvailableMatchPct>=95&&metrics.directListingsMatchPct>=95&&metrics.marketplaceListingsMatchPct>=95;
  const priceOk=minutesApart<=5?metrics.directLowMatchPct>=97:metrics.directLowTolerantMatchPct>=97;
  const scoreOk=metrics.scoreMatchPct>=94&&metrics.flagMatchPct>=95;
  return {...metrics,status:stableCore&&priceOk&&scoreOk?"PASS":"WARN"};
}

async function writeResult(job,result){
  const message=result.status==="PASS"?`Cloud/PC parity PASS: ${result.skuOverlapPct}% SKU overlap, ${result.directLowMatchPct}% exact Direct Low (${result.directLowTolerantMatchPct}% tolerant), ${result.scoreMatchPct}% score match.`:result.status==="NO_BASELINE"?"Cloud verification completed, but no matching PC baseline scan exists yet.":`Cloud/PC parity WARN: ${result.skuOverlapPct}% SKU overlap, ${result.directLowMatchPct}% exact Direct Low (${result.directLowTolerantMatchPct}% tolerant), ${result.scoreMatchPct}% score match.`;
  await sb("collector_job_events",{method:"POST",body:[{job_id:job.job_id,user_id:job.user_id,event_type:"parity_check",collector_id:WORKER_ID,progress_json:{stage:"parity",percent:100,detail:message,status:result.status},message,metadata_json:result}],prefer:"return=minimal"});
  const current=job.progress_json||{};await sb(`collector_jobs?job_id=eq.${enc(job.job_id)}`,{method:"PATCH",body:{progress_json:{...current,parity:result,parityStatus:result.status,parityCheckedAt:new Date().toISOString(),detail:message}},prefer:"return=minimal"});console.log(message);
}
async function main(){const job=await pendingVerification();if(!job){console.log("No completed verification job waiting for parity analysis.");return}const cloud=await findCloudScan(job);if(!cloud)throw new Error(`Could not resolve cloud scan for verification job ${job.job_id}`);const pc=await findPcBaseline(job,cloud);if(!pc){await writeResult(job,{status:"NO_BASELINE",cloudScanId:cloud.scan_id,skuOverlapPct:0,directLowMatchPct:0,directLowTolerantMatchPct:0,scoreMatchPct:0});return}await writeResult(job,await compare(job,cloud,pc))}
await main();
