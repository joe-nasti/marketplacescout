import store from '../state/store.js';

const TTL_MS=6*60*60*1000;
const MAX_ENTRIES=400;
const cache=new Map();
const inflight=new Map();
let installed=false;
let originalFetch=null;

function requestUrl(input){
  try{return new URL(typeof input==='string'?input:input?.url||String(input),location.href)}catch{return null}
}

function isScryfallGet(input,init){
  const method=String(init?.method||input?.method||'GET').toUpperCase();
  if(method!=='GET')return false;
  return requestUrl(input)?.hostname==='api.scryfall.com';
}

function keyFor(input){return requestUrl(input)?.href||(typeof input==='string'?input:input?.url||String(input))}

function normalizeName(name=''){
  return String(name).replace(/\s*\([^)]*(foil|showcase|borderless|extended art|serialized|retro frame|etched|alternate art|halo foil|rainbow foil|surge foil|galaxy foil)[^)]*\)\s*/ig,' ').replace(/\s+/g,' ').trim().toLowerCase();
}

function scoutRows(){return store.get()?.scout?.rows||[]}

function rowForScryfallRequest(url){
  if(!url)return null;
  const parts=url.pathname.split('/').filter(Boolean);
  const rows=scoutRows();
  if(parts[0]!=='cards')return null;

  if(parts[1]==='named'){
    const exact=normalizeName(url.searchParams.get('exact')||'');
    return exact?rows.find(r=>normalizeName(r.product_name)===exact&&r.product_id)||null:null;
  }

  if(parts.length===2){
    const id=String(parts[1]||'').toLowerCase();
    return rows.find(r=>String(r.scryfall_id||'').toLowerCase()===id&&r.product_id)||null;
  }

  if(parts.length>=3){
    const set=String(parts[1]||'').toLowerCase(),collector=decodeURIComponent(parts[2]||'');
    return rows.find(r=>String(r.set_code||'').toLowerCase()===set&&String(r.collector_number||'')===collector&&r.product_id)||null;
  }
  return null;
}

function syntheticScryfallResponse(url){
  const row=rowForScryfallRequest(url);
  if(!row?.product_id)return null;
  const productId=encodeURIComponent(row.product_id);
  const set=String(row.set_code||'').toLowerCase();
  const collector=encodeURIComponent(row.collector_number||'');
  const scryfallUri=row.scryfall_id
    ?`https://scryfall.com/card/${encodeURIComponent(row.scryfall_id)}`
    :(set&&collector?`https://scryfall.com/card/${encodeURIComponent(set)}/${collector}`:'');
  const payload={
    id:row.scryfall_id||null,
    name:row.product_name||'',
    set:row.set_code||null,
    collector_number:row.collector_number||null,
    scryfall_uri:scryfallUri||null,
    edhrec_rank:row.edhrec_rank??null,
    image_uris:{
      normal:`https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_1000x1000.jpg`,
      large:`https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_1000x1000.jpg`
    },
    collectish_source:'tcgplayer_product'
  };
  return new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json','X-Collectish-Source':'tcgplayer-product'}});
}

function prune(){
  const now=Date.now();
  for(const [key,entry] of cache){if(now-entry.at>TTL_MS)cache.delete(key)}
  if(cache.size<=MAX_ENTRIES)return;
  const ordered=[...cache.entries()].sort((a,b)=>a[1].at-b[1].at);
  for(const [key] of ordered.slice(0,cache.size-MAX_ENTRIES))cache.delete(key);
}

async function cachedFetch(input,init){
  if(!isScryfallGet(input,init))return originalFetch(input,init);
  prune();
  const url=requestUrl(input);
  const local=syntheticScryfallResponse(url);
  if(local)return local;

  const key=keyFor(input),hit=cache.get(key);
  if(hit&&Date.now()-hit.at<=TTL_MS)return hit.response.clone();

  let job=inflight.get(key);
  if(!job){
    job=originalFetch(input,{...init,cache:'no-store'}).then(response=>{
      if(response.ok)cache.set(key,{at:Date.now(),response:response.clone()});
      return response;
    }).finally(()=>inflight.delete(key));
    inflight.set(key,job);
  }
  return (await job).clone();
}

export function installScryfallCache(){
  if(installed)return;
  installed=true;
  originalFetch=window.fetch.bind(window);
  window.fetch=cachedFetch;
}

export function clearScryfallCache(){cache.clear();inflight.clear()}
export function getScryfallCacheStats(){return {entries:cache.size,inflight:inflight.size,ttlMs:TTL_MS}}
