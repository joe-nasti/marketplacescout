const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function sb(path,{method='GET',body,prefer}={}){const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(d?.message||`Supabase ${r.status}: ${String(t).slice(0,240)}`);return d}
async function fetchTcgSet(groupId){
  let last=null;
  for(let attempt=0;attempt<4;attempt++){
    try{
      const r=await fetch(`https://mpapi.tcgplayer.com/v2/Catalog/SetName/${encodeURIComponent(groupId)}`,{headers:{Accept:'application/json','User-Agent':'Collectish/0.1'}});
      const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{}
      if(!r.ok)throw new Error(`TCG set ${groupId} ${r.status}: ${String(t).slice(0,160)}`);
      const x=d?.results?.[0];
      if(!x?.urlName)throw new Error(`TCG set ${groupId} missing urlName`);
      return {id:Number(x.setNameId||groupId),urlName:String(x.urlName),name:String(x.name||''),abbreviation:String(x.abbreviation||'')};
    }catch(e){last=e;if(attempt<3)await sleep(500*(2**attempt));}
  }
  throw last||new Error(`TCG set ${groupId} lookup failed`);
}
async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let next=0;
  async function worker(){while(true){const i=next++;if(i>=items.length)return;out[i]=await fn(items[i],i)}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));return out;
}

// Catalog refresh is bi-weekly. The authoritative TCG set-id -> urlName translation
// is refreshed only here and cached in magic_set_catalog.tcgplayer_slug.
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
const physical=(body.data||[]).filter(s=>!s.digital&&s.tcgplayer_id);
const ids=[...new Set(physical.map(s=>Number(s.tcgplayer_id)).filter(Number.isFinite))];
const tcgRows=await mapLimit(ids,8,async id=>{try{return await fetchTcgSet(id)}catch(e){console.warn(e.message||e);return null}});
const tcgById=new Map(tcgRows.filter(Boolean).map(x=>[x.id,x]));
const nowIso=new Date().toISOString();
const rows=physical.map(s=>{
  const gid=Number(s.tcgplayer_id),tcg=tcgById.get(gid);
  return {
    scryfall_id:s.id,
    code:String(s.code||'').toUpperCase(),
    name:s.name,
    set_type:s.set_type||null,
    released_at:s.released_at||null,
    digital:false,
    tcgplayer_group_id:gid,
    tcgplayer_slug:tcg?.urlName||null,
    catalog_source:'scryfall+tcgplayer',
    updated_at:nowIso
  };
});
for(let i=0;i<rows.length;i+=200)await sb('magic_set_catalog?on_conflict=scryfall_id',{method:'POST',body:rows.slice(i,i+200),prefer:'resolution=merge-duplicates,return=minimal'});
console.log(JSON.stringify({catalogRows:rows.length,uniqueTcgSetIds:ids.length,canonicalTcgSlugs:tcgById.size,missingCanonicalSlug:rows.filter(x=>!x.tcgplayer_slug).length,refreshPolicy:'biweekly'},null,2));
