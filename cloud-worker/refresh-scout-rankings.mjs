const URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!URL||!KEY)throw new Error('Missing Supabase credentials');
const H={apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'};
async function rpc(name){const r=await fetch(`${URL}/rest/v1/rpc/${name}`,{method:'POST',headers:H,body:'{}'});const t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(`${name} ${r.status}: ${typeof d==='string'?d:JSON.stringify(d)}`);return d}
async function state(status,detail,started){const row={feed:'scout_rankings',status,last_started_at:started,detail};if(status==='complete'||status==='failed')row.last_completed_at=new Date().toISOString();const r=await fetch(`${URL}/rest/v1/mtgjson_sync_state?on_conflict=feed`,{method:'POST',headers:{...H,Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify([row])});if(!r.ok)throw new Error(`state ${r.status}: ${await r.text()}`)}
const started=new Date().toISOString();
await state('running',{phase:'24h_aggregation'},started);
try{
  const aggregate=await rpc('refresh_scout_opportunities_24h');
  await state('running',{phase:'v5_shadow',aggregate},started);
  const shadow=await rpc('refresh_scout_v5_shadow');
  await state('running',{phase:'promoted_cache',aggregate,shadow},started);
  const cache=await rpc('refresh_scout_opportunities_v5_cache');
  const detail={aggregate,shadow,cache,model:'24h -> v5 shadow -> promoted cache'};
  await state('complete',detail,started);
  console.log(JSON.stringify({status:'complete',...detail,at:new Date().toISOString()}));
}catch(e){await state('failed',{error:e.message},started).catch(()=>{});throw e}
