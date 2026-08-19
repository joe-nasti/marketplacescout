import fs from 'node:fs';

const BASE='https://api.cardtrader.com/api/v2';
const token=process.env.CARDTRADER_JWT_TOKEN||'';
if(!token) throw new Error('Missing CARDTRADER_JWT_TOKEN');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const headers={Authorization:`Bearer ${token}`,Accept:'application/json'};
const timings=[];
const shapes={};
function shapeOf(v){if(Array.isArray(v))return{type:'array',length:v.length};if(v&&typeof v==='object')return{type:'object',keys:Object.keys(v).slice(0,30)};return{type:typeof v}}
async function get(path,label){const started=Date.now();const r=await fetch(BASE+path,{headers});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}timings.push({path:path.split('?')[0],status:r.status,ms:Date.now()-started});if(label)shapes[label]=shapeOf(data);if(!r.ok)throw new Error(`${path} -> ${r.status}: ${typeof data==='string'?data.slice(0,180):JSON.stringify(data).slice(0,180)}`);return data}
function listOf(v,hints=[]){if(Array.isArray(v))return v;if(!v||typeof v!=='object')return[];for(const k of ['array',...hints,'data','items','results'])if(Array.isArray(v[k]))return v[k];const vals=Object.values(v);if(vals.length&&vals.every(x=>x&&typeof x==='object'&&!Array.isArray(x)))return vals;return[]}
const pct=(a,b)=>b?Math.round(a/b*1000)/10:0;
function categoryLooksSealed(name){const n=String(name||'').toLowerCase();const positives=['booster box','booster','bundle','fat pack','prerelease','preconstructed','starter deck','boxed set','box set','display','complete set','tin'];const negatives=['single','token','oversized','sleeve','playmat','deck box','album','binder','storage','dice','counter','memorabilia','comic','guide','uncut','empty packaging'];return positives.some(x=>n.includes(x))&&!negatives.some(x=>n.includes(x))}
const present=v=>v!==null&&v!==undefined&&String(v)!=='';

const info=await get('/info','info');
const auth={ok:true,app_id:info?.id??null,app_name:info?.name??null,user_id:info?.user_id??null};
const games=listOf(await get('/games','games'),['games']);
const magic=games.find(g=>Number(g.id)===1||/magic/i.test(g.display_name||g.name||''));
if(!magic)throw new Error('Magic game not found');
const gameId=magic.id;
const categories=listOf(await get(`/categories?game_id=${gameId}`,'categories'),['categories']).filter(c=>Number(c.game_id)===Number(gameId));
const sealedCategories=categories.filter(c=>categoryLooksSealed(c.name));
const sealedCategoryIds=new Set(sealedCategories.map(c=>Number(c.id)));
const expansions=listOf(await get('/expansions','expansions'),['expansions']).filter(e=>Number(e.game_id)===Number(gameId));

const byId=[...expansions].sort((a,b)=>(Number(b.id)||0)-(Number(a.id)||0));
const selected=new Map();byId.slice(0,30).forEach(e=>selected.set(e.id,e));
const sortedAsc=[...expansions].sort((a,b)=>(Number(a.id)||0)-(Number(b.id)||0));
for(let i=0;i<90&&sortedAsc.length;i++){const idx=Math.floor(i*(sortedAsc.length-1)/89);const e=sortedAsc[idx];if(e)selected.set(e.id,e)}
const sampledExpansions=[...selected.values()].slice(0,120);
const sealedBlueprints=[];let rawKeySet=new Set();let bpShape=false;
for(const exp of sampledExpansions){try{const raw=await get(`/blueprints/export?expansion_id=${exp.id}`,bpShape?undefined:'blueprints');bpShape=true;const bps=listOf(raw,['blueprints']);for(const b of bps){if(!sealedCategoryIds.has(Number(b.category_id)))continue;Object.keys(b||{}).forEach(k=>rawKeySet.add(k));sealedBlueprints.push({...b,expansion_name:exp.name,expansion_code:exp.code});}}catch{}await sleep(60)}
const dedup=new Map();for(const b of sealedBlueprints)dedup.set(b.id,b);const bps=[...dedup.values()];

const fieldNames=[...rawKeySet].sort();
const suspiciousFields=fieldNames.filter(k=>/(scry|oracle|uuid|mtgjson|multiverse|tcg|card.?market|identifier)/i.test(k));
const scryFields=fieldNames.filter(k=>/scry/i.test(k));
const oracleFields=fieldNames.filter(k=>/oracle/i.test(k));
const uuidFields=fieldNames.filter(k=>/uuid/i.test(k));
const mtgjsonFields=fieldNames.filter(k=>/mtgjson/i.test(k));
const multiverseFields=fieldNames.filter(k=>/multiverse/i.test(k));
function countAny(fields){return bps.filter(b=>fields.some(k=>present(b[k])&&(Array.isArray(b[k])?b[k].length>0:true))).length}
const withScry=countAny(scryFields),withOracle=countAny(oracleFields),withUuid=countAny(uuidFields),withMtgjson=countAny(mtgjsonFields),withMultiverse=countAny(multiverseFields);
const withTcg=bps.filter(b=>present(b.tcg_player_id)).length;
const withCmk=bps.filter(b=>Array.isArray(b.card_market_ids)&&b.card_market_ids.length>0).length;

