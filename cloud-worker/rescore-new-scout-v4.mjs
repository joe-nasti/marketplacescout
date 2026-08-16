const URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!URL||!KEY)throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
const headers={apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'};
async function rest(path){const r=await fetch(`${URL}/rest/v1/${path}`,{headers});const t=await r.text();if(!r.ok)throw new Error(`REST ${r.status}: ${t}`);return t?JSON.parse(t):null}
async function rpc(name,body={}){const r=await fetch(`${URL}/rest/v1/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(body)});const t=await r.text();if(!r.ok)throw new Error(`${name} ${r.status}: ${t}`);return t?JSON.parse(t):null}
const mode=process.argv[2]||'rescore';
if(mode==='capture'){
  const rows=await rest('marketplace_scan_rows?select=id&order=id.desc&limit=1');
  const id=Number(rows?.[0]?.id||0);
  const line=`SCOUT_V4_AFTER_ID=${id}`;
  if(process.env.GITHUB_ENV){const fs=await import('node:fs');fs.appendFileSync(process.env.GITHUB_ENV,`${line}\n`)}
  console.log(JSON.stringify({mode:'capture',afterId:id}));
}else if(mode==='rescore'){
  let after=Number(process.env.SCOUT_V4_AFTER_ID||0),total=0,batches=0;
  for(;;){
    const out=await rpc('recalculate_scout_base_v4_batch',{p_after_id:after,p_limit:750});
    const count=Number(out?.count||0),last=Number(out?.last_id||after);
    total+=count;batches++;
    if(!count||last<=after)break;
    after=last;
    if(count<750)break;
    if(batches>100)throw new Error('v4 rescore cursor did not terminate');
  }
  console.log(JSON.stringify({mode:'rescore',rescored:total,batches,lastId:after,scoringVersion:'supply-structure-v4'}));
}else throw new Error(`Unknown mode: ${mode}`);