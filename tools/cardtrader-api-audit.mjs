import fs from 'node:fs';

const BASE='https://api.cardtrader.com/api/v2';
const token=process.env.CARDTRADER_JWT_TOKEN||'';
if(!token) throw new Error('Missing CARDTRADER_JWT_TOKEN');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const headers={Authorization:`Bearer ${token}`,Accept:'application/json'};
const timings=[];
const shapes={};

function shapeOf(v){
  if(Array.isArray(v)) return {type:'array',length:v.length};
  if(v&&typeof v==='object') return {type:'object',keys:Object.keys(v).slice(0,20)};
  return {type:typeof v};
}
async function get(path,label){
  const started=Date.now();
  const r=await fetch(BASE+path,{headers});
  const text=await r.text();
  let data=null; try{data=text?JSON.parse(text):null}catch{data=text}
  timings.push({path:path.split('?')[0],status:r.status,ms:Date.now()-started});
  if(label) shapes[label]=shapeOf(data);
  if(!r.ok) throw new Error(`${path} -> ${r.status}: ${typeof data==='string'?data.slice(0,180):JSON.stringify(data).slice(0,180)}`);
  return data;
}
function listOf(v,hints=[]){
  if(Array.isArray(v)) return v;
  if(!v||typeof v!=='object') return [];
  for(const k of [...hints,'data','items','results']) if(Array.isArray(v[k])) return v[k];
  const vals=Object.values(v);
  if(vals.length&&vals.every(x=>x&&typeof x==='object'&&!Array.isArray(x))) return vals;
  return [];
}
const pct=(a,b)=>b?Math.round((a/b)*1000)/10:0;
function q(arr,p){if(!arr.length)return null;const s=[...arr].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor((s.length-1)*p))]}
const median=arr=>q(arr,0.5);
function categoryLooksSealed(name){
  const n=String(name||'').toLowerCase();
  const positives=['booster box','booster','bundle','fat pack','prerelease','preconstructed','starter deck','boxed set','box set','display','complete set','tin'];
  const negatives=['single','token','oversized','sleeve','playmat','deck box','album','binder','storage','dice','counter','memorabilia','comic','guide','uncut','empty packaging'];
  return positives.some(x=>n.includes(x))&&!negatives.some(x=>n.includes(x));
}

// /info includes shared_secret; never persist or print the raw response.
const info=await get('/info','info');
const auth={ok:true,app_id:info?.id??info?.app?.id??null,app_name:info?.name??info?.app?.name??null,user_id:info?.user_id??info?.app?.user_id??null};

const gamesRaw=await get('/games','games');
const games=listOf(gamesRaw,['games']);
if(!games.length) throw new Error(`Could not normalize /games response; shape=${JSON.stringify(shapes.games)}`);
const magic=games.find(g=>Number(g.id)===1||/magic/i.test(g.display_name||g.name||''));
if(!magic) throw new Error(`Magic game not found in ${games.length} games`);
const gameId=magic.id;

const categoriesRaw=await get(`/categories?game_id=${gameId}`,'categories');
const categories=listOf(categoriesRaw,['categories']).filter(c=>Number(c.game_id)===Number(gameId));
const sealedCategories=categories.filter(c=>categoryLooksSealed(c.name));
if(!sealedCategories.length) throw new Error(`No sealed categories detected; categories=${categories.map(c=>c.name).join(', ')}`);
const sealedCategoryIds=new Set(sealedCategories.map(c=>Number(c.id)));

const expansionsRaw=await get('/expansions','expansions');
const expansions=listOf(expansionsRaw,['expansions']).filter(e=>Number(e.game_id)===Number(gameId));
if(!expansions.length) throw new Error(`No Magic expansions found; shape=${JSON.stringify(shapes.expansions)}`);

const byId=[...expansions].sort((a,b)=>(Number(b.id)||0)-(Number(a.id)||0));
const selected=new Map();
byId.slice(0,25).forEach(e=>selected.set(e.id,e));
const sortedAsc=[...expansions].sort((a,b)=>(Number(a.id)||0)-(Number(b.id)||0));
for(let i=0;i<65&&sortedAsc.length;i++){
  const idx=Math.floor(i*(sortedAsc.length-1)/64);
  const e=sortedAsc[idx]; if(e) selected.set(e.id,e);
}
const sampledExpansions=[...selected.values()].slice(0,90);

