const SB_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SB_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SB_URL||!SB_KEY)throw new Error('Missing Supabase credentials');
const H={apikey:SB_KEY,Authorization:`Bearer ${SB_KEY}`,'Content-Type':'application/json'};

async function sb(path,{method='GET',body,prefer}={}){
  const r=await fetch(`${SB_URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!r.ok)throw new Error(`Supabase ${r.status} ${path}: ${typeof data==='string'?data:JSON.stringify(data)}`);
  return data;
}
async function all(path,pageSize=1000){
  const out=[];
  for(let offset=0;;offset+=pageSize){
    const join=path.includes('?')?'&':'?';
    const rows=await sb(`${path}${join}limit=${pageSize}&offset=${offset}`)||[];
    out.push(...rows);if(rows.length<pageSize)return out;
  }
}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function pctChange(now,prior){const a=num(now),b=num(prior);return a==null||b==null||b===0?null:(a/b-1)*100}
function nearestAtOrBefore(rows,target){
  let best=null;
  for(const row of rows){const t=new Date(row.captured_at).getTime();if(t<=target&&(!best||t>new Date(best.captured_at).getTime()))best=row}
  return best;
}
function snap(row){const raw=row?.raw_json||{},z=raw.ct_zero||{};return{captured_at:row?.captured_at||null,quantity:num(z.quantity),landed6:num(z.landed_6_avg),raw6:num(z.cost_6_avg),low:num(z.low)}}
function compare(current,prior){
  if(!prior)return null;
  return{baseline_at:prior.captured_at,age_hours:Math.round((new Date(current.captured_at)-new Date(prior.captured_at))/36e5*10)/10,quantity_pct:pctChange(current.quantity,prior.quantity),landed6_pct:pctChange(current.landed6,prior.landed6),raw6_pct:pctChange(current.raw6,prior.raw6),low_pct:pctChange(current.low,prior.low)}
}
function classify(cmp){
  if(!cmp)return{signal:'building_history',pressure_score:null,reason:'No snapshot at least four hours old yet'};
  const q=cmp.quantity_pct,l=cmp.landed6_pct;
  let score=0;
  if(q!=null)score+=Math.max(-60,Math.min(60,-q))*0.9;
  if(l!=null)score+=Math.max(-40,Math.min(40,l))*1.25;
  score=Math.max(-100,Math.min(100,Math.round(score)));
  if((q!=null&&q<=-30&&l!=null&&l>=5)||(q!=null&&q<=-50))return{signal:'tightening_strong',pressure_score:score,reason:'Zero supply is falling materially and acquisition cost is firming'};
  if((q!=null&&q<=-15)||(l!=null&&l>=5))return{signal:'tightening',pressure_score:score,reason:'Zero supply or landed acquisition cost is tightening'};
  if((q!=null&&q>=20&&l!=null&&l<=0)||(l!=null&&l<=-5))return{signal:'loosening',pressure_score:score,reason:'Zero supply is expanding or landed acquisition cost is falling'};
  return{signal:'stable',pressure_score:score,reason:'No material CT0 supply/cost pressure detected'};
}

const now=Date.now(),started=new Date().toISOString();
const currentRows=await all('sealed_product_price_current?select=sealed_uuid,captured_at,raw_json&source=eq.cardtrader');
const historyRows=await all('sealed_product_price_history?select=sealed_uuid,captured_at,raw_json&source=eq.cardtrader&order=captured_at.asc');
const grouped=new Map();for(const row of historyRows){const k=String(row.sealed_uuid);const a=grouped.get(k)||[];a.push(row);grouped.set(k,a)}
let updated=0,building=0,tightening=0,strong=0,loosening=0,stable=0;
for(const row of currentRows){
  const key=String(row.sealed_uuid),history=grouped.get(key)||[],current=snap(row);
  const baseline4h=nearestAtOrBefore(history,now-4*3600e3);
  const baseline6h=nearestAtOrBefore(history,now-6*3600e3);
  const baseline24h=nearestAtOrBefore(history,now-24*3600e3);
  const baseline7d=nearestAtOrBefore(history,now-7*24*3600e3);
  const primary=snap(baseline24h||baseline6h||baseline4h);
  const cmpPrimary=(baseline24h||baseline6h||baseline4h)?compare(current,primary):null;
  const cls=classify(cmpPrimary);
  if(cls.signal==='building_history')building++;else if(cls.signal==='tightening_strong')strong++;else if(cls.signal==='tightening')tightening++;else if(cls.signal==='loosening')loosening++;else stable++;
  const trend={version:'ct0_trend_v1',signal:cls.signal,pressure_score:cls.pressure_score,reason:cls.reason,history_samples:history.length,computed_at:new Date().toISOString(),primary_window:baseline24h?'24h':baseline6h?'6h':baseline4h?'4h':null,primary:cmpPrimary,windows:{h6:baseline6h?compare(current,snap(baseline6h)):null,h24:baseline24h?compare(current,snap(baseline24h)):null,d7:baseline7d?compare(current,snap(baseline7d)):null}};
  const raw={...(row.raw_json||{}),ct_zero_trend:trend};
  await sb(`sealed_product_price_current?sealed_uuid=eq.${encodeURIComponent(key)}&source=eq.cardtrader`,{method:'PATCH',body:{raw_json:raw},prefer:'return=minimal'});
  updated++;
}
const detail={version:'ct0_trend_v1',started_at:started,current_rows:currentRows.length,history_rows:historyRows.length,updated,building_history:building,tightening,strong_tightening:strong,loosening,stable,min_baseline_hours:4};
await sb('mtgjson_sync_state?on_conflict=feed',{method:'POST',body:[{feed:'cardtrader_zero_trends',status:'complete',last_started_at:started,last_completed_at:new Date().toISOString(),row_count:updated,detail}],prefer:'resolution=merge-duplicates,return=minimal'});
console.log(JSON.stringify(detail));
