// Collectish MTGJSON importer
// Shared commerce identity graph + daily normalized vendor prices.
// Uses MTGJSON public v5 downloadable files and Supabase service-role REST.
import { gunzipSync } from 'node:zlib';

const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const BASE=(process.env.MTGJSON_BASE_URL||'https://mtgjson.com/api/v5').replace(/\/$/,'');
const MODE=String(process.env.MTGJSON_MODE||process.argv[2]||'prices').toLowerCase();
const BATCH=Math.max(25,Math.min(500,Number(process.env.MTGJSON_BATCH_SIZE||200)));
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
const now=()=>new Date().toISOString();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function sb(path,{method='GET',body,prefer}={}){
  const headers={...H,...(prefer?{Prefer:prefer}:{})};
  let last;
  for(let attempt=0;attempt<5;attempt++){
    const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
    if(r.ok)return data;
    last=new Error(data?.message||data?.hint||`Supabase HTTP ${r.status}: ${String(text).slice(0,300)}`);
    if(![429,500,502,503,504].includes(r.status))throw last;
    await sleep(500*(2**attempt));
  }
  throw last;
}

async function downloadJsonGz(file){
  const url=`${BASE}/${file}.json.gz`;
  console.log(`Downloading ${url}`);
  const r=await fetch(url,{headers:{Accept:'application/gzip,application/octet-stream'}});
  if(!r.ok)throw new Error(`MTGJSON ${file}: HTTP ${r.status}`);
  const compressed=Buffer.from(await r.arrayBuffer());
  console.log(`${file}: ${(compressed.length/1024/1024).toFixed(1)} MiB compressed`);
  const raw=gunzipSync(compressed);
  console.log(`${file}: ${(raw.length/1024/1024).toFixed(1)} MiB decompressed`);
  return JSON.parse(raw.toString('utf8'));
}

async function batches(table,rows,onConflict){
  if(!rows.length)return 0;
  let n=0;
  for(let i=0;i<rows.length;i+=BATCH){
    const part=rows.slice(i,i+BATCH);
    await sb(`${table}${onConflict?`?on_conflict=${encodeURIComponent(onConflict)}`:''}`,{
      method:'POST',body:part,prefer:'resolution=merge-duplicates,return=minimal'
    });
    n+=part.length;
    if((i/BATCH)%25===0)console.log(`${table}: ${n}/${rows.length}`);
  }
  return n;
}

async function syncState(feed,patch){
  await sb(`mtgjson_sync_state?on_conflict=feed`,{method:'POST',body:[{feed,...patch}],prefer:'resolution=merge-duplicates,return=minimal'});
}

const uuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v||''))?String(v):null;
const arr=v=>Array.isArray(v)?v:[];
const txt=v=>v==null?null:String(v);
const int=v=>Number.isFinite(Number(v))?Number(v):null;
const date=v=>/^\d{4}-\d{2}-\d{2}/.test(String(v||''))?String(v).slice(0,10):null;

function cardRow(id,c){
  const u=uuid(id||c?.uuid);if(!u)return null;
  const x=c?.identifiers||{};
  return {
    uuid:u,
    name:String(c?.name||'').trim()||'(unknown)',
    set_code:String(c?.setCode||c?.setCodeV5||'').trim(),
    collector_number:txt(c?.number),
    language:txt(c?.language),
    rarity:txt(c?.rarity),
    release_date:date(c?.releaseDate||c?.originalReleaseDate),
    finishes:arr(c?.finishes),
    availability:arr(c?.availability),
    scryfall_id:uuid(x.scryfallId),
    scryfall_oracle_id:uuid(x.scryfallOracleId),
    tcgplayer_product_id:txt(x.tcgplayerProductId),
    tcgplayer_etched_product_id:txt(x.tcgplayerEtchedProductId),
    tcgplayer_alt_foil_product_id:txt(x.tcgplayerAlternativeFoilProductId),
    cardkingdom_id:txt(x.cardKingdomId),
    cardkingdom_foil_id:txt(x.cardKingdomFoilId),
    cardkingdom_etched_id:txt(x.cardKingdomEtchedId),
    csi_id:txt(x.csiId),
    cardmarket_id:txt(x.mcmId),
    cardmarket_meta_id:txt(x.mcmMetaId),
    scg_id:txt(x.scgId),
    identifiers:x,
    source_updated_at:now()
  };
}

