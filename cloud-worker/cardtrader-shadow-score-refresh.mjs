// CT0 sourcing economics are route evidence, not intrinsic Scout asset quality.
// This compatibility worker explicitly retires the old shadow-score boost while
// leaving a durable marker for clients that still inspect ct_zero_shadow_score.
const SB_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SB_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SB_URL||!SB_KEY)throw new Error('Missing Supabase credentials');
const H={apikey:SB_KEY,Authorization:`Bearer ${SB_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const r=await fetch(`${SB_URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(`${r.status} ${path}: ${typeof d==='string'?d:JSON.stringify(d)}`);return d}
async function all(path,page=1000){const out=[];for(let offset=0;;offset+=page){const join=path.includes('?')?'&':'?';const rows=await sb(`${path}${join}limit=${page}&offset=${offset}`)||[];out.push(...rows);if(rows.length<page)break}return out}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function grade(score){return score==null?null:score>=85?'A':score>=75?'B':score>=65?'C':score>=50?'D':'F'}
const started=new Date().toISOString();
const [ctRows,sealedRows]=await Promise.all([
  all('sealed_product_price_current?select=sealed_uuid,raw_json,captured_at&source=eq.cardtrader'),
  all('sealed_ev_current?select=sealed_uuid,scout_sealed_score,scout_sealed_grade,lifecycle_status,score_components')
]);
const sealed=new Map(sealedRows.map(r=>[String(r.sealed_uuid),r]));
let updated=0;
for(const row of ctRows){
  const raw=row.raw_json||{},base=sealed.get(String(row.sealed_uuid)),official=num(base?.scout_sealed_score),officialGrade=base?.scout_sealed_grade||grade(official),sourcing=raw.ct_zero_sourcing||{};
  raw.ct_zero_shadow_score={version:'ct0_shadow_v2_retired',retired:true,official_score:official,official_grade:officialGrade,shadow_delta:0,shadow_score:official,shadow_grade:officialGrade,eligible:false,sourcing_candidate:sourcing.candidate===true,official_score_unchanged:true,reason:'CardTrader sourcing economics no longer modify intrinsic Scout score. Evaluate CT/CT0 through Scout Sourcing acquisition→exit paths.',computed_at:new Date().toISOString()};
  await sb(`sealed_product_price_current?sealed_uuid=eq.${encodeURIComponent(row.sealed_uuid)}&source=eq.cardtrader`,{method:'PATCH',body:{raw_json:raw},prefer:'return=minimal'});updated++;
}
const detail={version:'ct0_shadow_v2_retired',updated,retired:true,shadow_delta:0,official_score_unchanged:true,replacement:'ct_zero_sourcing'};
await sb('mtgjson_sync_state?on_conflict=feed',{method:'POST',body:[{feed:'cardtrader_zero_shadow_score',status:'complete',last_started_at:started,last_completed_at:new Date().toISOString(),row_count:updated,detail}],prefer:'resolution=merge-duplicates,return=minimal'});
console.log(JSON.stringify({...detail,at:new Date().toISOString()}));