const sealedBlueprints=[];
const expansionStats=[];
let blueprintShapeRecorded=false;
for(const exp of sampledExpansions){
  try{
    const raw=await get(`/blueprints/export?expansion_id=${exp.id}`,blueprintShapeRecorded?undefined:'blueprints');
    blueprintShapeRecorded=true;
    const blueprints=listOf(raw,['blueprints']);
    const sealed=blueprints.filter(b=>sealedCategoryIds.has(Number(b.category_id)));
    if(sealed.length){
      sealedBlueprints.push(...sealed.map(b=>({...b,expansion_name:exp.name,expansion_code:exp.code})));
      expansionStats.push({id:exp.id,name:exp.name,code:exp.code,total_blueprints:blueprints.length,sealed_blueprints:sealed.length});
    }
  }catch(e){ expansionStats.push({id:exp.id,name:exp.name,code:exp.code,error:e.message}); }
  await sleep(80);
}

const byBlueprint=new Map();
for(const b of sealedBlueprints) byBlueprint.set(b.id,b);
const uniqueBlueprints=[...byBlueprint.values()];
const hasTcg=b=>b.tcg_player_id!==null&&b.tcg_player_id!==undefined&&String(b.tcg_player_id)!=='';
const hasCmk=b=>Array.isArray(b.card_market_ids)&&b.card_market_ids.length>0;
const withTcg=uniqueBlueprints.filter(hasTcg).length;
const withCmk=uniqueBlueprints.filter(hasCmk).length;
const withBoth=uniqueBlueprints.filter(b=>hasTcg(b)&&hasCmk(b)).length;
const withNeither=uniqueBlueprints.filter(b=>!hasTcg(b)&&!hasCmk(b)).length;

const marketPool=[...uniqueBlueprints].sort((a,b)=>Number(Boolean(b.tcg_player_id))-Number(Boolean(a.tcg_player_id))||Number(a.id)-Number(b.id));
const marketSample=[];
const n=Math.min(40,marketPool.length);
for(let i=0;i<n;i++){
  const idx=Math.floor(i*(marketPool.length-1)/Math.max(1,n-1));
  if(marketPool[idx]&&!marketSample.some(x=>x.id===marketPool[idx].id)) marketSample.push(marketPool[idx]);
}

const marketplace=[];
let marketShapeRecorded=false;
for(const b of marketSample){
  try{
    const raw=await get(`/marketplace/products?blueprint_id=${b.id}`,marketShapeRecorded?undefined:'marketplace');
    marketShapeRecorded=true;
    const grouped=(raw&&typeof raw==='object'&&!Array.isArray(raw))?raw:{};
    let offers=Array.isArray(grouped[String(b.id)])?grouped[String(b.id)]:[];
    if(!offers.length) offers=listOf(raw,['products','marketplace_products']).filter(o=>Number(o.blueprint_id)===Number(b.id));
    const zero=offers.filter(o=>o?.user?.can_sell_via_hub===true);
    const qty=offers.reduce((s,o)=>s+Number(o.quantity||0),0);
    const zeroQty=zero.reduce((s,o)=>s+Number(o.quantity||0),0);
    const prices=offers.map(o=>Number(o.price_cents)).filter(Number.isFinite).sort((a,b)=>a-b);
    const zeroPrices=zero.map(o=>Number(o.price_cents)).filter(Number.isFinite).sort((a,b)=>a-b);
    marketplace.push({blueprint_id:b.id,name:b.name,expansion:b.expansion_name,tcg_player_id:b.tcg_player_id??null,offers:offers.length,offer_qty:qty,low_cents:prices[0]??null,median_offer_cents:median(prices),zero_offers:zero.length,zero_qty:zeroQty,zero_low_cents:zeroPrices[0]??null,zero_median_offer_cents:median(zeroPrices),zero_share_pct:pct(zero.length,offers.length)});
  }catch(e){ marketplace.push({blueprint_id:b.id,name:b.name,expansion:b.expansion_name,error:e.message}); }
  await sleep(1050);
}

const successfulMarkets=marketplace.filter(x=>!x.error);
const withOffers=successfulMarkets.filter(x=>x.offers>0);
const withZero=successfulMarkets.filter(x=>x.zero_offers>0);
const latencyMs=timings.map(x=>x.ms).filter(Number.isFinite);
const statusCounts=timings.reduce((m,x)=>{m[x.status]=(m[x.status]||0)+1;return m},{});

