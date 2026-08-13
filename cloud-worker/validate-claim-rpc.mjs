const U=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const K=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!U||!K)throw new Error('Missing Supabase worker configuration');
const r=await fetch(`${U}/rest/v1/rpc/claim_collector_job`,{method:'POST',headers:{apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'},body:JSON.stringify({p_source:'collectish_rpc_probe',p_action:'noop',p_preferred_executors:['cloud_worker'],p_required_capability:'marketplace_public_api',p_collector_id:'00000000-0000-4000-8000-000000000001',p_lease_seconds:300})});
const t=await r.text();
if(!r.ok)throw new Error(`claim_collector_job probe failed: HTTP ${r.status}: ${t.slice(0,400)}`);
const d=t?JSON.parse(t):[];
if(!Array.isArray(d)||d.length)throw new Error('claim_collector_job probe unexpectedly matched a job');
console.log('Atomic claim RPC probe passed.');
