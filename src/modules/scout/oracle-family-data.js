import { rest } from '../../core/rest.js';

const FAMILY_TTL=60*1000;
const cache=new Map();
const inflight=new Map();

const keyFor=(oracle,limit)=>`${String(oracle||'')}|${Number(limit)||0}`;

export async function readOracleFamily(oracle,{limit=2000,force=false}={}){
  const id=String(oracle||'').trim();
  if(!id)return [];
  const key=keyFor(id,limit),cached=cache.get(key);
  if(!force&&cached&&Date.now()-cached.fetchedAt<FAMILY_TTL)return cached.rows;
  if(inflight.has(key))return inflight.get(key);
  const job=rest('rpc/scout_catalog_by_oracle',{method:'POST',body:{p_oracle_id:id,p_limit:limit}})
    .then(rows=>{const value=Array.isArray(rows)?rows:[];cache.set(key,{rows:value,fetchedAt:Date.now()});return value})
    .finally(()=>inflight.delete(key));
  inflight.set(key,job);
  return job;
}

export function seedOracleFamily(oracle,rows,{limit=2000}={}){
  const id=String(oracle||'').trim();
  if(id&&Array.isArray(rows))cache.set(keyFor(id,limit),{rows,fetchedAt:Date.now()});
  return rows;
}

export function clearOracleFamily(oracle,{limit=2000}={}){
  cache.delete(keyFor(oracle,limit));
}

