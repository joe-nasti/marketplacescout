import store from './store.js';
import { readPersistentResource, readPersistentResources, writePersistentResource, deletePersistentResource } from './persistent-cache.js';

const inflight=new Map();

function write(key,patch){
  const resources=store.get().resources||{};
  store.update('resources',{[key]:{...(resources[key]||{}),...patch}});
}

function scopedKey(key,scope='user'){
  if(scope==='global')return `global:${key}`;
  const userId=store.get().session?.user?.id||'anonymous';
  return `user:${userId}:${key}`;
}

export function getResource(key){return store.get().resources?.[key]||null}

export async function primeResources(entries=[]){
  const specs=(entries||[]).map(entry=>typeof entry==='string'?{key:entry,scope:'user'}:entry).filter(x=>x?.key);
  if(!specs.length)return 0;
  const keys=specs.map(x=>scopedKey(x.key,x.scope||'user'));
  const cached=await readPersistentResources(keys);
  let hydrated=0;
  store.batch(()=>{
    for(const spec of specs){
      const record=cached.get(scopedKey(spec.key,spec.scope||'user'));
      if(!record)continue;
      const maxStale=Number(spec.maxStale??7*24*60*60*1000);
      const age=Date.now()-Number(record.fetchedAt||0);
      if(age>maxStale)continue;
      write(spec.key,{status:'ready',data:record.data,error:null,fetchedAt:record.fetchedAt,source:'indexeddb',stale:true,primed:true});
      hydrated++;
    }
  });
  return hydrated;
}

async function runLoader(key,loader,{persistent=true,scope='user'}={}){
  if(inflight.has(key))return inflight.get(key);
  write(key,{status:'loading',error:null,requestedAt:Date.now()});
  const job=Promise.resolve().then(loader).then(async data=>{
    const fetchedAt=Date.now();
    write(key,{status:'ready',data,error:null,fetchedAt,source:'network',stale:false,primed:false});
    if(persistent)await writePersistentResource(scopedKey(key,scope),data,{fetchedAt});
    return data;
  }).catch(error=>{
    const current=getResource(key);
    if(current?.data)write(key,{status:'ready',error:String(error?.message||error),failedAt:Date.now(),stale:true});
    else write(key,{status:'error',error:String(error?.message||error),failedAt:Date.now()});
    throw error;
  }).finally(()=>inflight.delete(key));
  inflight.set(key,job);
  return job;
}

export async function loadResource(key,loader,{force=false,ttl=30000,persistent=true,scope='user',staleWhileRevalidate=true,maxStale=7*24*60*60*1000}={}){
  const current=getResource(key);
  const fresh=current?.status==='ready'&&Date.now()-Number(current.fetchedAt||0)<ttl;
  if(!force&&fresh)return current.data;

  if(!force&&persistent&&!current?.data){
    const cached=await readPersistentResource(scopedKey(key,scope));
    const age=cached?Date.now()-Number(cached.fetchedAt||0):Infinity;
    if(cached&&age<=maxStale){
      write(key,{status:'ready',data:cached.data,error:null,fetchedAt:cached.fetchedAt,source:'indexeddb',stale:age>=ttl,primed:true});
      if(age<ttl)return cached.data;
      if(staleWhileRevalidate){
        void runLoader(key,loader,{persistent,scope}).catch(()=>{});
        return cached.data;
      }
    }
  }

  if(!force&&current?.data&&staleWhileRevalidate){
    void runLoader(key,loader,{persistent,scope}).catch(()=>{});
    return current.data;
  }

  return runLoader(key,loader,{persistent,scope});
}

export function invalidateResource(key){
  const current=getResource(key);
  if(current)write(key,{...current,fetchedAt:0,stale:true});
}

export async function clearResource(key,{persistent=true,scope='user'}={}){
  const resources={...(store.get().resources||{})};
  delete resources[key];
  store.update('resources',resources);
  if(persistent)await deletePersistentResource(scopedKey(key,scope));
}

window.CollectishResources={load:loadResource,get:getResource,prime:primeResources,invalidate:invalidateResource,clear:clearResource};
