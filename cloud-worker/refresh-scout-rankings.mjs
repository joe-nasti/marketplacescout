import { randomUUID } from 'node:crypto';
const URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const FORCE=/^(1|true|yes)$/i.test(String(process.env.SCOUT_FORCE_FULL||''));
const SOURCE=String(process.env.SCOUT_RANKINGS_SOURCE||'manual_or_other');
const HOLDER=randomUUID();
if(!URL||!KEY)throw new Error('Missing Supabase credentials');
const H={apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'};
async function sb(path,opt={}){const r=await fetch(`${URL}/rest/v1/${path}`,{...opt,headers:{...H,...(opt.headers||{})}});const t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(`Supabase ${r.status}: ${typeof d==='string'?d:JSON.stringify(d)}`);return d}
async function rpc(name,args={}){return sb(`rpc/${name}`,{method:'POST',body:JSON.stringify(args)})}
async function state(status,detail,started,{markCompleted=true}={}){const row={feed:'scout_rankings',status,last_started_at:started,detail};if(markCompleted&&status==='complete')row.last_completed_at=new Date().toISOString();await sb('mtgjson_sync_state?on_conflict=feed',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify([row])})}
async function logRun(row){try{await sb('scout_rankings_run_log',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify([row])})}catch(error){console.warn(`Scout ranking run log failed: ${String(error?.message||error)}`)}}
const iso=value=>{const ms=Date.parse(value||'');return Number.isFinite(ms)?ms:null};
async function newest(path,key){const rows=await sb(path);return rows?.[0]?.[key]||null}
async function refreshDecision(){
  if(FORCE)return {refresh:true,reason:'forced_hourly_reconciliation',watermarks:{}};
  try{
    const [lastCompleted,latestScan,latestCommander,latestEdhrec,latestVendor]=await Promise.all([
      newest('mtgjson_sync_state?select=last_completed_at&feed=eq.scout_rankings&limit=1','last_completed_at'),
      newest('marketplace_scans?select=captured_at&order=captured_at.desc&limit=1','captured_at'),
      newest('marketplace_scan_rows?select=commander_enriched_at&commander_enriched_at=not.is.null&order=commander_enriched_at.desc&limit=1','commander_enriched_at'),
      newest('marketplace_scan_rows?select=edhrec_observed_at&edhrec_observed_at=not.is.null&order=edhrec_observed_at.desc&limit=1','edhrec_observed_at'),
      newest('scout_vendor_price_current_cache?select=refreshed_at&order=refreshed_at.desc&limit=1','refreshed_at')
    ]);
    const lastMs=iso(lastCompleted);
    const watermarks={latest_scan:latestScan,latest_commander:latestCommander,latest_edhrec:latestEdhrec,latest_vendor:latestVendor,last_rankings:lastCompleted};
    if(lastMs==null)return {refresh:true,reason:'missing_previous_completion',watermarks};
    const inputs=[latestScan,latestCommander,latestEdhrec,latestVendor].map(iso);
    if(inputs.some(v=>v==null))return {refresh:true,reason:'missing_input_watermark',watermarks};
    const newestInput=Math.max(...inputs);
    return newestInput>lastMs
      ?{refresh:true,reason:'input_advanced',watermarks,newest_input_at:new Date(newestInput).toISOString()}
      :{refresh:false,reason:'inputs_unchanged',watermarks,newest_input_at:new Date(newestInput).toISOString()};
  }catch(error){
    return {refresh:true,reason:'watermark_check_failed',watermark_error:String(error?.message||error),watermarks:{}};
  }
}
const started=new Date().toISOString();
const durations={};
let phase='watermark_check';
async function timed(label,fn){const t=Date.now();try{return await fn()}finally{durations[label]=Date.now()-t}}
const decision=await timed('watermark_check',refreshDecision);
if(!decision.refresh){
  const totalMs=Object.values(durations).reduce((a,b)=>a+b,0);
  const detail={skipped:true,reason:decision.reason,watermarks:decision.watermarks,newest_input_at:decision.newest_input_at,durations_ms:durations,total_ms:totalMs,model:'watermark gate -> no-op; hourly full reconciliation remains authoritative'};
  await state('complete',detail,started,{markCompleted:false});
  await logRun({started_at:started,source:SOURCE,status:'complete',decision:decision.reason,skipped:true,newest_input_at:decision.newest_input_at||null,watermarks:decision.watermarks||{},durations_ms:durations,total_ms:totalMs});
  console.log(JSON.stringify({status:'complete',...detail,at:new Date().toISOString()}));
  process.exit(0);
}
phase='lease_claim';
const leaseClaimed=await timed('lease_claim',()=>rpc('claim_scout_rankings_refresh_lease',{p_holder_token:HOLDER,p_source:SOURCE,p_ttl_seconds:300}));
if(leaseClaimed!==true){
  const totalMs=Object.values(durations).reduce((a,b)=>a+b,0);
  const detail={skipped:true,reason:'already_running',refresh_reason:decision.reason,watermarks:decision.watermarks,newest_input_at:decision.newest_input_at,durations_ms:durations,total_ms:totalMs,model:'watermark gate -> single-writer lease -> no-op'};
  await logRun({started_at:started,source:SOURCE,status:'complete',decision:'already_running',skipped:true,newest_input_at:decision.newest_input_at||null,watermarks:decision.watermarks||{},durations_ms:durations,total_ms:totalMs});
  console.log(JSON.stringify({status:'complete',...detail,at:new Date().toISOString()}));
  process.exit(0);
}
phase='24h_aggregation';
await state('running',{phase,refresh_reason:decision.reason,watermarks:decision.watermarks,durations_ms:durations},started);
try{
  const aggregate=await timed('24h_aggregation',()=>rpc('refresh_scout_opportunities_24h_core'));
  phase='v5_shadow';
  await state('running',{phase,aggregate,refresh_reason:decision.reason,watermarks:decision.watermarks,durations_ms:durations},started);
  const shadow=await timed('v5_shadow',()=>rpc('refresh_scout_v5_shadow'));
  phase='promoted_cache';
  await state('running',{phase,aggregate,shadow,refresh_reason:decision.reason,watermarks:decision.watermarks,durations_ms:durations},started);
  const cache=await timed('promoted_cache',()=>rpc('refresh_scout_opportunities_v5_cache'));
  const totalMs=Object.values(durations).reduce((a,b)=>a+b,0);
  const detail={aggregate,shadow,cache,refresh_reason:decision.reason,watermarks:decision.watermarks,durations_ms:durations,total_ms:totalMs,model:'watermark gate -> single-writer lease -> 24h core -> v5 shadow -> promoted cache'};
  await state('complete',detail,started);
  await logRun({started_at:started,source:SOURCE,status:'complete',decision:decision.reason,skipped:false,newest_input_at:decision.newest_input_at||null,watermarks:decision.watermarks||{},durations_ms:durations,total_ms:totalMs});
  console.log(JSON.stringify({status:'complete',...detail,at:new Date().toISOString()}));
}catch(e){
  const totalMs=Object.values(durations).reduce((a,b)=>a+b,0);
  await state('failed',{failed_phase:phase,error:e.message,refresh_reason:decision.reason,watermarks:decision.watermarks,durations_ms:durations,total_ms:totalMs},started,{markCompleted:false}).catch(()=>{});
  await logRun({started_at:started,source:SOURCE,status:'failed',decision:decision.reason,skipped:false,newest_input_at:decision.newest_input_at||null,watermarks:decision.watermarks||{},durations_ms:durations,total_ms:totalMs,failed_phase:phase,error:String(e?.message||e)});
  throw e;
}finally{
  await rpc('release_scout_rankings_refresh_lease',{p_holder_token:HOLDER}).catch(error=>console.warn(`Scout ranking lease release failed: ${String(error?.message||error)}`));
}