const report={
  generated_at:new Date().toISOString(),auth,response_shapes:shapes,
  magic_game:{id:gameId,name:magic.display_name||magic.name},
  catalog:{magic_categories:categories.length,sealed_categories:sealedCategories.map(c=>({id:c.id,name:c.name})),magic_expansions:expansions.length,expansions_sampled:sampledExpansions.length,sampled_expansions_with_sealed:expansionStats.filter(x=>x.sealed_blueprints>0).length,unique_sealed_blueprints:uniqueBlueprints.length,tcgplayer_id_count:withTcg,tcgplayer_id_pct:pct(withTcg,uniqueBlueprints.length),cardmarket_id_count:withCmk,cardmarket_id_pct:pct(withCmk,uniqueBlueprints.length),both_external_ids_count:withBoth,neither_external_id_count:withNeither,neither_external_id_pct:pct(withNeither,uniqueBlueprints.length)},
  marketplace:{blueprints_sampled:marketSample.length,successful_calls:successfulMarkets.length,products_with_offers:withOffers.length,products_with_offers_pct:pct(withOffers.length,successfulMarkets.length),products_with_zero:withZero.length,products_with_zero_pct:pct(withZero.length,successfulMarkets.length),median_offer_count:median(withOffers.map(x=>x.offers)),median_offer_qty:median(withOffers.map(x=>x.offer_qty)),median_zero_offer_count:median(withZero.map(x=>x.zero_offers)),median_zero_qty:median(withZero.map(x=>x.zero_qty)),samples:marketplace},
  api_quality:{calls:timings.length,http_status_counts:statusCounts,latency_ms:{p50:q(latencyMs,0.5),p95:q(latencyMs,0.95),max:latencyMs.length?Math.max(...latencyMs):null},marketplace_throttle_ms:1050},
  expansion_stats:expansionStats,
  blueprint_sample:uniqueBlueprints.slice(0,250).map(b=>({id:b.id,name:b.name,category_id:b.category_id,expansion_id:b.expansion_id,expansion_name:b.expansion_name,tcg_player_id:b.tcg_player_id??null,card_market_ids:b.card_market_ids||[]}))
};
fs.writeFileSync('cardtrader-audit.json',JSON.stringify(report,null,2));
const md=['# CardTrader API audit','',`- Auth: **OK** (app ${auth.app_name||auth.app_id||'unknown'})`,`- Response shapes: **${JSON.stringify(shapes)}**`,`- Magic categories: **${categories.length}**; sealed-like categories: **${sealedCategories.length}**`,`- Magic expansions: **${expansions.length}**; sampled: **${sampledExpansions.length}**`,`- Unique sealed blueprints found in sample: **${uniqueBlueprints.length}**`,`- Sealed blueprints with TCGplayer ID: **${withTcg}/${uniqueBlueprints.length} (${pct(withTcg,uniqueBlueprints.length)}%)**`,`- Sealed blueprints with Cardmarket ID: **${withCmk}/${uniqueBlueprints.length} (${pct(withCmk,uniqueBlueprints.length)}%)**`,`- With neither external ID: **${withNeither}/${uniqueBlueprints.length} (${pct(withNeither,uniqueBlueprints.length)}%)**`,`- Marketplace samples with offers: **${withOffers.length}/${successfulMarkets.length} (${pct(withOffers.length,successfulMarkets.length)}%)**`,`- Marketplace samples with CardTrader Zero offers: **${withZero.length}/${successfulMarkets.length} (${pct(withZero.length,successfulMarkets.length)}%)**`,`- Median offer count: **${median(withOffers.map(x=>x.offers))??'n/a'}**`,`- Median Zero offer count: **${median(withZero.map(x=>x.zero_offers))??'n/a'}**`,`- API latency p50/p95: **${q(latencyMs,0.5)??'n/a'} / ${q(latencyMs,0.95)??'n/a'} ms**`,`- HTTP statuses: **${JSON.stringify(statusCounts)}**`,'','## Sealed categories detected','',...sealedCategories.map(c=>`- ${c.id}: ${c.name}`),'','## Marketplace samples','','| Product | Expansion | TCG ID | Offers | Qty | Zero offers | Zero qty | Low cents | Zero low cents |','|---|---|---:|---:|---:|---:|---:|---:|---:|',...marketplace.map(x=>x.error?`| ${String(x.name).replace(/\|/g,'/')} | ${String(x.expansion||'').replace(/\|/g,'/')} |  | ERR |  |  |  |  |  |`:`| ${String(x.name).replace(/\|/g,'/')} | ${String(x.expansion||'').replace(/\|/g,'/')} | ${x.tcg_player_id||''} | ${x.offers} | ${x.offer_qty} | ${x.zero_offers} | ${x.zero_qty} | ${x.low_cents??''} | ${x.zero_low_cents??''} |`)];
fs.writeFileSync('cardtrader-audit.md',md.join('\n')+'\n');
console.log(md.join('\n'));
if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,md.join('\n')+'\n');
