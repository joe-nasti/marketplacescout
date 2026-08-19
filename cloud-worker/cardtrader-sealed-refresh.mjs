const SB_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SB_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const CT_TOKEN=process.env.CARDTRADER_JWT_TOKEN||'';
const CT_BASE='https://api.cardtrader.com/api/v2';
const CATALOG_STALE_HOURS=Math.max(6,Number(process.env.CARDTRADER_CATALOG_STALE_HOURS||24));
const REQUEST_INTERVAL_MS=Math.max(1000,Number(process.env.CARDTRADER_REQUEST_INTERVAL_MS||1050));
const ALLOWED_CATEGORY_NAMES=new Set([
  'Magic Booster Boxes',
  'Magic Extra - Box Sets & Displays',
  'Magic Boxed Set',
  'Magic Preconstructed Decks',
  'Magic Bundles and Fat Packs',
  'Magic Tournament Prerelease Packs'
]);
if(!SB_URL||!SB_KEY||!CT_TOKEN)throw new Error('Missing Supabase or CardTrader credentials');

const SB_HEADERS={apikey:SB_KEY,Authorization:`Bearer ${SB_KEY}`,'Content-Type':'application/json'};
const CT_HEADERS={Authorization:`Bearer ${CT_TOKEN}`,Accept:'application/json'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function sb(path,{method='GET',body,prefer}={}){
  const r=await fetch(`${SB_URL}/rest/v1/${path}`,{method,headers:{...SB_HEADERS,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!r.ok)throw new Error(`Supabase ${r.status} ${path}: ${typeof data==='string'?data:JSON.stringify(data)}`);
  return data;
}
async function ct(path){
  const r=await fetch(`${CT_BASE}${path}`,{headers:CT_HEADERS});
  const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!r.ok){const e=new Error(`CardTrader ${r.status} ${path}: ${typeof data==='string'?data.slice(0,240):JSON.stringify(data).slice(0,240)}`);e.status=r.status;throw e}
  return data;
}
function listOf(v,hints=[]){
  if(Array.isArray(v))return v;
  if(!v||typeof v!=='object')return [];
  for(const k of [...hints,'array','data','items','results'])if(Array.isArray(v[k]))return v[k];
  return [];
}
function arr(v){return Array.isArray(v)?v:[]}
function normId(v){return v==null||v===''?null:String(v)}
function chunks(a,n){const out=[];for(let i=0;i<a.length;i+=n)out.push(a.slice(i,i+n));return out}
function uniqueOne(values){const s=[...new Set(values.filter(Boolean))];return s.length===1?s[0]:null}
function pct(a,b){return b?Math.round(a/b*1000)/10:0}
function weightedAverage(offers,target){
  let need=target,cost=0,taken=0;
  for(const o of [...offers].sort((a,b)=>Number(a.price_cents)-Number(b.price_cents))){
    const q=Math.max(0,Number(o.quantity||0));if(!q)continue;
    const use=Math.min(need,q);cost+=use*Number(o.price_cents);taken+=use;need-=use;if(need<=0)break;
  }
  return need>0||!taken?null:Math.round(cost/taken)/100;
}
async function upsert(table,rows,onConflict,batchSize=200){
  for(const batch of chunks(rows,batchSize))await sb(`${table}?on_conflict=${encodeURIComponent(onConflict)}`,{method:'POST',body:batch,prefer:'resolution=merge-duplicates,return=minimal'});
}
async function syncState(feed,status,detail,rowCount=null){
  const now=new Date().toISOString();const row={feed,status,detail,last_started_at:detail.started_at||now};
  if(rowCount!==null)row.row_count=rowCount;
  if(['complete','complete_with_warnings','paused'].includes(status))row.last_completed_at=now;
  await sb('mtgjson_sync_state?on_conflict=feed',{method:'POST',body:[row],prefer:'resolution=merge-duplicates,return=minimal'});
}
async function isCatalogFresh(){
  const rows=await sb('mtgjson_sync_state?select=last_completed_at,status&feed=eq.cardtrader_catalog&limit=1')||[];
  const t=rows[0]?.last_completed_at?new Date(rows[0].last_completed_at).getTime():0;
  return rows[0]?.status==='complete'&&t>Date.now()-CATALOG_STALE_HOURS*3600e3;
}

const started=new Date().toISOString();
const stats={started_at:started,catalog:{refreshed:false,expansions:0,blueprints:0,mapped:0,conflicts:0,warnings:[]},prices:{sets:0,products:0,mapped:0,expansions:0,observations:0,withOffers:0,withZero:0,nonUsd:0,warnings:[]}};

async function refreshCatalog(){
  const categories=listOf(await ct('/categories?game_id=1'),['categories']).filter(x=>Number(x.game_id)===1);
  const allowedIds=new Set(categories.filter(x=>ALLOWED_CATEGORY_NAMES.has(String(x.name))).map(x=>Number(x.id)));
  if(!allowedIds.size)throw new Error('No configured CardTrader sealed categories found');
  const expansions=listOf(await ct('/expansions'),['expansions']).filter(x=>Number(x.game_id)===1);
  stats.catalog.expansions=expansions.length;
  const blueprints=[];
  for(const exp of expansions){
    try{
      const all=listOf(await ct(`/blueprints/export?expansion_id=${encodeURIComponent(exp.id)}`),['blueprints']);
      for(const b of all)if(allowedIds.has(Number(b.category_id)))blueprints.push({
        blueprint_id:Number(b.id),game_id:Number(b.game_id||1),category_id:Number(b.category_id),expansion_id:b.expansion_id==null?null:Number(b.expansion_id),name:String(b.name||''),version:b.version==null?null:String(b.version),cardmarket_ids:arr(b.card_market_ids).map(String),tcgplayer_product_id:normId(b.tcg_player_id),image_url:b.image_url||null,raw_json:{editable_properties:b.editable_properties||[],fixed_properties:b.fixed_properties||{},category_name:categories.find(c=>Number(c.id)===Number(b.category_id))?.name||null},synced_at:new Date().toISOString()
      });
    }catch(e){stats.catalog.warnings.push({expansion_id:exp.id,error:e.message});}
    await sleep(60);
  }
  const byId=new Map();for(const b of blueprints)byId.set(b.blueprint_id,b);const unique=[...byId.values()];
  stats.catalog.blueprints=unique.length;
  await upsert('cardtrader_blueprints',unique,'blueprint_id');

  const sealed=await sb('mtgjson_sealed_products?select=uuid,cardmarket_id,tcgplayer_product_id&limit=10000')||[];
  const byCmk=new Map(),byTcg=new Map();
  for(const p of sealed){
    const cmk=normId(p.cardmarket_id),tcg=normId(p.tcgplayer_product_id);
    if(cmk){const a=byCmk.get(cmk)||[];a.push(String(p.uuid));byCmk.set(cmk,a)}
    if(tcg){const a=byTcg.get(tcg)||[];a.push(String(p.uuid));byTcg.set(tcg,a)}
  }
  const maps=[];
  for(const b of unique){
    const cmkCandidates=[];for(const id of b.cardmarket_ids)for(const u of(byCmk.get(String(id))||[]))cmkCandidates.push(u);
    const tcgCandidates=b.tcgplayer_product_id?(byTcg.get(String(b.tcgplayer_product_id))||[]):[];
    const cmk=uniqueOne(cmkCandidates),tcg=uniqueOne(tcgCandidates);
    if(cmk&&tcg&&cmk!==tcg){stats.catalog.conflicts++;continue}
    const sealedUuid=cmk||tcg;if(!sealedUuid)continue;
    const method=cmk&&tcg?'dual_exact':cmk?'cardmarket_exact':'tcgplayer_exact';
    maps.push({sealed_uuid:sealedUuid,cardtrader_blueprint_id:b.blueprint_id,cardmarket_id:b.cardmarket_ids.find(id=>(byCmk.get(String(id))||[]).includes(sealedUuid))||null,tcgplayer_product_id:b.tcgplayer_product_id||null,match_method:method,match_confidence:method==='dual_exact'?'a_plus':'a',identity_conflict:false,conflict_detail:{},verified_at:new Date().toISOString()});
  }
  stats.catalog.mapped=maps.length;
  await upsert('cardtrader_sealed_map',maps,'sealed_uuid');
  stats.catalog.refreshed=true;
  await syncState('cardtrader_catalog',stats.catalog.warnings.length?'complete_with_warnings':'complete',{...stats.catalog,started_at:started,allowed_categories:[...ALLOWED_CATEGORY_NAMES]},unique.length);
}

async function refreshPrices(){
  const profiles=await sb('sealed_set_profiles?select=set_code&enabled=eq.true&order=set_code.asc')||[];
  const setCodes=[...new Set(profiles.map(x=>String(x.set_code||'').toUpperCase()).filter(Boolean))];
  stats.prices.sets=setCodes.length;
  const products=[];
  for(const code of setCodes){
    const rows=await sb(`mtgjson_sealed_products?select=uuid,name,set_code&set_code=eq.${encodeURIComponent(code)}&limit=5000`)||[];
    products.push(...rows);
  }
  const productByUuid=new Map(products.map(x=>[String(x.uuid),x]));stats.prices.products=products.length;
  const mappings=[];
  for(const batch of chunks([...productByUuid.keys()],100)){
    if(!batch.length)continue;
    const q=batch.map(x=>`"${x}"`).join(',');
    const rows=await sb(`cardtrader_sealed_map?select=sealed_uuid,cardtrader_blueprint_id,match_method,match_confidence&identity_conflict=eq.false&sealed_uuid=in.(${encodeURIComponent(q)})`)||[];
    mappings.push(...rows);
  }
  stats.prices.mapped=mappings.length;
  if(!mappings.length)return;
  const bpIds=[...new Set(mappings.map(x=>String(x.cardtrader_blueprint_id)))];
  const blueprints=[];
  for(const batch of chunks(bpIds,100)){
    const rows=await sb(`cardtrader_blueprints?select=blueprint_id,expansion_id,category_id,name&blueprint_id=in.(${batch.join(',')})`)||[];
    blueprints.push(...rows);
  }
  const bpById=new Map(blueprints.map(x=>[String(x.blueprint_id),x]));
  const mapByBp=new Map(mappings.map(x=>[String(x.cardtrader_blueprint_id),x]));
  const expansionIds=[...new Set(blueprints.map(x=>x.expansion_id).filter(x=>x!=null).map(String))];stats.prices.expansions=expansionIds.length;
  const observations=[];
  for(const expansionId of expansionIds){
    let grouped={};
    try{const raw=await ct(`/marketplace/products?expansion_id=${encodeURIComponent(expansionId)}`);grouped=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{}}
    catch(e){stats.prices.warnings.push({expansion_id:expansionId,error:e.message});await sleep(REQUEST_INTERVAL_MS);continue}
    for(const [bpId,mapping] of mapByBp){
      const bp=bpById.get(bpId);if(!bp||String(bp.expansion_id)!==String(expansionId))continue;
      const product=productByUuid.get(String(mapping.sealed_uuid));if(!product)continue;
      const rawOffers=Array.isArray(grouped[bpId])?grouped[bpId]:[];
      const english=rawOffers.filter(o=>{const lang=o?.properties_hash?.mtg_language??o?.properties?.mtg_language;return lang==null||lang===''||String(lang).toLowerCase()==='en'});
      const currencies=[...new Set(english.map(o=>o.price_currency).filter(Boolean).map(String))];
      const currency=currencies.length===1?currencies[0]:(currencies.length===0?'USD':null);
      if(currency&&currency!=='USD'){stats.prices.nonUsd++;continue}
      if(!currency){stats.prices.warnings.push({blueprint_id:bpId,error:'mixed_currency_offers'});continue}
      const valid=english.filter(o=>Number.isFinite(Number(o.price_cents))&&Number(o.price_cents)>=0);
      const zero=valid.filter(o=>o?.user?.can_sell_via_hub===true);
      const sorted=[...valid].sort((a,b)=>Number(a.price_cents)-Number(b.price_cents));
      const zeroSorted=[...zero].sort((a,b)=>Number(a.price_cents)-Number(b.price_cents));
      const qty=valid.reduce((s,o)=>s+Math.max(0,Number(o.quantity||0)),0),zeroQty=zero.reduce((s,o)=>s+Math.max(0,Number(o.quantity||0)),0);
      const ctLow=sorted.length?Number(sorted[0].price_cents)/100:null,zeroLow=zeroSorted.length?Number(zeroSorted[0].price_cents)/100:null;
      if(valid.length)stats.prices.withOffers++;if(zero.length)stats.prices.withZero++;
      observations.push({sealed_uuid:mapping.sealed_uuid,source:'cardtrader',product_id:bpId,product_name:product.name||bp.name,market_price:null,low_price:ctLow,low_with_shipping:null,total_listings:valid.length,captured_at:new Date().toISOString(),raw_json:{currency,english_only:true,blueprint_id:Number(bpId),expansion_id:Number(expansionId),category_id:Number(bp.category_id),match_method:mapping.match_method,match_confidence:mapping.match_confidence,ct:{low:ctLow,offers:valid.length,quantity:qty},ct_zero:{low:zeroLow,offers:zero.length,quantity:zeroQty,cost_3_avg:weightedAverage(zeroSorted,3),cost_6_avg:weightedAverage(zeroSorted,6),cost_12_avg:weightedAverage(zeroSorted,12)}}});
    }
    await sleep(REQUEST_INTERVAL_MS);
  }
  stats.prices.observations=observations.length;
  await upsert('sealed_product_price_current',observations,'sealed_uuid,source',100);
  await syncState('cardtrader_sealed_prices',stats.prices.warnings.length?'complete_with_warnings':'complete',{...stats.prices,started_at:started,request_interval_ms:REQUEST_INTERVAL_MS},observations.length);
}

try{
  if(!(await isCatalogFresh()))await refreshCatalog();
  await refreshPrices();
  console.log(JSON.stringify({...stats,finished_at:new Date().toISOString(),mapping_rate_pct:pct(stats.prices.mapped,stats.prices.products)}));
}catch(e){
  await syncState('cardtrader_sealed_prices','failed',{...stats.prices,started_at:started,fatal:e.message}).catch(()=>{});
  throw e;
}
