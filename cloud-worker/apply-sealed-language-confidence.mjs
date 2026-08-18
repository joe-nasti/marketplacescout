const URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!URL||!KEY)throw new Error('Missing Supabase credentials');
const H={apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const r=await fetch(`${URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(`${r.status} ${path}: ${typeof d==='string'?d:JSON.stringify(d)}`);return d}
async function rpc(name,body){return sb(`rpc/${name}`,{method:'POST',body})}
const profiles=await sb('sealed_set_profiles?select=user_id&enabled=eq.true')||[];
const users=[...new Set(profiles.map(x=>x.user_id).filter(Boolean))];
const results=[];
for(const uid of users){results.push({user_id:uid,result:await rpc('apply_sealed_language_confidence',{p_user_id:uid})})}
console.log(JSON.stringify({status:'complete',users:users.length,results,at:new Date().toISOString()},null,2));
