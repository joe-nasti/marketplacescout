const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body}={}){const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:H,body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(d?.message||`Supabase ${r.status}: ${String(t).slice(0,260)}`);return d}
// Keep the hot-path admission query inside the hosted database statement
// budget. Older candidates are recovered by the cold universe backfill.
const result=await sb('rpc/enqueue_signal_scout_wakes',{method:'POST',body:{p_hours:24}});
console.log(JSON.stringify({ok:true,result},null,2));
