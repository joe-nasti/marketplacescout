// Collectish Scout V5 cache read — transparently accelerate only the main ranked Scout read.
(() => {
  const base=window.rest;
  if(typeof base!=='function'||base.__cxScoutCache)return;
  const LIVE='scout_opportunities_v5?select=*&order=promoted_score.desc,observation_count.desc&limit=500';
  const CACHE='scout_opportunities_v5_cache?select=*&order=promoted_score.desc,observation_count.desc&limit=500';
  async function rest(path,o={}){
    const method=String(o?.method||'GET').toUpperCase();
    if(method!=='GET'||path!==LIVE)return base(path,o);
    const t0=performance.now();
    try{
      const rows=await base(CACHE,o);
      if(Array.isArray(rows)&&rows.length){
        window.COLLECTISH_RUNTIME_HEALTH={...(window.COLLECTISH_RUNTIME_HEALTH||{}),scout_cache_used:true,scout_cache_read_ms:Math.round(performance.now()-t0)};
        document.dispatchEvent(new CustomEvent('collectish:runtime-health'));
        return rows;
      }
    }catch{}
    const rows=await base(LIVE,o);
    window.COLLECTISH_RUNTIME_HEALTH={...(window.COLLECTISH_RUNTIME_HEALTH||{}),scout_cache_used:false,scout_cache_fallback:true,scout_cache_read_ms:Math.round(performance.now()-t0)};
    document.dispatchEvent(new CustomEvent('collectish:runtime-health'));
    return rows;
  }
  rest.__cxScoutCache=true;
  rest.__cxBase=base;
  window.rest=rest;
})();