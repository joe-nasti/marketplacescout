const url=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!url||!key)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
async function rpc(name,body={}){
  const r=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(body)});
  const text=await r.text();
  if(!r.ok)throw new Error(`${name} failed ${r.status}: ${text}`);
  return text?JSON.parse(text):null;
}
let after=0,total=0,batches=0;
for(;;){
  const out=await rpc('recalculate_scout_base_v4_batch',{p_after_id:after,p_limit:750});
  const count=Number(out?.count||0),last=Number(out?.last_id||after);
  total+=count;batches++;
  if(!count||last<=after)break;
  after=last;
  if(count<750)break;
}
const refreshed=await rpc('refresh_scout_opportunities_24h');
const annotated=await rpc('annotate_scout_sales_confidence');
console.log(JSON.stringify({rescored:total,batches,refreshed,annotated,scoringVersion:'supply-structure-v4'},null,2));
