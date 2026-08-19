// CT0 shadow score is observational only; it never writes official Scout score/grade fields.
const SB_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SB_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SB_URL||!SB_KEY)throw new Error('Missing Supabase credentials');
const H={apikey:SB_KEY,Authorization:`Bearer ${SB_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const r=await fetch(`${SB_URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(`${r.status} ${path}: ${typeof d==='string'?d:JSON.stringify(d)}`);return d}
async function all(path,page=1000){const out=[];for(let offset=0;;offset+=page){const join=path.includes('?')?'&':'?';const rows=await sb(`${path}${join}limit=${page}&offset=${offset}`)||[];out.push(...rows);if(rows.length<page)break}return out}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
function grade(score){return score==null?null:score>=85?'A':score>=75?'B':score>=65?'C':score>=50?'D':'F'}
function spreadPoints(spread){return spread>=30?6:spread>=20?5:spread>=15?4:spread>=10?2:0}
function depthPoints(q){return q>=24?2:q>=12?1.5:q>=6?1:q>=3?.5:0}
function trendPoints(signal){return signal==='strong_tightening'?2:signal==='tightening'?1:signal==='loosening'?-1:0}
const started=new Date().toISOString();
const [ctRows,sealedRows]=await Promise.all([
  all('sealed_product_price_current?select=sealed_uuid,raw_json,captured_at&source=eq.cardtrader'),
  all('sealed_ev_current?select=sealed_uuid,scout_sealed_score,scout_sealed_grade,lifecycle_status,score_components')
]);
const sealed=new Map(sealedRows.map(r=>[String(r.sealed_uuid),r]));
let updated=0,eligible=0,gradeChanges=0,totalPositiveDelta=0,building=0,trendReady=0;
for(const row of ctRows){
  const raw=row.raw_json||{},opp=raw.ct_zero_opportunity||{},trend=raw.ct_zero_trend||{},base=sealed.get(String(row.sealed_uuid));
  const official=num(base?.scout_sealed_score),officialGrade=base?.scout_sealed_grade||grade(official);
  const spread=num(opp.landed_spread_pct),qty=Math.max(0,Number(opp.zero_quantity??raw.ct_zero?.quantity??0)),signal=trend.signal||'building_history';
  const isEligible=opp.eligible===true&&official!=null;
  const sPts=isEligible&&spread!=null?spreadPoints(spread):0,dPts=isEligible?depthPoints(qty):0,tPts=isEligible?trendPoints(signal):0;
  const delta=isEligible?clamp(Math.round((sPts+dPts+tPts)*10)/10,-1,10):0;
  const shadow=official==null?null:Math.round(clamp(official+delta,0,100)*10)/10,shadowGrade=grade(shadow);
  const confidence=signal==='building_history'?'provisional':'trend_informed';
  raw.ct_zero_shadow_score={version:'ct0_shadow_v1',official_score:official,official_grade:officialGrade,shadow_delta:delta,shadow_score:shadow,shadow_grade:shadowGrade,eligible:isEligible,landed_spread_pct:spread,zero_quantity:qty,trend_signal:signal,spread_points:sPts,depth_points:dPts,trend_points:tPts,max_positive_delta:10,confidence,official_score_unchanged:true,computed_at:new Date().toISOString()};
  await sb(`sealed_product_price_current?sealed_uuid=eq.${encodeURIComponent(row.sealed_uuid)}&source=eq.cardtrader`,{method:'PATCH',body:{raw_json:raw},prefer:'return=minimal'});
  updated++;if(isEligible)eligible++;if(delta>0)totalPositiveDelta+=delta;if(officialGrade&&shadowGrade&&officialGrade!==shadowGrade)gradeChanges++;if(signal==='building_history')building++;else trendReady++;
}
await sb('mtgjson_sync_state?on_conflict=feed',{method:'POST',body:[{feed:'cardtrader_zero_shadow_score',status:'complete',last_started_at:started,last_completed_at:new Date().toISOString(),row_count:updated,detail:{version:'ct0_shadow_v1',updated,eligible,grade_changes:gradeChanges,avg_positive_delta:eligible?Math.round(totalPositiveDelta/eligible*10)/10:0,building_history:building,trend_ready:trendReady,max_positive_delta:10,official_score_unchanged:true}}],prefer:'resolution=merge-duplicates,return=minimal'});
console.log(JSON.stringify({updated,eligible,grade_changes:gradeChanges,avg_positive_delta:eligible?Math.round(totalPositiveDelta/eligible*10)/10:0,building_history:building,trend_ready:trendReady,at:new Date().toISOString()}));
