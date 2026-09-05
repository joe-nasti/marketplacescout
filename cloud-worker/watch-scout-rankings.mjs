import { randomUUID } from 'node:crypto';
const URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const STALE_MINUTES=Math.max(60,Number(process.env.SCOUT_RANKINGS_STALE_MINUTES||105));
const HOLDER=randomUUID();
if(!URL||!KEY)throw new Error('Missing Supabase credentials');
const H={apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const r=await fetch(`${URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(`${path} ${r.status}: ${typeof d==='string'?d:JSON.stringify(d)}`);return d}
async function rpc(name,args={}){return sb(`rpc/${name}`,{method:'POST',body:args})}
async function write(status,detail,started){const row={feed:'scout_rankings_watchdog',status,last_started_at:started,detail};if(['complete','failed','recovered'].includes(status))row.last_completed_at=new Date().toISOString();await sb('mtgjson_sync_state?on_conflict=feed',{method:'POST',body:[row],prefer:'resolution=merge-duplicates,return=minimal'})}
const started=new Date().toISOString();
await write('running',{phase:'check',stale_minutes:STALE_MINUTES},started);
let leaseHeld=false;
try{
  const [stateRows,cacheRows]=await Promise.all([
    sb('mtgjson_sync_state?select=status,last_started_at,last_completed_at,detail&feed=eq.scout_rankings&limit=1'),
    sb('scout_opportunities_v5_cache?select=v5_computed_at&order=v5_computed_at.desc.nullslast&limit=1')
  ]);
  const st=stateRows?.[0]||{};const cacheAt=cacheRows?.[0]?.v5_computed_at||null;
  const ageMinutes=cacheAt?(Date.now()-new Date(cacheAt).getTime())/60000:Infinity;
  const unhealthy=st.status==='failed'||!cacheAt||ageMinutes>STALE_MINUTES;
  if(!unhealthy){await write('complete',{healthy:true,cache_at:cacheAt,cache_age_minutes:Math.round(ageMinutes),rankings_status:st.status},started);console.log(JSON.stringify({healthy:true,cacheAt,ageMinutes}));process.exit(0)}

  leaseHeld=await rpc('claim_scout_rankings_refresh_lease',{p_holder_token:HOLDER,p_source:'watchdog_recovery',p_ttl_seconds:300});
  if(leaseHeld!==true){
    await write('complete',{healthy:false,recovery_deferred:true,reason:'already_running',cache_at:cacheAt,cache_age_minutes:Number.isFinite(ageMinutes)?Math.round(ageMinutes):null,rankings_status:st.status},started);
    console.log(JSON.stringify({healthy:false,recoveryDeferred:true,reason:'already_running',cacheAt,ageMinutes}));
    process.exit(0);
  }

  const durations={};let phase='24h_aggregation';
  async function timed(label,fn){const t=Date.now();try{return await fn()}finally{durations[label]=Date.now()-t}}
  const aggregate=await timed('24h_aggregation',()=>rpc('refresh_scout_opportunities_24h_core'));
  phase='v5_shadow';const shadow=await timed('v5_shadow',()=>rpc('refresh_scout_v5_shadow'));
  phase='promoted_cache';const cache=await timed('promoted_cache',()=>rpc('refresh_scout_opportunities_v5_cache'));
  await write('recovered',{healthy:false,recovery:true,prior_status:st.status,prior_cache_at:cacheAt,prior_cache_age_minutes:Number.isFinite(ageMinutes)?Math.round(ageMinutes):null,aggregate,shadow,cache,durations_ms:durations,total_ms:Object.values(durations).reduce((a,b)=>a+b,0)},started);
  console.log(JSON.stringify({recovered:true,aggregate,shadow,cache,durations}));
}catch(e){await write('failed',{error:e.message},started).catch(()=>{});throw e}
finally{if(leaseHeld)await rpc('release_scout_rankings_refresh_lease',{p_holder_token:HOLDER}).catch(error=>console.warn(`Scout ranking watchdog lease release failed: ${String(error?.message||error)}`))}
