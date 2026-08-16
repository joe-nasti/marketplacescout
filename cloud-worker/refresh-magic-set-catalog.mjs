const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
function slugify(name=''){return String(name).normalize('NFKD').replace(/[’']/g,'').replace(/&/g,' and ').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase()}
async function sb(path,{method='GET',body,prefer}={}){const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(d?.message||`Supabase ${r.status}: ${String(t).slice(0,240)}`);return d}

// Catalog freshness guard: scheduled runs may wake weekly, but the external
// Scryfall catalog is fetched only once every 14 days. Manual workflow_dispatch
// can force a refresh by setting COLLECTISH_FORCE_SET_CATALOG=true.
const force=String(process.env.COLLECTISH_FORCE_SET_CATALOG||'').toLowerCase()==='true';
if(!force){
  const latest=await sb('magic_set_catalog?select=updated_at&order=updated_at.desc&limit=1');
  const last=latest?.[0]?.updated_at?new Date(latest[0].updated_at).getTime():0;
  const ageMs=last?Date.now()-last:Infinity;
  if(ageMs<14*24*60*60*1000){
    console.log(JSON.stringify({skipped:true,reason:'catalog_fresh',lastUpdatedAt:latest?.[0]?.updated_at||null,nextEligibleAt:last?new Date(last+14*24*60*60*1000).toISOString():null},null,2));
    process.exit(0);
  }
}

const scry=await fetch('https://api.scryfall.com/sets',{headers:{Accept:'application/json','User-Agent':'Collectish/0.1 (+https://joe-nasti.github.io/marketplacescout/)'}});
if(!scry.ok)throw new Error(`Scryfall sets ${scry.status}`);
const body=await scry.json();
const existing=await sb('marketplace_scan_profiles?select=set_name,set_slug');
const knownSlug=new Map((existing||[]).map(x=>[String(x.set_name||'').toLowerCase(),x.set_slug]));
const rows=(body.data||[]).filter(s=>!s.digital&&s.tcgplayer_id).map(s=>({
  scryfall_id:s.id,
  code:String(s.code||'').toUpperCase(),
  name:s.name,
  set_type:s.set_type||null,
  released_at:s.released_at||null,
  digital:false,
  tcgplayer_group_id:Number(s.tcgplayer_id),
  tcgplayer_slug:knownSlug.get(String(s.name||'').toLowerCase())||slugify(s.name),
  catalog_source:'scryfall',
  updated_at:new Date().toISOString()
}));
for(let i=0;i<rows.length;i+=200)await sb('magic_set_catalog?on_conflict=scryfall_id',{method:'POST',body:rows.slice(i,i+200),prefer:'resolution=merge-duplicates,return=minimal'});
console.log(JSON.stringify({catalogRows:rows.length,knownSlugs:knownSlug.size},null,2));
