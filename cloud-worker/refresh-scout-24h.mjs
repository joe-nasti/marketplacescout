const URL=process.env.SUPABASE_URL, KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!URL||!KEY)throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
const headers={apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'};
async function rpc(name,body={}){
  const r=await fetch(`${URL}/rest/v1/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(body)});
  const text=await r.text();
  if(!r.ok)throw new Error(`${name} failed ${r.status}: ${text}`);
  return text?JSON.parse(text):null;
}
const refreshed=Number(await rpc('refresh_scout_opportunities_24h'));
let after='',v5Shadow=0,batches=0;
for(;;){
  const d=await rpc('refresh_scout_v5_shadow_batch',{p_after_key:after,p_limit:350});
  const count=Number(d?.count||0),last=String(d?.last_key||after);
  v5Shadow+=count;batches++;
  if(!count||last===after)break;
  after=last;
  if(batches>100)throw new Error('Scout v5 batch cursor did not terminate');
}
const v5Deleted=Number(await rpc('finish_scout_v5_shadow_refresh'));
const promotedCache=Number(await rpc('refresh_scout_opportunities_v5_cache'));
console.log(JSON.stringify({refreshed,v5Shadow,v5Batches:batches,v5Deleted,promotedCache,at:new Date().toISOString()}));