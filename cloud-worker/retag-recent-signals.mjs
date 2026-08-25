// One-shot-safe recent Signals retag worker; reruns are idempotent via mention upserts.
const U=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const K=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const DAYS=Math.max(1,Math.min(Number(process.env.SIGNALS_RETAG_DAYS||14),60));
const LIMIT=Math.max(1,Math.min(Number(process.env.SIGNALS_RETAG_LIMIT||40),100));
if(!U||!K)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'};
async function rest(path){const r=await fetch(`${U}/rest/v1/${path}`,{headers:H});const t=await r.text();let d;try{d=t?JSON.parse(t):[]}catch{d=t}if(!r.ok)throw new Error(d?.message||`REST ${r.status}`);return d}
const since=new Date(Date.now()-DAYS*86400000).toISOString();
const rows=await rest(`market_intel_items?select=intel_id,user_id,source_url,title,observed_at&observed_at=gte.${encodeURIComponent(since)}&order=observed_at.desc&limit=1000`);
const groups=new Map();
for(const x of rows||[]){const url=String(x.source_url||'').trim();if(!url)continue;const key=`${x.user_id}|${url}`;if(!groups.has(key))groups.set(key,{user_id:x.user_id,url,title:x.title||'',ids:[]});groups.get(key).ids.push(x.intel_id)}
let checked=0,tagged=0,resolved=0,nonMagic=0,failed=0;
for(const g of [...groups.values()].slice(0,LIMIT)){
  checked++;
  try{
    const r=await fetch(`${U}/functions/v1/market-intel-card-tag`,{method:'POST',headers:H,body:JSON.stringify({source_url:g.url,rendered_title:g.title,intel_ids:g.ids})});
    const t=await r.text();let d;try{d=t?JSON.parse(t):{}}catch{d={error:t}};
    if(!r.ok)throw new Error(d?.error||`Tagger ${r.status}`);
    tagged+=Number(d?.tagged||0);resolved+=Number(d?.cards?.length||0);if(d?.is_magic===false)nonMagic++;
    console.log(JSON.stringify({source:g.url,cards:Number(d?.cards?.length||0),tagged:Number(d?.tagged||0),is_magic:d?.is_magic!==false}));
  }catch(e){failed++;console.error(JSON.stringify({source:g.url,error:e.message||String(e)}))}
}
console.log(JSON.stringify({ok:failed===0,days:DAYS,groups:groups.size,checked,tagged,resolved,non_magic:nonMagic,failed}));
if(failed)process.exitCode=1;
