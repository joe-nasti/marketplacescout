import { rest as baseRest } from '../../core/rest.js';

export const SCOUT_LIVE_PATH='scout_opportunities_v5?select=*&order=promoted_score.desc,observation_count.desc&limit=500';
export const SCOUT_CACHE_PATH='scout_opportunities_v5_cache?select=*&order=promoted_score.desc,observation_count.desc&limit=500';

const KEY='collectishRuntimeHealth';
const REUSE_MS=4000;
let inFlight=null,lastRows=null,lastAt=0;

function health(patch){
  window.COLLECTISH_RUNTIME_HEALTH={...(window.COLLECTISH_RUNTIME_HEALTH||{}),...patch};
  try{
    const old=JSON.parse(sessionStorage.getItem(KEY)||'{}');
    sessionStorage.setItem(KEY,JSON.stringify({...old,...patch}));
  }catch{}
  document.dispatchEvent(new CustomEvent('collectish:runtime-health',{detail:patch}));
}

export async function readScoutRankings(options={}){
  const now=performance.now();
  if(lastRows&&now-lastAt<REUSE_MS){
    health({scout_read_reused:Number(window.COLLECTISH_RUNTIME_HEALTH?.scout_read_reused||0)+1});
    return lastRows;
  }
  if(inFlight){
    health({scout_read_coalesced:Number(window.COLLECTISH_RUNTIME_HEALTH?.scout_read_coalesced||0)+1});
    return inFlight;
  }
  inFlight=(async()=>{
    const t0=performance.now();
    try{
      const rows=await baseRest(SCOUT_CACHE_PATH,options);
      if(Array.isArray(rows)&&rows.length){
        health({scout_cache_used:true,scout_cache_fallback:false,scout_cache_read_ms:Math.round(performance.now()-t0)});
        return rows;
      }
    }catch{}
    const rows=await baseRest(SCOUT_LIVE_PATH,options);
    health({scout_cache_used:false,scout_cache_fallback:true,scout_cache_read_ms:Math.round(performance.now()-t0)});
    return rows;
  })().then(rows=>{
    lastRows=rows;
    lastAt=performance.now();
    return rows;
  }).finally(()=>{inFlight=null});
  return inFlight;
}

export async function scoutAwareRest(path,options={}){
  const method=String(options?.method||'GET').toUpperCase();
  if(method==='GET'&&path===SCOUT_LIVE_PATH)return readScoutRankings(options);
  return baseRest(path,options);
}

export function installScoutCacheBridge(){
  scoutAwareRest.__cxScoutCache=true;
  scoutAwareRest.__cxBase=baseRest;
  window.rest=scoutAwareRest;
  window.CollectishScoutData={readRankings:readScoutRankings,rest:scoutAwareRest};
}
