const DB_NAME='collectish-cache';
const DB_VERSION=1;
const STORE='resources';
let dbPromise=null;

function openDb(){
  if(typeof indexedDB==='undefined')return Promise.resolve(null);
  if(dbPromise)return dbPromise;
  dbPromise=new Promise(resolve=>{
    try{
      const request=indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'key'});
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>resolve(null);
      request.onblocked=()=>resolve(null);
    }catch{resolve(null)}
  });
  return dbPromise;
}

async function tx(mode,run){
  const db=await openDb();
  if(!db)return null;
  return new Promise(resolve=>{
    try{
      const transaction=db.transaction(STORE,mode);
      const store=transaction.objectStore(STORE);
      const request=run(store);
      if(request){request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>resolve(null)}
      else{transaction.oncomplete=()=>resolve(true);transaction.onerror=()=>resolve(null);transaction.onabort=()=>resolve(null)}
    }catch{resolve(null)}
  });
}

export async function readPersistentResource(key){
  return tx('readonly',store=>store.get(key));
}

export async function readPersistentResources(keys=[]){
  const unique=[...new Set((keys||[]).filter(Boolean))];
  if(!unique.length)return new Map();
  const rows=await Promise.all(unique.map(async key=>[key,await readPersistentResource(key)]));
  return new Map(rows.filter(([,value])=>value));
}

export async function writePersistentResource(key,data,meta={}){
  const value={key,data,fetchedAt:Number(meta.fetchedAt||Date.now()),version:1};
  await tx('readwrite',store=>store.put(value));
  return value;
}

export async function deletePersistentResource(key){
  await tx('readwrite',store=>store.delete(key));
}

export async function clearPersistentResources(){
  await tx('readwrite',store=>store.clear());
}

export function persistentCacheAvailable(){return typeof indexedDB!=='undefined'}
