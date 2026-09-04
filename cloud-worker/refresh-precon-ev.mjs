const URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const RELEASE_FROM=process.env.PRECON_RELEASE_FROM||'2025-01-01';
if(!URL||!KEY)throw new Error('Missing Supabase credentials');
const H={apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body}={}){
  const r=await fetch(`${URL}/rest/v1/${path}`,{method,headers:H,body:body===undefined?undefined:JSON.stringify(body)});
  const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}
  if(!r.ok)throw new Error(`${r.status} ${path}: ${typeof d==='string'?d:JSON.stringify(d)}`);
  return d;
}
async function rpc(name,body){return sb(`rpc/${name}`,{method:'POST',body})}
const users=(await sb('syp_dashboard_summary?select=user_id'))||[];
const decks=(await sb(`mtgjson_decks?select=deck_key,name,release_date&deck_type=eq.${encodeURIComponent('Commander Deck')}&release_date=gte.${encodeURIComponent(RELEASE_FROM)}&order=release_date.desc,name.asc&limit=500`))||[];
let refreshed=0,qualityRefreshed=0,failed=0;
for(const u of users){
  for(const d of decks){
    try{
      await rpc('refresh_precon_ev_deck',{p_user_id:u.user_id,p_deck_key:d.deck_key});
      refreshed++;
      const q=await rpc('refresh_precon_ev_quality',{p_user_id:u.user_id,p_deck_key:d.deck_key});
      qualityRefreshed++;
      console.log(`precon EV ${refreshed}: ${d.name} score ${q?.score??'pending'} grade ${q?.grade??'—'}`);
    }catch(e){failed++;console.error(`precon EV failed ${d.name}:`,e.message)}
  }
}
await rpc('refresh_sealed_inventory_fit_direct_observations',{});
console.log(JSON.stringify({users:users.length,decks:decks.length,refreshed,qualityRefreshed,failed,releaseFrom:RELEASE_FROM,at:new Date().toISOString()}));
if(failed)process.exitCode=1;
