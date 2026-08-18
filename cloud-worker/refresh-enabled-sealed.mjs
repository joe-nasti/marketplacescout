const URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const SEARCH='https://mp-search-api.tcgplayer.com';
const STALE_HOURS=Math.max(1,Number(process.env.SEALED_PRICE_STALE_HOURS||24));
const CONCURRENCY=Math.max(1,Math.min(6,Number(process.env.SEALED_PRICE_CONCURRENCY||3)));
const MAX_CONSECUTIVE_ERRORS=Math.max(2,Number(process.env.SEALED_PRICE_BREAKER_ERRORS||5));
if(!URL||!KEY)throw new Error('Missing Supabase credentials');
const H={apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function sb(path,{method='GET',body,prefer}={}){const r=await fetch(`${URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(`${r.status} ${path}: ${typeof d==='string'?d:JSON.stringify(d)}`);return d}
async function rpc(name,body){return sb(`rpc/${name}`,{method:'POST',body})}
function jsonish(v){if(v&&typeof v==='object')return v;if(typeof v==='string'){try{return JSON.parse(v)}catch{}}return {}}
function parseIdFromUrl(u){try{const x=new URL(u);const m=x.pathname.match(/\/product\/(\d+)/i);return m?.[1]||x.searchParams.get('productId')||x.searchParams.get('productid')||null}catch{return null}}
async function resolveExactPurchaseId(raw){const link=jsonish(raw)?.tcgplayer;if(!link)return null;const direct=parseIdFromUrl(link);if(direct)return direct;try{const r=await fetch(link,{redirect:'follow',headers:{'User-Agent':'Collectish-Enabled-Sealed/1.0'}});return parseIdFromUrl(r.url)}catch{return null}}
async function tcgSearch(name){const body={algorithm:'salesrel',from:0,size:48,filters:{term:{productLineName:['magic'],productTypeName:['Sealed Products']},range:{},match:{}},context:{shippingCountry:'US',userProfile:{productLineAffinity:'Magic: The Gathering'}},settings:{useFuzzySearch:false,didYouMean:{}},sort:{}};const r=await fetch(`${SEARCH}/v1/search/request?q=${encodeURIComponent(name)}&isList=true`,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(body)});const t=await r.text();if(!r.ok){const e=new Error(`TCG search ${r.status}: ${t.slice(0,220)}`);e.httpStatus=r.status;throw e}return JSON.parse(t)}
function resultRows(j){return j?.results?.[0]?.results||[]}
function exactResult(j,id){return resultRows(j).find(x=>String(x?.productId||'')===String(id))||null}
async function writeSync(status,detail,started,rowCount=null){const row={feed:'enabled_sealed_pipeline',last_started_at:started,status,detail};if(rowCount!==null)row.row_count=rowCount;if(status==='complete'||status==='complete_with_warnings'||status==='paused')row.last_completed_at=new Date().toISOString();await sb('mtgjson_sync_state?on_conflict=feed',{method:'POST',body:[row],prefer:'resolution=merge-duplicates,return=minimal'})}
const started=new Date().toISOString();
const stats={profiles:0,sets:0,products:0,alreadyFresh:0,exactRedirectIds:0,priced:0,identityMissing:0,exactSearchMiss:0,failures:[],breaker:null,usersRefreshed:0,evResults:[]};
await writeSync('running',{phase:'load_enabled_sets'},started);
try{
  const profiles=await sb('sealed_set_profiles?select=user_id,set_code&enabled=eq.true&order=set_code.asc')||[];
  stats.profiles=profiles.length;
  const sets=[...new Set(profiles.map(x=>String(x.set_code||'').toUpperCase()).filter(Boolean))];stats.sets=sets.length;
  const productsByUuid=new Map();
  for(const code of sets){const rows=await sb(`mtgjson_sealed_products?select=uuid,set_code,name,tcgplayer_product_id,purchase_urls,contents&set_code=eq.${encodeURIComponent(code)}&order=release_date.desc.nullslast,name.asc&limit=5000`)||[];for(const x of rows)productsByUuid.set(String(x.uuid),x)}
  const products=[...productsByUuid.values()];stats.products=products.length;
  const existing=await sb('sealed_product_price_current?select=sealed_uuid,product_id,captured_at&source=eq.tcgplayer_public&order=captured_at.desc&limit=10000')||[];
  const fresh=new Map();const cutoff=Date.now()-STALE_HOURS*3600e3;
  for(const x of existing){const k=String(x.sealed_uuid);if(!fresh.has(k)&&new Date(x.captured_at||0).getTime()>=cutoff)fresh.set(k,x)}
  let cursor=0,consecutiveErrors=0,breakerOpen=false;
  async function one(){while(true){if(breakerOpen)return;const i=cursor++;if(i>=products.length)return;const sp=products[i];const old=fresh.get(String(sp.uuid));if(old&&String(old.product_id||'')===String(sp.tcgplayer_product_id||'')){stats.alreadyFresh++;continue}
      try{
        let exactId=sp.tcgplayer_product_id||null;
        if(!exactId){exactId=await resolveExactPurchaseId(sp.purchase_urls);if(exactId){stats.exactRedirectIds++;await sb(`mtgjson_sealed_products?uuid=eq.${encodeURIComponent(sp.uuid)}`,{method:'PATCH',body:{tcgplayer_product_id:String(exactId)},prefer:'return=minimal'});sp.tcgplayer_product_id=String(exactId)}}
        if(!exactId){stats.identityMissing++;continue}
        const j=await tcgSearch(sp.name);const p=exactResult(j,exactId);
        if(!p){stats.exactSearchMiss++;continue}
        const listing=(p.listings||[])[0]||{};
        const row={sealed_uuid:sp.uuid,source:'tcgplayer_public',product_id:String(exactId),product_name:p.productName||sp.name,market_price:p.marketPrice==null?null:Number(p.marketPrice),low_price:p.lowestPrice==null?null:Number(p.lowestPrice),low_with_shipping:p.lowestPriceWithShipping==null?null:Number(p.lowestPriceWithShipping),total_listings:p.totalListings==null?null:Number(p.totalListings),captured_at:new Date().toISOString(),raw_json:{setName:p.setName,productTypeName:p.productTypeName,listingPrice:listing.price??null,matchMethod:'exact_id',matchConfidence:'exact',identitySource:sp.tcgplayer_product_id?'mtgjson_identifier_or_resolved_purchase_url':'none',generalizedSealed:true}};
        await sb('sealed_product_price_current?on_conflict=sealed_uuid,source',{method:'POST',body:[row],prefer:'resolution=merge-duplicates,return=minimal'});stats.priced++;consecutiveErrors=0;await sleep(110);
      }catch(e){consecutiveErrors++;stats.failures.push({uuid:sp.uuid,name:sp.name,error:e.message});if(consecutiveErrors>=MAX_CONSECUTIVE_ERRORS){breakerOpen=true;stats.breaker={reason:'consecutive_tcg_or_storage_errors',threshold:MAX_CONSECUTIVE_ERRORS,openedAt:new Date().toISOString(),lastError:e.message};return}await sleep(450*Math.min(consecutiveErrors,4))}
    }}
  await Promise.all(Array.from({length:CONCURRENCY},()=>one()));
  for(const uid of [...new Set(profiles.map(x=>x.user_id).filter(Boolean))]){try{const r=await rpc('refresh_enabled_sealed_ev',{p_user_id:uid});stats.usersRefreshed++;stats.evResults.push({user_id:uid,result:r})}catch(e){stats.failures.push({user_id:uid,phase:'ev_refresh',error:e.message})}}
  const status=stats.breaker?'paused':stats.failures.length?'complete_with_warnings':'complete';
  await writeSync(status,{...stats,staleHours:STALE_HOURS,concurrency:CONCURRENCY,exactOnly:true,fuzzyMatching:false},started,stats.products);
  console.log(JSON.stringify({...stats,status,at:new Date().toISOString()}));
  if(stats.breaker||stats.failures.length)process.exitCode=1;
}catch(e){stats.failures.push({phase:'fatal',error:e.message});await writeSync('failed',{...stats,fatal:e.message,exactOnly:true,fuzzyMatching:false},started);throw e}
