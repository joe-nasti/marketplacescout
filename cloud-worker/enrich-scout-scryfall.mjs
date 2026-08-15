const URL=process.env.SUPABASE_URL;
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const LIMIT=Math.max(1,Math.min(50,Number(process.env.COLLECTISH_SCRYFALL_BATCH||40)));
if(!URL||!KEY)throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
const sh={apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'};
const sfh={'User-Agent':'collectish/0.8 (+https://joe-nasti.github.io/marketplacescout/)','Accept':'application/json;q=0.9,*/*;q=0.8'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function sb(path,opt={}){const r=await fetch(`${URL}/rest/v1/${path}`,{...opt,headers:{...sh,...(opt.headers||{})}});const t=await r.text();if(!r.ok)throw new Error(`Supabase ${r.status}: ${t}`);return t?JSON.parse(t):null}
async function patchIds(ids,body){if(!ids.length)return;await sb(`marketplace_scan_rows?id=in.(${ids.join(',')})`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)})}
function cleanNum(v){const s=String(v||'').trim();return s.replace(/^0+(?=\d)/,'')||s}
async function lookup(setCode,number,name){
  const tries=[];
  if(setCode&&number)tries.push(`https://api.scryfall.com/cards/${encodeURIComponent(setCode.toLowerCase())}/${encodeURIComponent(cleanNum(number))}`);
  if(name){const base=String(name).replace(/\s*\([^)]*(foil|showcase|borderless|extended art|serialized|surge)[^)]*\)\s*/ig,' ').replace(/\s+/g,' ').trim();tries.push(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(base)}`)}
  for(const u of tries){const r=await fetch(u,{headers:sfh});if(r.ok)return r.json();if(r.status===429)throw new Error('Scryfall 429 rate limit');if(r.status!==404&&r.status!==400)console.warn('Scryfall lookup',r.status,u);await sleep(125)}
  return null;
}
const rows=await sb(`marketplace_scan_rows?select=id,set_code,collector_number,product_name&commander_enriched_at=is.null&order=id.desc&limit=250`);
const groups=new Map();
for(const r of rows||[]){const key=`${String(r.set_code||'').toLowerCase()}|${r.collector_number||''}|${r.product_name||''}`;if(!groups.has(key))groups.set(key,{set_code:r.set_code,collector_number:r.collector_number,product_name:r.product_name,ids:[]});groups.get(key).ids.push(r.id)}
let attempted=0,matched=0,updated=0;
for(const g of [...groups.values()].slice(0,LIMIT)){
  attempted++;
  let card=null;
  try{card=await lookup(g.set_code,g.collector_number,g.product_name)}catch(e){console.error(e.message);break}
  const stamp=new Date().toISOString();
  if(card?.id){matched++;await patchIds(g.ids,{scryfall_id:card.id,edhrec_rank:Number.isFinite(Number(card.edhrec_rank))?Number(card.edhrec_rank):null,commander_enriched_at:stamp});updated+=g.ids.length}
  else{await patchIds(g.ids,{commander_enriched_at:stamp});updated+=g.ids.length}
  await sleep(150);
}
console.log(JSON.stringify({attempted,matched,rowsUpdated:updated,batchLimit:LIMIT}));