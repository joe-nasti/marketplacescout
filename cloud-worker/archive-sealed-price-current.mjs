const URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!URL||!KEY)throw new Error('Missing Supabase credentials');
const H={apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const r=await fetch(`${URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(`${r.status} ${path}: ${typeof d==='string'?d:JSON.stringify(d)}`);return d}
const rows=await sb('sealed_product_price_current?select=sealed_uuid,source,product_id,product_name,market_price,low_price,low_with_shipping,total_listings,captured_at,raw_json&order=captured_at.desc&limit=10000')||[];
let written=0;
for(let i=0;i<rows.length;i+=500){const batch=rows.slice(i,i+500);await sb('sealed_product_price_history?on_conflict=sealed_uuid,source,captured_at',{method:'POST',body:batch,prefer:'resolution=ignore-duplicates,return=minimal'});written+=batch.length}
const transitions=await sb('rpc/snapshot_sealed_product_lifecycle_states',{method:'POST',body:{}}).catch(error=>{console.warn(`Lifecycle snapshot skipped: ${error.message}`);return null});
console.log(JSON.stringify({observations:rows.length,attempted:written,lifecycleTransitions:transitions,at:new Date().toISOString()}));
