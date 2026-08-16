const url=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!url||!key)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
async function rpc(name){
  const r=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers,body:'{}'});
  const text=await r.text();
  if(!r.ok)throw new Error(`${name} failed ${r.status}: ${text}`);
  return text?JSON.parse(text):null;
}
const rescored=await rpc('recalculate_scout_base_v3');
const refreshed=await rpc('refresh_scout_opportunities_24h');
console.log(JSON.stringify({rescored,refreshed,scoringVersion:'supply-structure-v3'},null,2));
