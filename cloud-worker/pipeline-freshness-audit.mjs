const URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const TCGCSV_STALE_MINUTES=Math.max(1440,Number(process.env.TCGCSV_STALE_MINUTES||1800));
if(!URL||!KEY)throw new Error('Missing Supabase credentials');
const H={apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'};
const started=new Date().toISOString();
async function sb(path,{method='GET',body,prefer}={}){const r=await fetch(`${URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(`${path} ${r.status}: ${typeof d==='string'?d:JSON.stringify(d)}`);return d}
async function write(status,detail){await sb('mtgjson_sync_state?on_conflict=feed',{method:'POST',body:[{feed:'pipeline_freshness_audit',status,last_started_at:started,last_completed_at:new Date().toISOString(),detail}],prefer:'resolution=merge-duplicates,return=minimal'})}
const ageMinutes=t=>t?Math.max(0,(Date.now()-new Date(t).getTime())/60000):Infinity;
try{
  const [priceRows,scoreRows]=await Promise.all([
    sb('tcgcsv_sync_state?select=feed,status,source_updated_at,last_completed_at,detail&feed=eq.tcgplayer_prices&limit=1'),
    sb('scout_opportunities_v5_cache?select=v5_computed_at&order=v5_computed_at.desc.nullslast&limit=1')
  ]);
  const price=priceRows?.[0]||{};
  const priceAt=price.source_updated_at||price.last_completed_at||null;
  const priceAge=ageMinutes(priceAt);
  const scoreAt=scoreRows?.[0]?.v5_computed_at||null;
  const scoreAge=ageMinutes(scoreAt);
  const problems=[];
  if(price.status==='failed')problems.push('tcgcsv_sync_failed');
  if(!priceAt)problems.push('tcgcsv_missing_watermark');
  else if(priceAge>TCGCSV_STALE_MINUTES)problems.push('tcgcsv_source_stale');
  const detail={checked_at:new Date().toISOString(),tcgplayer:{source:'TCGCSV',cadence:'daily',source_updated_at:priceAt,age_minutes:Number.isFinite(priceAge)?Math.round(priceAge):null,stale_after_minutes:TCGCSV_STALE_MINUTES,status:price.status||null},scout_score:{v5_computed_at:scoreAt,age_minutes:Number.isFinite(scoreAge)?Math.round(scoreAge):null,note:'Recovery owned by watch-scout-rankings.mjs in independent alerts workflow.'},problems};
  await write(problems.length?'failed':'complete',detail);
  console.log(JSON.stringify(detail,null,2));
  if(problems.length)throw new Error(`Freshness audit failed: ${problems.join(', ')}`);
}catch(error){await write('failed',{error:String(error?.message||error)}).catch(()=>{});throw error}
