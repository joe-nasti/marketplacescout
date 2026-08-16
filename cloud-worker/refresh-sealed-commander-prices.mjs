const URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const SEARCH='https://mp-search-api.tcgplayer.com';
const RELEASE_FROM=process.env.PRECON_RELEASE_FROM||'2025-01-01';
if(!URL||!KEY)throw new Error('Missing Supabase credentials');
const H={apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function sb(path,{method='GET',body,prefer}={}){
  const r=await fetch(`${URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}
  if(!r.ok)throw new Error(`${r.status} ${path}: ${typeof d==='string'?d:JSON.stringify(d)}`);return d;
}
async function search(q){
  const body={algorithm:'salesrel',from:0,size:24,filters:{term:{productLineName:['magic'],productTypeName:['Sealed Products']},range:{},match:{}},context:{shippingCountry:'US',userProfile:{productLineAffinity:'Magic: The Gathering'}},settings:{useFuzzySearch:true,didYouMean:{}},sort:{}};
  const r=await fetch(`${SEARCH}/v1/search/request?q=${encodeURIComponent(q)}&isList=true`,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(body)});
  const t=await r.text();if(!r.ok)throw new Error(`TCG search ${r.status}: ${t.slice(0,240)}`);return JSON.parse(t);
}
function norm(s){return String(s||'').toLowerCase().replace(/collector'?s edition/g,' collectors edition ').replace(/[^a-z0-9]+/g,' ').trim()}
function scoreName(expected,actual){const a=new Set(norm(expected).split(' ').filter(Boolean)),b=new Set(norm(actual).split(' ').filter(Boolean));let hit=0;for(const x of a)if(b.has(x))hit++;return a.size?hit/a.size:0}
function parse(j,expected){const root=j?.results?.[0],rows=root?.results||[];let best=null,bestScore=-1;for(const p of rows){if(!p?.productId)continue;const sc=scoreName(expected,p.productName);if(sc>bestScore){bestScore=sc;best=p}}return bestScore>=.55?best:null}
function decode(v){if(Array.isArray(v))return v.flatMap(x=>decode(x));if(typeof v==='string'){try{const x=JSON.parse(v);return Array.isArray(x)?x:[v]}catch{return [v]}}return []}
const decks=await sb(`mtgjson_decks?select=deck_key,name,release_date,sealed_product_uuids&deck_type=eq.${encodeURIComponent('Commander Deck')}&release_date=gte.${encodeURIComponent(RELEASE_FROM)}&order=release_date.desc&limit=500`)||[];
let written=0,matched=0,failed=0;
for(const d of decks){
  const uuids=decode(d.sealed_product_uuids).filter(x=>/^[0-9a-f-]{36}$/i.test(String(x)));if(!uuids.length)continue;
  const products=await sb(`mtgjson_sealed_products?select=uuid,name,set_code&uuid=in.(${uuids.map(encodeURIComponent).join(',')})`);
  for(const sp of products||[]){
    try{
      const j=await search(sp.name||d.name),p=parse(j,sp.name||d.name);if(!p)continue;matched++;
      const listing=(p.listings||[])[0]||{};
      const row={sealed_uuid:sp.uuid,source:'tcgplayer_public',product_id:String(p.productId),product_name:p.productName||sp.name,
        market_price:p.marketPrice==null?null:Number(p.marketPrice),low_price:p.lowestPrice==null?null:Number(p.lowestPrice),
        low_with_shipping:p.lowestPriceWithShipping==null?null:Number(p.lowestPriceWithShipping),total_listings:p.totalListings==null?null:Number(p.totalListings),
        captured_at:new Date().toISOString(),raw_json:{setName:p.setName,productTypeName:p.productTypeName,listingPrice:listing.price??null,query:sp.name||d.name}};
      await sb('sealed_product_price_current?on_conflict=sealed_uuid,source',{method:'POST',body:[row],prefer:'resolution=merge-duplicates,return=minimal'});written++;
      await sb(`mtgjson_sealed_products?uuid=eq.${encodeURIComponent(sp.uuid)}`,{method:'PATCH',body:{tcgplayer_product_id:String(p.productId)},prefer:'return=minimal'});
      console.log(`${sp.name}: product ${p.productId} market ${p.marketPrice??'—'} low ${p.lowestPrice??'—'}`);
      await sleep(250);
    }catch(e){failed++;console.error(`${sp.name}: ${e.message}`)}
  }
}
console.log(JSON.stringify({decks:decks.length,matched,written,failed,releaseFrom:RELEASE_FROM,at:new Date().toISOString()}));
if(failed)process.exitCode=1;
