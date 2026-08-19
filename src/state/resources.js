import store from './store.js';

const inflight=new Map();

function write(key,patch){
  const resources=store.get().resources||{};
  store.update('resources',{[key]:{...(resources[key]||{}),...patch}});
}

export function getResource(key){return store.get().resources?.[key]||null}

export async function loadResource(key,loader,{force=false,ttl=30000}={}){
  const current=getResource(key);
  const fresh=current?.status==='ready'&&Date.now()-Number(current.fetchedAt||0)<ttl;
  if(!force&&fresh)return current.data;
  if(inflight.has(key))return inflight.get(key);
  write(key,{status:'loading',error:null,requestedAt:Date.now()});
  const job=Promise.resolve().then(loader).then(data=>{
    write(key,{status:'ready',data,error:null,fetchedAt:Date.now()});
    return data;
  }).catch(error=>{
    write(key,{status:'error',error:String(error?.message||error),failedAt:Date.now()});
    throw error;
  }).finally(()=>inflight.delete(key));
  inflight.set(key,job);
  return job;
}

export function invalidateResource(key){
  const current=getResource(key);
  if(current)write(key,{...current,fetchedAt:0});
}

export function clearResource(key){
  const resources={...(store.get().resources||{})};
  delete resources[key];
  store.update('resources',resources);
}

window.CollectishResources={load:loadResource,get:getResource,invalidate:invalidateResource,clear:clearResource};
