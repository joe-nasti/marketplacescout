// Canonical CardTrader public URLs are derived from Blueprint name/version plus expansion metadata.
const SB_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SB_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const CT_TOKEN=process.env.CARDTRADER_JWT_TOKEN||'';
const CT_BASE='https://api.cardtrader.com/api/v2';
if(!SB_URL||!SB_KEY||!CT_TOKEN)throw new Error('Missing Supabase or CardTrader credentials');
const SH={apikey:SB_KEY,Authorization:`Bearer ${SB_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const r=await fetch(`${SB_URL}/rest/v1/${path}`,{method,headers:{...SH,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(`${r.status} ${path}: ${typeof d==='string'?d:JSON.stringify(d)}`);return d}
async function ct(path){const r=await fetch(`${CT_BASE}${path}`,{headers:{Authorization:`Bearer ${CT_TOKEN}`,Accept:'application/json'}});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(`CardTrader ${r.status}: ${String(t).slice(0,220)}`);return d}
async function all(path,page=1000){const out=[];for(let offset=0;;offset+=page){const join=path.includes('?')?'&':'?';const rows=await sb(`${path}${join}limit=${page}&offset=${offset}`)||[];out.push(...rows);if(rows.length<page)break}return out}
function list(v){if(Array.isArray(v))return v;if(v&&typeof v==='object'){for(const k of ['array','data','items','results'])if(Array.isArray(v[k]))return v[k]}return[]}
function slug(s){return String(s||'').normalize('NFKD').replace(/[’']/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase()}
function chunks(a,n){const out=[];for(let i=0;i<a.length;i+=n)out.push(a.slice(i,i+n));return out}
const started=new Date().toISOString();
const expansions=list(await ct('/expansions')).filter(x=>Number(x.game_id)===1),expById=new Map(expansions.map(x=>[Number(x.id),x]));
const blueprints=await all('cardtrader_blueprints?select=blueprint_id,expansion_id,name,version,raw_json');
const rows=blueprints.map(b=>{const exp=expById.get(Number(b.expansion_id)),expansionName=exp?.name||null;const pieces=[b.name,b.version,expansionName].filter(Boolean);const webUrl=pieces.length?`https://www.cardtrader.com/en/cards/${slug(pieces.join(' '))}`:null;return{...b,raw_json:{...(b.raw_json||{}),expansion_name:expansionName,expansion_code:exp?.code||null,web_url:webUrl}}});
for(const batch of chunks(rows,200))await sb('cardtrader_blueprints?on_conflict=blueprint_id',{method:'POST',body:batch,prefer:'resolution=merge-duplicates,return=minimal'});
await sb('mtgjson_sync_state?on_conflict=feed',{method:'POST',body:[{feed:'cardtrader_web_links',status:'complete',last_started_at:started,last_completed_at:new Date().toISOString(),row_count:rows.length,detail:{version:'ct-web-link-v1',expansions:expansions.length,blueprints:rows.length,with_url:rows.filter(x=>x.raw_json.web_url).length}}],prefer:'resolution=merge-duplicates,return=minimal'});
console.log(JSON.stringify({blueprints:rows.length,with_url:rows.filter(x=>x.raw_json.web_url).length,at:new Date().toISOString()}));
