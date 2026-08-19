const URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!URL||!KEY)throw new Error('Missing Supabase credentials');
const H={apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'};
async function rpc(name){const r=await fetch(`${URL}/rest/v1/rpc/${name}`,{method:'POST',headers:H,body:'{}'});const t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(`${name} ${r.status}: ${typeof d==='string'?d:JSON.stringify(d)}`);return d}
async function state(status,detail,started){const row={feed:'scout_rankings',status,last_started_at:started,detail};if(status==='complete'||status==='failed')row.last_completed_at=new Date().toISOString();const r=await fetch(`${URL}/rest/v1/mtgjson_sync_state?on_conflict=feed`,{method:'POST',headers:{...H,Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify([row])});if(!r.ok)throw new Error(`state ${r.status}: ${await r.text()}`)}
const started=new Date().toISOString();
const durations={};
let phase='24h_aggregation';
async function timed(label,fn){const t=Date.now();try{return await fn()}finally{durations[label]=Date.now()-t}}
await state('running',{phase,durations_ms:durations},started);
try{
  const aggregate=await timed('24h_aggregation',()=>rpc('refresh_scout_opportunities_24h'));
  phase='v5_shadow';
  await state('running',{phase,aggregate,durations_ms:durations},started);
  const shadow=await timed('v5_shadow',()=>rpc('refresh_scout_v5_shadow'));
  phase='promoted_cache';
  await state('running',{phase,aggregate,shadow,durations_ms:durations},started);
  const cache=await timed('promoted_cache',()=>rpc('refresh_scout_opportunities_v5_cache'));
  const detail={aggregate,shadow,cache,durations_ms:durations,total_ms:Object.values(durations).reduce((a,b)=>a+b,0),model:'24h -> v5 shadow -> promoted cache'};
  await state('complete',detail,started);
  console.log(JSON.stringify({status:'complete',...detail,at:new Date().toISOString()}));
}catch(e){await state('failed',{failed_phase:phase,error:e.message,durations_ms:durations,total_ms:Object.values(durations).reduce((a,b)=>a+b,0)},started).catch(()=>{});throw e}