async function syncIdentity(){
  const started=now();
  await syncState('identity',{last_started_at:started,status:'running',detail:{mode:'identity'}});
  const ids=await downloadJsonGz('AllIdentifiers');
  const data=ids?.data||{};
  const cards=[];
  for(const [id,c] of Object.entries(data)){
    const row=cardRow(id,c);if(row)cards.push(row);
  }
  console.log(`Normalized ${cards.length} MTGJSON cards/tokens.`);
  await batches('mtgjson_cards',cards,'uuid');

  const skuDoc=await downloadJsonGz('TcgplayerSkus');
  const skuRows=[];
  for(const [id,list] of Object.entries(skuDoc?.data||{})){
    const u=uuid(id);if(!u)continue;
    for(const s of arr(list)){
      if(!s?.skuId||!s?.productId)continue;
      skuRows.push({
        sku_id:String(s.skuId),uuid:u,product_id:String(s.productId),
        condition:String(s.condition||''),finish:txt(s.finish),language:String(s.language||''),printing:txt(s.printing),source_updated_at:now()
      });
    }
  }
  console.log(`Normalized ${skuRows.length} exact TCGplayer SKU mappings.`);
  await batches('mtgjson_tcgplayer_skus',skuRows,'sku_id');
  await syncState('identity',{last_started_at:started,last_completed_at:now(),source_version:txt(ids?.meta?.version),source_date:ids?.meta?.date||null,row_count:cards.length,status:'complete',detail:{cards:cards.length,tcgplayerSkus:skuRows.length}});
  return {cards:cards.length,tcgplayerSkus:skuRows.length};
}

function latestPoint(map){
  const entries=Object.entries(map||{}).filter(([d,v])=>/^\d{4}-\d{2}-\d{2}/.test(d)&&Number.isFinite(Number(v)));
  entries.sort((a,b)=>a[0].localeCompare(b[0]));
  return entries.at(-1)||null;
}
function priceRowsFor(uuidValue,formats){
  const rows=[];const paper=formats?.paper||{};
  for(const [provider,list] of Object.entries(paper)){
    if(!list||typeof list!=='object')continue;
    const currency=String(list.currency||'USD');
    for(const type of ['retail','buylist']){
      const points=list[type];if(!points)continue;
      for(const finish of ['normal','foil','etched']){
        const p=latestPoint(points[finish]);if(!p)continue;
        rows.push({uuid:uuidValue,provider:String(provider).toLowerCase(),price_type:type,finish,currency,price:Number(p[1]),observed_on:p[0].slice(0,10),source_updated_at:now()});
      }
    }
  }
  return rows;
}

async function syncPrices(){
  const started=now();
  await syncState('prices_today',{last_started_at:started,status:'running',detail:{mode:'prices'}});
  const doc=await downloadJsonGz('AllPricesToday');
  const rows=[];
  for(const [id,formats] of Object.entries(doc?.data||{})){
    const u=uuid(id);if(!u)continue;
    rows.push(...priceRowsFor(u,formats));
  }
  console.log(`Normalized ${rows.length} provider/finish price points.`);
  await batches('mtgjson_vendor_prices',rows,'uuid,provider,price_type,finish,observed_on');
  await syncState('prices_today',{last_started_at:started,last_completed_at:now(),source_version:txt(doc?.meta?.version),source_date:doc?.meta?.date||null,row_count:rows.length,status:'complete',detail:{priceRows:rows.length,providers:[...new Set(rows.map(r=>r.provider))]}});
  return {priceRows:rows.length,providers:[...new Set(rows.map(r=>r.provider))]};
}

async function main(){
  try{
    let result;
    if(MODE==='identity')result=await syncIdentity();
    else if(MODE==='all'){const identity=await syncIdentity();const prices=await syncPrices();result={...identity,...prices};}
    else result=await syncPrices();
    console.log(JSON.stringify({ok:true,mode:MODE,...result},null,2));
  }catch(e){
    const feed=MODE==='identity'?'identity':MODE==='prices'?'prices_today':'all';
    try{await syncState(feed,{last_started_at:now(),status:'failed',detail:{error:String(e?.stack||e)}})}catch{}
    throw e;
  }
}
await main();
