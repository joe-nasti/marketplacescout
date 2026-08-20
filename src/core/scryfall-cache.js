const TTL_MS=6*60*60*1000;
const MAX_ENTRIES=400;
const cache=new Map();
const inflight=new Map();
let installed=false;
let originalFetch=null;

function isScryfallGet(input,init){
  const method=String(init?.method||input?.method||'GET').toUpperCase();
  if(method!=='GET')return false;
  let url='';
  try{url=typeof input==='string'?input:input?.url||String(input)}catch{return false}
  try{return new URL(url,location.href).hostname==='api.scryfall.com'}catch{return false}
}

function keyFor(input){
  const raw=typeof input==='string'?input:input?.url||String(input);
  try{return new URL(raw,location.href).href}catch{return raw}
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
