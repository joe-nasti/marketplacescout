// Bounded recent Signals retag worker. Safe to rerun: mention writes are upserts.
const U=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const K=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const DAYS=Math.max(1,Math.min(Number(process.env.SIGNALS_RETAG_DAYS||14),60));
const LIMIT=Math.max(1,Math.min(Number(process.env.SIGNALS_RETAG_LIMIT||40),100));
const CONCURRENCY=Math.max(1,Math.min(Number(process.env.SIGNALS_RETAG_CONCURRENCY||3),5));
if(!U||!K)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const H={apikey:K,Authorization:`Bearer ${K}`,'Content-Type':'application/json'};
async function rest(path){const r=await fetch(`${U}/rest/v1/${path}`,{headers:H});const t=await r.text();let d;try{d=t?JSON.parse(t):[]}catch{d=t}if(!r.ok)throw new Error(d?.message||`REST ${r.status}`);return d}
async function tag(g,attempt=1){const r=await fetch(`${U}/functions/v1/market-intel-card-tag`,{method:'POST',headers:H,body:JSON.stringify({source_url:g.url,rendered_title:g.title,intel_ids:g.ids})});const t=await r.text();let d;try{d=t?JSON.parse(t):{}}catch{d={error:t}};if(!r.ok)throw new Error(d?.error||`Tagger ${r.status}`);return d}
async function tagWithRetry(g){let last;for(let attempt=1;attempt<=2;attempt++){try{return await tag(g,attempt)}catch(e){last=e;if(attempt<2)await new Promise(r=>setTimeout(r,1200))}}throw last}
const since=new Date(Date.now()-DAYS*86400000).toISOString();
const rows=await rest(`market_intel_items?select=intel_id,user_id,source_url,title,observed_at&observed_at=gte.${encodeURIComponent(since)}&order=observed_at.desc&limit=1000`);
const groups=new Map();
for(const x of rows||[]){const url=String(x.source_url||'').trim();if(!url)continue;const key=`${x.user_id}|${url}`;if(!groups.has(key))groups.set(key,{user_id:x.user_id,url,title:x.title||'',ids:[]});groups.get(key).ids.push(x.intel_id)}
const queue=[...groups.values()].slice(0,LIMIT);let cursor=0,checked=0,tagged=0,resolved=0,nonMagic=0,failed=0;const failures=[];
async function worker(){while(true){const ix=cursor++;if(ix>=queue.length)return;const g=queue[ix];checked++;try{const d=await tagWithRetry(g);tagged+=Number(d?.tagged||0);resolved+=Number(d?.cards?.length||0);if(d?.is_magic===false)nonMagic++;console.log(JSON.stringify({source:g.url,cards:Number(d?.cards?.length||0),tagged:Number(d?.tagged||0),is_magic:d?.is_magic!==false,method:d?.method||null}))}catch(e){failed++;failures.push({source:g.url,error:e?.message||String(e)});console.error(JSON.stringify(failures.at(-1)))}}}
await Promise.all(Array.from({length:Math.min(CONCURRENCY,queue.length)},()=>worker()));
const summary={ok:failed===0,days:DAYS,groups:groups.size,checked,tagged,resolved,non_magic:nonMagic,failed,failures};console.log(JSON.stringify(summary));
if(failed>Math.max(2,Math.floor(checked*0.2)))process.exitCode=1;
