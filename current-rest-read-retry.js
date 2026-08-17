// Collectish REST resilience — one bounded retry for transient read-only statement timeouts.
(() => {
  const base=window.rest;
  if(typeof base!=='function'||base.__cxReadRetry)return;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const isTimeout=e=>String(e?.message||e||'').toLowerCase().includes('statement timeout');
  const METRIC_KEY='collectishRuntimeHealth';
  function readMetrics(){try{return JSON.parse(sessionStorage.getItem(METRIC_KEY)||'{}')}catch{return {}}}
  function bump(key,extra={}){
    const m=readMetrics();
    m[key]=Number(m[key]||0)+1;
    m.last_event_at=new Date().toISOString();
    Object.assign(m,extra);
    try{sessionStorage.setItem(METRIC_KEY,JSON.stringify(m))}catch{}
    document.dispatchEvent(new CustomEvent('collectish:runtime-health',{detail:{...m,event:key}}));
  }
  async function rest(path,o={}){
    const method=String(o?.method||'GET').toUpperCase();
    const started=performance.now();
    try{
      const out=await base(path,o);
      const elapsed=Math.round(performance.now()-started);
      if(elapsed>4000)bump('slow_reads',{last_slow_read_ms:elapsed,last_slow_read_path:String(path).slice(0,180)});
      return out;
    }catch(e){
      if(method!=='GET'||!isTimeout(e))throw e;
      bump('statement_timeout_retries',{last_retry_path:String(path).slice(0,180)});
      await sleep(350+Math.floor(Math.random()*250));
      const retryStarted=performance.now();
      try{
        const out=await base(path,o);
        bump('statement_timeout_recoveries',{last_retry_ms:Math.round(performance.now()-retryStarted)});
        return out;
      }catch(e2){
        if(isTimeout(e2))bump('statement_timeout_failures',{last_failure_path:String(path).slice(0,180)});
        throw e2;
      }
    }
  }
  rest.__cxReadRetry=true;
  rest.__cxBase=base;
  window.rest=rest;
  window.CollectishRuntimeHealth={get:readMetrics};
})();
