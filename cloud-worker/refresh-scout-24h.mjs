const URL=process.env.SUPABASE_URL, KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!URL||!KEY)throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
const r=await fetch(`${URL}/rest/v1/rpc/refresh_scout_opportunities_24h`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'},body:'{}'});
const text=await r.text();if(!r.ok)throw new Error(`Refresh failed ${r.status}: ${text}`);
console.log(JSON.stringify({refreshed:Number(JSON.parse(text)),at:new Date().toISOString()}));