const nonNullSamples={};
for(const k of suspiciousFields){const vals=[];for(const b of bps){const v=b[k];if(v===null||v===undefined||v===''||(Array.isArray(v)&&!v.length))continue;vals.push({id:b.id,name:b.name,value:v});if(vals.length>=5)break}nonNullSamples[k]=vals}
const categoryStats=sealedCategories.map(c=>{const xs=bps.filter(b=>Number(b.category_id)===Number(c.id));return{category_id:c.id,category:c.name,count:xs.length,scryfall:countFor(xs,scryFields),oracle:countFor(xs,oracleFields),uuid:countFor(xs,uuidFields),mtgjson:countFor(xs,mtgjsonFields),tcgplayer:xs.filter(b=>present(b.tcg_player_id)).length,cardmarket:xs.filter(b=>Array.isArray(b.card_market_ids)&&b.card_market_ids.length>0).length}});
function countFor(xs,fields){return xs.filter(b=>fields.some(k=>present(b[k])&&(Array.isArray(b[k])?b[k].length>0:true))).length}

const report={generated_at:new Date().toISOString(),auth,response_shapes:shapes,magic_game:{id:gameId,name:magic.display_name||magic.name},sample:{expansions_sampled:sampledExpansions.length,unique_sealed_blueprints:bps.length},raw_blueprint_fields:fieldNames,suspicious_identifier_fields:suspiciousFields,identifier_coverage:{scryfall:{fields:scryFields,count:withScry,pct:pct(withScry,bps.length)},oracle:{fields:oracleFields,count:withOracle,pct:pct(withOracle,bps.length)},uuid:{fields:uuidFields,count:withUuid,pct:pct(withUuid,bps.length)},mtgjson:{fields:mtgjsonFields,count:withMtgjson,pct:pct(withMtgjson,bps.length)},multiverse:{fields:multiverseFields,count:withMultiverse,pct:pct(withMultiverse,bps.length)},tcgplayer:{fields:['tcg_player_id'],count:withTcg,pct:pct(withTcg,bps.length)},cardmarket:{fields:['card_market_ids'],count:withCmk,pct:pct(withCmk,bps.length)}},non_null_identifier_samples:nonNullSamples,category_stats:categoryStats,api_quality:{calls:timings.length,http_status_counts:timings.reduce((m,x)=>(m[x.status]=(m[x.status]||0)+1,m),{})}};
fs.writeFileSync('cardtrader-identifier-audit.json',JSON.stringify(report,null,2));
const lines=['# CardTrader sealed identifier audit','',`- Unique sealed Blueprints sampled: **${bps.length}** across **${sampledExpansions.length}** expansions`,`- Raw Blueprint fields observed: **${fieldNames.join(', ')}**`,`- Identifier-like fields observed: **${suspiciousFields.join(', ')||'none'}**`,`- Scryfall: **${withScry}/${bps.length} (${pct(withScry,bps.length)}%)**; fields: ${scryFields.join(', ')||'none'}`,`- Oracle: **${withOracle}/${bps.length} (${pct(withOracle,bps.length)}%)**; fields: ${oracleFields.join(', ')||'none'}`,`- UUID: **${withUuid}/${bps.length} (${pct(withUuid,bps.length)}%)**; fields: ${uuidFields.join(', ')||'none'}`,`- MTGJSON: **${withMtgjson}/${bps.length} (${pct(withMtgjson,bps.length)}%)**; fields: ${mtgjsonFields.join(', ')||'none'}`,`- Multiverse: **${withMultiverse}/${bps.length} (${pct(withMultiverse,bps.length)}%)**; fields: ${multiverseFields.join(', ')||'none'}`,`- TCGplayer: **${withTcg}/${bps.length} (${pct(withTcg,bps.length)}%)**`,`- Cardmarket: **${withCmk}/${bps.length} (${pct(withCmk,bps.length)}%)**`,'','## By sealed category','', '| Category | N | Scryfall | Oracle | UUID | MTGJSON | TCGplayer | Cardmarket |','|---|---:|---:|---:|---:|---:|---:|---:|',...categoryStats.map(x=>`| ${x.category} | ${x.count} | ${x.scryfall} | ${x.oracle} | ${x.uuid} | ${x.mtgjson} | ${x.tcgplayer} | ${x.cardmarket} |`)];
fs.writeFileSync('cardtrader-identifier-audit.md',lines.join('\n')+'\n');console.log(lines.join('\n'));
