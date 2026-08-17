// Collectish Scout V5 cache read — accelerate and coalesce only the main ranked Scout read.
(() => {
  const base=window.rest;
  if(typeof base!=='function'||base.__cxScoutCache)return;
  const LIVE='scout_opportunities_v5?select=*&order=promoted_score.desc,observation_count.desc&limit=500';
  const CACHE='scout_opportunities_v5_cache?select=*&order=promoted_score.desc,observation_count.desc&limit=500';
  const KEY='collectishRuntimeHealth';
  const REUSE_MS=4000;
  let inFlight=null,lastRows=null,lastAt=0;
  function health(p){
    window.COLLECTISH_RUNTIME_HEALTH={...(window.COLLECTISH_RUNTIME_HEALTH||{}),...p};
    try{const old=JSON.parse(sessionStorage.getItem(KEY)||'{}');sessionStorage.setItem(KEY,JSON.stringify({...old,...p}))}catch{}
    document.dispatchEvent(new CustomEvent('collectish:runtime-health'));
  }
  async function fetchRanked(o){
    const t0=performance.now();
    try{
      const rows=await base(CACHE,o);
      if(Array.isArray(rows)&&rows.length){
        health({scout_cache_used:true,scout_cache_fallback:false,scout_cache_read_ms:Math.round(performance.now()-t0)});
        return rows;
      }
    }catch{}
    const rows=await base(LIVE,o);
    health({scout_cache_used:false,scout_cache_fallback:true,scout_cache_read_ms:Math.round(performance.now()-t0)});
    return rows;
  }
  async function rest(path,o={}){
    const method=String(o?.method||'GET').toUpperCase();
    if(method!=='GET'||path!==LIVE)return base(path,o);
    const now=performance.now();
    if(lastRows&&now-lastAt<REUSE_MS){
      health({scout_read_reused:(Number(window.COLLECTISH_RUNTIME_HEALTH?.scout_read_reused||0)+1)});
      return lastRows;
    }
    if(inFlight){
      health({scout_read_coalesced:(Number(window.COLLECTISH_RUNTIME_HEALTH?.scout_read_coalesced||0)+1)});
      return inFlight;
    }
    inFlight=fetchRanked(o).then(rows=>{lastRows=rows;lastAt=performance.now();return rows}).finally(()=>{inFlight=null});
    return inFlight;
  }
  rest.__cxScoutCache=true;
  rest.__cxBase=base;
  window.rest=rest;
})();