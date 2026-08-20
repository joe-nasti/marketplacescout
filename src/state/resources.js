import store from './store.js';
import { readPersistentResource, writePersistentResource, deletePersistentResource } from './persistent-cache.js';

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

async function runLoader(key,loader,{persistent=false,scope='user'}={}){
  if(inflight.has(key))return inflight.get(key);
  write(key,{status:'loading',error:null,requestedAt:Date.now()});
  const job=Promise.resolve().then(loader).then(async data=>{
    const fetchedAt=Date.now();
    write(key,{status:'ready',data,error:null,fetchedAt,source:'network'});
    if(persistent)await writePersistentResource(scopedKey(key,scope),data,{fetchedAt});
    return data;
  }).catch(error=>{
    write(key,{status:'error',error:String(error?.message||error),failedAt:Date.now()});
    throw error;
  }).finally(()=>inflight.delete(key));
  inflight.set(key,job);
  return job;
}

export async function loadResource(key,loader,{force=false,ttl=30000,persistent=false,scope='user',staleWhileRevalidate=false,maxStale=7*24*60*60*1000}={}){
  const current=getResource(key);
  const fresh=current?.status==='ready'&&Date.now()-Number(current.fetchedAt||0)<ttl;
  if(!force&&fresh)return current.data;

  if(!force&&persistent&&!current?.data){
    const cached=await readPersistentResource(scopedKey(key,scope));
    const age=cached?Date.now()-Number(cached.fetchedAt||0):Infinity;
    if(cached&&age<=maxStale){
      write(key,{status:'ready',data:cached.data,error:null,fetchedAt:cached.fetchedAt,source:'indexeddb',stale:age>=ttl});
      if(age<ttl)return cached.data;
      if(staleWhileRevalidate){
        void runLoader(key,loader,{persistent,scope}).catch(()=>{});
        return cached.data;
      }
    }
  }

  return runLoader(key,loader,{persistent,scope});
}

export function invalidateResource(key){
  const current=getResource(key);
  if(current)write(key,{...current,fetchedAt:0,stale:true});
}

export async function clearResource(key,{persistent=false,scope='user'}={}){
  const resources={...(store.get().resources||{})};
  delete resources[key];
  store.update('resources',resources);
  if(persistent)await deletePersistentResource(scopedKey(key,scope));
}

window.CollectishResources={load:loadResource,get:getResource,invalidate:invalidateResource,clear:clearResource};
