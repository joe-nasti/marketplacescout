// Warm and reuse explicit Ask preferences without spending AI tokens.
(() => {
  if(window.__collectishAskPreferencesCacheInstalled)return;
  window.__collectishAskPreferencesCacheInstalled=true;
  const KEY='COLLECTISH_ASK_PREFS_CACHE_V1',TTL=15*60*1000;
  let warming=null;
  function read(){try{const x=JSON.parse(localStorage.getItem(KEY)||'null');return x&&Date.now()-Number(x.at||0)<TTL?x.data:null}catch{return null}}
  function write(data){try{localStorage.setItem(KEY,JSON.stringify({at:Date.now(),data}))}catch{}return data}
  async function warm(force=false){
    if(!force&&read())return read();
    if(warming)return warming;
    warming=Promise.resolve(window.rest?.('rpc/ask_collectish_get_preferences',{method:'POST',body:{}}))
      .then(data=>data?write(data):null)
      .catch(()=>read())
      .finally(()=>{warming=null});
    return warming;
  }
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    const raw=input instanceof Request?input.url:String(input||'');
    let isFast=false;
    try{isFast=new URL(raw,location.href).pathname.endsWith('/functions/v1/ask-collectish-stream')}catch{}
    if(!isFast||input instanceof Request||!init?.body)return nativeFetch(input,init);
    const pref=read();if(!pref)return nativeFetch(input,init);
    try{
      const body=JSON.parse(String(init.body));
      if(body&&typeof body==='object'&&!body.preferencesSnapshot)return nativeFetch(input,{...init,body:JSON.stringify({...body,preferencesSnapshot:pref})});
    }catch{}
    return nativeFetch(input,init);
  };
  const schedule=()=>{if('requestIdleCallback'in window)requestIdleCallback(()=>void warm(),{timeout:2500});else setTimeout(()=>void warm(),400)};
  schedule();
  document.addEventListener('click',e=>{if(e.target?.closest?.('.cx-ask-prefbox button'))setTimeout(()=>void warm(true),500)},true);
  window.CollectishAskPreferencesCache={get:read,warm,clear:()=>localStorage.removeItem(KEY)};
})();
