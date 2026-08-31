const cache={at:0,drops:[]};
const base=env=>String(env.SUPABASE_URL||'').replace(/\/$/,'');
const norm=s=>String(s||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim();
function aliases(name){const n=norm(name),out=new Set([n]);for(const p of ['secret lair x marvel ','secret lair x ','secret lair ','featuring ','artist series '])if(n.startsWith(p))out.add(n.slice(p.length).trim());return [...out].filter(x=>x.length>=5).sort((a,b)=>b.length-a.length)}
async function serviceGet(env,path){const r=await fetch(`${base(env)}/rest/v1/${path}`,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`}});if(!r.ok)return[];return r.json().catch(()=>[])}
async function drops(env){if(Date.now()-cache.at<5*60*1000&&cache.drops.length)return cache.drops;const rows=await serviceGet(env,'secret_lair_drops?select=drop_id,drop_name&order=created_at.desc&limit=120');cache.at=Date.now();cache.drops=(rows||[]).map(d=>({...d,aliases:aliases(d.drop_name)}));return cache.drops}
export async function secretLairMediaEmbed(env,...texts){
  if(!env?.SUPABASE_SERVICE_ROLE_KEY||!env?.SUPABASE_URL)return null;const hay=norm(texts.filter(Boolean).join(' '));if(!hay)return null;
  const candidates=[];for(const d of await drops(env)){const hit=d.aliases.find(a=>hay.includes(a));if(hit)candidates.push({d,score:hit.length})}candidates.sort((a,b)=>b.score-a.score);const match=candidates[0]?.d;if(!match)return null;
  const assets=await serviceGet(env,`secret_lair_assets?select=public_url,asset_type,is_primary,sort_order&drop_id=eq.${encodeURIComponent(match.drop_id)}&download_status=eq.downloaded&asset_type=eq.thumbnail&order=is_primary.desc,sort_order.asc&limit=1`);const url=assets?.[0]?.public_url;if(!url)return null;
  return {title:String(match.drop_name).slice(0,256),thumbnail:{url}};
}
