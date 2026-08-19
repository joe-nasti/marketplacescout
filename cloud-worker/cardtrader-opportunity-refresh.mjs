const SB_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SB_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SB_URL||!SB_KEY)throw new Error('Missing Supabase credentials');
const H={apikey:SB_KEY,Authorization:`Bearer ${SB_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const r=await fetch(`${SB_URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(`${r.status} ${path}: ${typeof d==='string'?d:JSON.stringify(d)}`);return d}
async function all(path,page=1000){const out=[];for(let offset=0;;offset+=page){const join=path.includes('?')?'&':'?';const rows=await sb(`${path}${join}limit=${page}&offset=${offset}`)||[];out.push(...rows);if(rows.length<page)break}return out}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function round(v,d=1){const p=10**d;return Math.round(v*p)/p}
function spread(reference,buy){return reference>0&&buy>0?(reference/buy-1)*100:null}
function depthBoost(q){return q>=24?12:q>=12?10:q>=6?6:q>=3?3:0}
function trendBoost(signal){return signal==='strong_tightening'?10:signal==='tightening'?6:signal==='loosening'?-6:0}
function reason({eligible,spreadPct,qty,signal,basis}){if(!basis)return'No modeled landed cost available.';if(qty<3)return`Only ${qty} CT0 units available.`;if(spreadPct==null)return'No comparable TCG sealed reference price.';if(!eligible)return`Landed spread ${round(spreadPct)}% is below the 10% opportunity threshold.`;const trend=signal==='strong_tightening'?' Supply is strongly tightening.':signal==='tightening'?' Supply is tightening.':signal==='loosening'?' Supply is loosening.':'';return `${round(spreadPct)}% landed spread with ${qty} CT0 units.${trend}`}
const started=new Date().toISOString();
const [ctRows,tcgRows]=await Promise.all([
  all('sealed_product_price_current?select=sealed_uuid,raw_json,captured_at&source=eq.cardtrader'),
  all('sealed_product_price_current?select=sealed_uuid,market_price,low_with_shipping,low_price,captured_at&source=eq.tcgplayer_public')
]);
const tcg=new Map(tcgRows.map(r=>[String(r.sealed_uuid),r]));
let updated=0,eligibleCount=0,strong=0,tightening=0,loosening=0,building=0;
for(const row of ctRows){
  const raw=row.raw_json||{},zero=raw.ct_zero||{},trend=raw.ct_zero_trend||{},ref=tcg.get(String(row.sealed_uuid));
  const landedCandidates=[[6,num(zero.landed_6_avg)],[3,num(zero.landed_3_avg)],[1,num(zero.landed_1_avg)]].filter(([,v])=>v!=null);
  const [basis,landed]=landedCandidates[0]||[null,null];
  const referenceType=ref?.market_price!=null?'tcg_market':ref?.low_with_shipping!=null?'tcg_low_with_shipping':ref?.low_price!=null?'tcg_low':null;
  const reference=referenceType==='tcg_market'?num(ref.market_price):referenceType==='tcg_low_with_shipping'?num(ref.low_with_shipping):referenceType==='tcg_low'?num(ref.low_price):null;
  const spreadPct=reference!=null&&landed!=null?spread(reference,landed):null;
  const qty=Math.max(0,Number(zero.quantity||0));
  const signal=trend.signal||'building_history';
  const eligible=spreadPct!=null&&spreadPct>=10&&qty>=3;
  const score=spreadPct==null?null:round(spreadPct+depthBoost(qty)+trendBoost(signal));
  const tier=eligible&&spreadPct>=20&&qty>=6&&signal!=='loosening'?'strong':eligible?'watch':'none';
  raw.ct_zero_opportunity={version:'ct0_opportunity_v1',eligible,tier,reference_type:referenceType,reference_price:reference,landed_basis_units:basis,landed_cost:landed,landed_spread_pct:spreadPct==null?null:round(spreadPct),zero_quantity:qty,trend_signal:signal,trend_pressure_score:num(trend.pressure_score),depth_boost:depthBoost(qty),trend_boost:trendBoost(signal),opportunity_score:score,reason:reason({eligible,spreadPct,qty,signal,basis}),computed_at:new Date().toISOString()};
  await sb(`sealed_product_price_current?sealed_uuid=eq.${encodeURIComponent(row.sealed_uuid)}&source=eq.cardtrader`,{method:'PATCH',body:{raw_json:raw},prefer:'return=minimal'});
  updated++;if(eligible)eligibleCount++;if(tier==='strong')strong++;if(signal==='tightening'||signal==='strong_tightening')tightening++;if(signal==='loosening')loosening++;if(signal==='building_history')building++;
}
await sb('mtgjson_sync_state?on_conflict=feed',{method:'POST',body:[{feed:'cardtrader_zero_opportunities',status:'complete',last_started_at:started,last_completed_at:new Date().toISOString(),row_count:updated,detail:{version:'ct0_opportunity_v1',current_ct_rows:ctRows.length,tcg_rows:tcgRows.length,updated,eligible:eligibleCount,strong,tightening,loosening,building_history:building,eligibility_rule:'landed spread >= 10% and CT0 quantity >= 3'}}],prefer:'resolution=merge-duplicates,return=minimal'});
console.log(JSON.stringify({updated,eligible:eligibleCount,strong,tightening,loosening,building_history:building,at:new Date().toISOString()}));
