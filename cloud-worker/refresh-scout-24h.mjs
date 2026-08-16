const URL=process.env.SUPABASE_URL, KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!URL||!KEY)throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
const headers={apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'};
async function rpc(name){
  const r=await fetch(`${URL}/rest/v1/rpc/${name}`,{method:'POST',headers,body:'{}'});
  const text=await r.text();
  if(!r.ok)throw new Error(`${name} failed ${r.status}: ${text}`);
  return Number(JSON.parse(text));
}
const refreshed=await rpc('refresh_scout_opportunities_24h');
const v5Shadow=await rpc('refresh_scout_v5_shadow');
console.log(JSON.stringify({refreshed,v5Shadow,at:new Date().toISOString()}));