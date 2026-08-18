const URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const GATEWAY='https://mpgateway.tcgplayer.com';
const LIMIT=Math.max(25,Math.min(500,Number(process.env.SCOUT_VOLATILITY_LIMIT||300)));
const MIN_SCORE=Math.max(0,Math.min(100,Number(process.env.SCOUT_VOLATILITY_MIN_SCORE||55)));
const STALE_HOURS=Math.max(1,Number(process.env.SCOUT_VOLATILITY_STALE_HOURS||24));
const CONCURRENCY=Math.max(1,Math.min(6,Number(process.env.SCOUT_VOLATILITY_CONCURRENCY||3)));
const MAX_ERRORS=Math.max(2,Number(process.env.SCOUT_VOLATILITY_BREAKER_ERRORS||5));
if(!URL||!KEY)throw new Error('Missing Supabase credentials');
const H={apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function sb(path,{method='GET',body,prefer}={}){const r=await fetch(`${URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(`${r.status} ${path}: ${typeof d==='string'?d:JSON.stringify(d)}`);return d}
function level(v){const s=String(v||'').trim().toUpperCase();return s==='MED'?'MEDIUM':s}
async function fetchVolatility(sku){const r=await fetch(`${GATEWAY}/v1/pricepoints/marketprice/skus/${encodeURIComponent(sku)}/volatility`,{headers:{Accept:'application/json','User-Agent':'Collectish-Scout-Volatility/1.0'}});const t=await r.text();if(!r.ok){const e=new Error(`TCG volatility ${r.status}: ${t.slice(0,180)}`);e.httpStatus=r.status;throw e}return t?JSON.parse(t):{}}
const started=new Date().toISOString();
const stats={candidates:0,fresh:0,fetched:0,low:0,medium:0,high:0,unknown:0,failures:[],breaker:null};
try{
  const candidates=await sb(`scout_opportunities_v5?select=user_id,sku_id,product_id,promoted_score,product_name&promoted_score=gte.${MIN_SCORE}&order=promoted_score.desc,observation_count.desc&limit=${LIMIT}`)||[];
  stats.candidates=candidates.length;
  const cutoff=new Date(Date.now()-STALE_HOURS*3600e3).toISOString();
  const users=[...new Set(candidates.map(x=>x.user_id).filter(Boolean))];
  const existing=[];
  for(const uid of users){existing.push(...((await sb(`scout_sku_volatility?select=user_id,sku_id,fetched_at&user_id=eq.${encodeURIComponent(uid)}&fetched_at=gte.${encodeURIComponent(cutoff)}&limit=1000`))||[]))}
  const fresh=new Set(existing.map(x=>`${x.user_id}|${x.sku_id}`));
  const todo=candidates.filter(x=>!fresh.has(`${x.user_id}|${x.sku_id}`));stats.fresh=candidates.length-todo.length;
  let cursor=0,consecutive=0,open=false;
  async function one(){while(true){if(open)return;const i=cursor++;if(i>=todo.length)return;const c=todo[i];try{const d=await fetchVolatility(c.sku_id),v=level(d.volatility);const row={user_id:c.user_id,sku_id:String(c.sku_id),product_id:c.product_id?String(c.product_id):null,volatility:v||null,z_score:d.zScore==null?null:Number(d.zScore),observed_at:new Date().toISOString(),fetched_at:new Date().toISOString(),raw_json:d};await sb('scout_sku_volatility?on_conflict=user_id,sku_id',{method:'POST',body:[row],prefer:'resolution=merge-duplicates,return=minimal'});stats.fetched++;if(v==='LOW')stats.low++;else if(v==='MEDIUM')stats.medium++;else if(v==='HIGH')stats.high++;else stats.unknown++;consecutive=0;await sleep(120)}catch(e){consecutive++;stats.failures.push({sku_id:c.sku_id,product_name:c.product_name,error:e.message});if(consecutive>=MAX_ERRORS){open=true;stats.breaker={reason:'consecutive_tcg_volatility_errors',threshold:MAX_ERRORS,opened_at:new Date().toISOString(),last_error:e.message};return}await sleep(400*Math.min(consecutive,4))}}}
  await Promise.all(Array.from({length:CONCURRENCY},()=>one()));
  const status=stats.breaker?'paused':stats.failures.length?'complete_with_warnings':'complete';
  await sb('mtgjson_sync_state?on_conflict=feed',{method:'POST',body:[{feed:'scout_volatility',last_started_at:started,last_completed_at:new Date().toISOString(),status,row_count:stats.fetched,detail:{...stats,minScore:MIN_SCORE,limit:LIMIT,staleHours:STALE_HOURS,scoringOverlay:{LOW:0,MEDIUM:0,HIGH:-3,UNKNOWN:0}}}],prefer:'resolution=merge-duplicates,return=minimal'});
  console.log(JSON.stringify({...stats,status,at:new Date().toISOString()}));if(stats.breaker)process.exitCode=1;
}catch(e){await sb('mtgjson_sync_state?on_conflict=feed',{method:'POST',body:[{feed:'scout_volatility',last_started_at:started,last_completed_at:new Date().toISOString(),status:'failed',detail:{fatal:e.message,...stats}}],prefer:'resolution=merge-duplicates,return=minimal'}).catch(()=>{});throw e}
