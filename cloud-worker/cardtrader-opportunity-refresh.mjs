const SB_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SB_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SB_URL||!SB_KEY)throw new Error('Missing Supabase credentials');
const H={apikey:SB_KEY,Authorization:`Bearer ${SB_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const r=await fetch(`${SB_URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(`${r.status} ${path}: ${typeof d==='string'?d:JSON.stringify(d)}`);return d}
async function all(path,page=1000){const out=[];for(let offset=0;;offset+=page){const join=path.includes('?')?'&':'?';const rows=await sb(`${path}${join}limit=${page}&offset=${offset}`)||[];out.push(...rows);if(rows.length<page)break}return out}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function round(v,d=1){const p=10**d;return Math.round(v*p)/p}
function spread(reference,buy){return reference>0&&buy>0?(reference/buy-1)*100:null}
function depthSignal(q){return q>=24?'deep':q>=12?'healthy':q>=6?'usable':q>=3?'thin':'insufficient'}
function reason({landedComplete,comparisonEligible,comparisonSpread,qty,signal}){if(!landedComplete)return'Comparison only: CT0 landed cost is incomplete until a consolidated basket shipping profile is configured.';if(!comparisonEligible)return'TCG Market is available only as a gross comparison reference; TCG Low or Low with Shipping is required for a CT0 sourcing candidate.';if(qty<3)return`Only ${qty} CT0 units available; insufficient depth for a sourcing candidate.`;if(comparisonSpread==null)return'No TCG public comparison reference is available.';const trend=signal==='strong_tightening'?' Supply is strongly tightening.':signal==='tightening'?' Supply is tightening.':signal==='loosening'?' Supply is loosening.':'';return `${round(comparisonSpread)}% landed basis versus TCG public comparison price.${trend} Executable exit economics are required before an import recommendation.`}
const started=new Date().toISOString();
const [ctRows,tcgRows]=await Promise.all([
  all('sealed_product_price_current?select=sealed_uuid,raw_json,captured_at&source=eq.cardtrader'),
  all('sealed_product_price_current?select=sealed_uuid,market_price,low_with_shipping,low_price,captured_at&source=eq.tcgplayer_public')
]);
const tcg=new Map(tcgRows.map(r=>[String(r.sealed_uuid),r]));
let updated=0,candidates=0,comparisonOnly=0,tightening=0,loosening=0,building=0;
for(const row of ctRows){
  const raw=row.raw_json||{},zero=raw.ct_zero||{},trend=raw.ct_zero_trend||{},model=raw.landed_model||{},ref=tcg.get(String(row.sealed_uuid));
  const landedCandidates=[[6,num(zero.landed_6_avg)],[3,num(zero.landed_3_avg)],[1,num(zero.landed_1_avg)]].filter(([,v])=>v!=null);
  const [basis,landed]=landedCandidates[0]||[null,null];
  const comparisonType=ref?.low_with_shipping!=null?'tcg_low_with_shipping':ref?.low_price!=null?'tcg_low':ref?.market_price!=null?'tcg_market_comparison_only':null;
  const comparisonPrice=comparisonType==='tcg_low_with_shipping'?num(ref.low_with_shipping):comparisonType==='tcg_low'?num(ref.low_price):comparisonType==='tcg_market_comparison_only'?num(ref.market_price):null;
  const comparisonSpread=comparisonPrice!=null&&landed!=null?spread(comparisonPrice,landed):null;
  const comparisonEligible=comparisonType==='tcg_low_with_shipping'||comparisonType==='tcg_low';
  const qty=Math.max(0,Number(zero.quantity||0));
  const signal=trend.signal||'building_history';
  const landedComplete=model.version==='ct0_us_v2'&&model.complete===true&&landed!=null;
  const candidate=landedComplete&&comparisonEligible&&comparisonSpread!=null&&comparisonSpread>=10&&qty>=3;
  raw.ct_zero_sourcing={version:'ct0_sourcing_v2',channel:'cardtrader_zero',candidate,actionable:false,recommendation:candidate?'WATCH IMPORT':'PASS',requires_executable_exit:true,requires_lead_time:true,requires_mapping_confidence:true,landed_model_complete:landedComplete,comparison_only:!candidate,comparison_reference_type:comparisonType,comparison_reference_price:comparisonPrice,landed_basis_units:basis,landed_cost:landed,comparison_spread_pct:comparisonSpread==null?null:round(comparisonSpread),zero_quantity:qty,depth_signal:depthSignal(qty),trend_signal:signal,trend_pressure_score:num(trend.pressure_score),reason:reason({landedComplete,comparisonEligible,comparisonSpread,qty,signal}),computed_at:new Date().toISOString()};
  raw.ct_zero_opportunity={...(raw.ct_zero_opportunity||{}),version:'ct0_opportunity_v1_deprecated',eligible:false,tier:'deprecated',deprecated:true,replaced_by:'ct_zero_sourcing',reason:'Deprecated: raw CT0/TCG public spread is no longer an actionable Scout opportunity. Use ct_zero_sourcing plus executable exit economics.'};
  await sb(`sealed_product_price_current?sealed_uuid=eq.${encodeURIComponent(row.sealed_uuid)}&source=eq.cardtrader`,{method:'PATCH',body:{raw_json:raw},prefer:'return=minimal'});
  updated++;if(candidate)candidates++;if(!landedComplete||!comparisonEligible)comparisonOnly++;if(signal==='tightening'||signal==='strong_tightening')tightening++;if(signal==='loosening')loosening++;if(signal==='building_history')building++;
}
const detail={version:'ct0_sourcing_v2',current_ct_rows:ctRows.length,tcg_rows:tcgRows.length,updated,candidates,comparison_only:comparisonOnly,tightening,loosening,building_history:building,actionability_rule:'never actionable without executable exit, lead time, and mapping confidence',candidate_rule:'complete basket-aware landed model, TCG Low/Low with Shipping reference, >=10% comparison basis, CT0 quantity >=3'};await sb('mtgjson_sync_state?on_conflict=feed',{method:'POST',body:[{feed:'cardtrader_zero_sourcing',status:'complete',last_started_at:started,last_completed_at:new Date().toISOString(),row_count:updated,detail}],prefer:'resolution=merge-duplicates,return=minimal'});console.log(JSON.stringify({...detail,at:new Date().toISOString()}));