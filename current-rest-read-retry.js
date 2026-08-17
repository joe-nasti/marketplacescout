// Collectish REST resilience — one bounded retry for transient read-only statement timeouts.
(() => {
  const base=window.rest;
  if(typeof base!=='function'||base.__cxReadRetry)return;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const isTimeout=e=>String(e?.message||e||'').toLowerCase().includes('statement timeout');
  async function rest(path,o={}){
    const method=String(o?.method||'GET').toUpperCase();
    try{return await base(path,o)}catch(e){
      if(method!=='GET'||!isTimeout(e))throw e;
      await sleep(350+Math.floor(Math.random()*250));
      return base(path,o);
    }
  }
  rest.__cxReadRetry=true;
  rest.__cxBase=base;
  window.rest=rest;
})();
