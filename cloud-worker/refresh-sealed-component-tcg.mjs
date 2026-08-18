const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const LIMIT=Math.max(1,Number(process.env.SEALED_COMPONENT_TCG_LIMIT||360));
const STALE_HOURS=Math.max(1,Number(process.env.SEALED_COMPONENT_TCG_STALE_HOURS||24));
const CONCURRENCY=Math.max(1,Math.min(5,Number(process.env.SEALED_COMPONENT_TCG_CONCURRENCY||3)));
const GATEWAY='https://mpgateway.tcgplayer.com';
const SEARCH='https://mp-search-api.tcgplayer.com';
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(d?.message||`Supabase HTTP ${r.status}: ${t.slice(0,180)}`);return d}
async function jf(url,opt={}){let last;for(let i=0;i<4;i++){try{const r=await fetch(url,{...opt,headers:{Accept:'application/json',...(opt.body?{'Content-Type':'application/json'}:{}),...(opt.headers||{})}});const t=await r.text();if(r.ok)return JSON.parse(t);const e=new Error(`HTTP ${r.status}: ${t.slice(0,160)}`);if(![429,500,502,503,504].includes(r.status))throw e;last=e}catch(e){last=e}await sleep(500*(2**i)+Math.random()*180)}throw last}
const norm=x=>String(x||'').trim().toLowerCase();
function skuMatches(s,finish){if(!['near mint','near_mint','nm'].includes(norm(s.condition))||norm(s.language)!=='english')return false;const f=norm(finish),sf=norm(s.finish),p=norm(s.printing);if(sf)return sf===f;if(f==='foil')return p==='foil';if(f==='normal')return ['normal','non foil','non-foil'].includes(p);return p===f}
async function pricepoints(skus){if(!skus.length)return[];return jf(`${GATEWAY}/v1/pricepoints/marketprice/skus/search`,{method:'POST',body:JSON.stringify({skuIds:skus.map(Number)})})}
async function directExact(item){const printing=norm(item.finish)==='foil'?'Foil':'Normal';const body={algorithm:'salesrel',from:0,size:12,filters:{term:{productLineName:['magic'],productTypeName:['Cards']},range:{},match:{}},listingSearch:{filters:{term:{sellerStatus:'Live',channelId:0,'direct-listing':true,printing:[printing],condition:['Near Mint'],language:['English']},range:{quantity:{gte:1}},exclude:{channelExclusion:0}}},context:{shippingCountry:'US',userProfile:{productLineAffinity:'Magic: The Gathering'}},settings:{useFuzzySearch:true,didYouMean:{}},sort:{}};const d=await jf(`${SEARCH}/v1/search/request?q=${encodeURIComponent(item.card_name)}&isList=true`,{method:'POST',body:JSON.stringify(body)});for(const p of d?.results?.[0]?.results||[]){if(String(p.productId)!==String(item.product_id))continue;for(const l of p.listings||[]){if(String(l.productConditionId)===String(item.sku_id))return {directLow:Number(l.price??l.sellerPrice)||null,lowWithShipping:p.lowestPriceWithShipping==null?null:Number(p.lowestPriceWithShipping),raw:{productId:p.productId,totalListings:p.totalListings,listing:l}}}}return {directLow:null,lowWithShipping:null,raw:null}}
async function mapLimit(items,n,fn){const out=new Array(items.length);let i=0;await Promise.all(Array.from({length:n},async()=>{while(true){const j=i++;if(j>=items.length)return;try{out[j]=await fn(items[j],j)}catch(e){out[j]={error:String(e.message||e)}}}}));return out}
async function main(){
  const components=await sb('sealed_component_ev_current?select=user_id,sealed_uuid,card_uuid,card_name,set_code,finish,refreshed_at&order=refreshed_at.desc&limit=10000');
  const sealed=await sb('sealed_ev_current?select=user_id,sealed_uuid,set_code,release_date,scout_sealed_score,lifecycle_status&limit=5000');
  const sealedByKey=new Map((sealed||[]).map(x=>[`${x.user_id}|${x.sealed_uuid}`,x]));
  const unique=new Map();
  for(const c of components||[]){
    const k=`${c.user_id}|${c.card_uuid}|${norm(c.finish)}`;
    const parent=sealedByKey.get(`${c.user_id}|${c.sealed_uuid}`)||{};
    const enriched={...c,parent_score:Number(parent.scout_sealed_score??-1),parent_release:parent.release_date||'',parent_lifecycle:parent.lifecycle_status||'',parent_set:parent.set_code||c.set_code||''};
    const prev=unique.get(k);
    if(!prev||enriched.parent_score>prev.parent_score||String(enriched.parent_release)>String(prev.parent_release))unique.set(k,enriched);
  }
  const ids=[...new Set([...unique.values()].map(x=>x.card_uuid))];const skuRows=[];for(let i=0;i<ids.length;i+=120){const q=ids.slice(i,i+120).map(encodeURIComponent).join(',');skuRows.push(...await sb(`mtgjson_tcgplayer_skus?select=uuid,sku_id,product_id,condition,finish,language,printing,source_updated_at&uuid=in.(${q})`))}
  const byUuid=new Map();for(const s of skuRows){if(!byUuid.has(s.uuid))byUuid.set(s.uuid,[]);byUuid.get(s.uuid).push(s)}
  const existing=await sb('sealed_component_tcg_current?select=user_id,card_uuid,finish,captured_at&limit=20000');const ex=new Map((existing||[]).map(x=>[`${x.user_id}|${x.card_uuid}|${norm(x.finish)}`,x]));const staleMs=STALE_HOURS*3600000;
  const candidates=[];for(const [k,c] of unique){const old=ex.get(k);if(old&&Date.now()-new Date(old.captured_at).getTime()<staleMs)continue;const sku=(byUuid.get(c.card_uuid)||[]).filter(s=>skuMatches(s,c.finish)).sort((a,b)=>String(b.source_updated_at||'').localeCompare(String(a.source_updated_at||'')))[0];if(!sku)continue;candidates.push({...c,sku_id:String(sku.sku_id),product_id:String(sku.product_id),missing:!old})}
  candidates.sort((a,b)=>
    Number(b.missing)-Number(a.missing) ||
    Number(b.parent_lifecycle==='scout_sealed')-Number(a.parent_lifecycle==='scout_sealed') ||
    Number(b.parent_score)-Number(a.parent_score) ||
    String(b.parent_release||'').localeCompare(String(a.parent_release||'')) ||
    Number(String(b.parent_set||'').toUpperCase()==='SLD')-Number(String(a.parent_set||'').toUpperCase()==='SLD')
  );
  const todo=candidates.slice(0,LIMIT);const pp=await pricepoints(todo.map(x=>x.sku_id));const pm=new Map((pp||[]).map(x=>[String(x.skuId),x]));
  const direct=await mapLimit(todo,CONCURRENCY,async x=>{const d=await directExact(x);await sleep(120);return d});
  const now=new Date().toISOString(),rows=[];let directFound=0;for(let i=0;i<todo.length;i++){const x=todo[i],p=pm.get(x.sku_id)||{},d=direct[i]||{};if(d.directLow)directFound++;rows.push({user_id:x.user_id,card_uuid:x.card_uuid,finish:x.finish,sku_id:x.sku_id,product_id:x.product_id,tcg_low:p.lowestPrice==null?null:Number(p.lowestPrice),low_with_shipping:d.lowWithShipping??null,tcg_market:p.marketPrice==null?null:Number(p.marketPrice),direct_low:d.directLow??null,captured_at:now,source:'tcgplayer_public',raw_json:{pricepoint:p,direct:d.raw||null,parent:{sealedUuid:x.sealed_uuid,score:x.parent_score,releaseDate:x.parent_release,lifecycle:x.parent_lifecycle}}})}
  for(let i=0;i<rows.length;i+=100)await sb('sealed_component_tcg_current?on_conflict=user_id,card_uuid,finish',{method:'POST',body:rows.slice(i,i+100),prefer:'resolution=merge-duplicates,return=minimal'});
  await sb('mtgjson_sync_state?on_conflict=feed',{method:'POST',body:[{feed:'sealed_component_tcg',status:'complete',last_started_at:now,last_completed_at:new Date().toISOString(),row_count:rows.length,detail:{candidates:candidates.length,fetched:rows.length,directFound,limit:LIMIT,staleHours:STALE_HOURS,exactOnly:true,priority:'missing -> scout sealed -> score -> release'}}],prefer:'resolution=merge-duplicates,return=minimal'}).catch(()=>{});
  console.log(JSON.stringify({candidates:candidates.length,fetched:rows.length,directFound},null,2));
}
await main();