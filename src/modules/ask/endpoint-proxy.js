// Narrow transport bridge for Ask Collectish structured surfaces.
// Only rewrites the exact Ask Edge Function endpoint and leaves every other fetch untouched.
(() => {
  if(window.__collectishAskEndpointProxyInstalled)return;
  window.__collectishAskEndpointProxyInstalled=true;
  window.__CollectishAskSurfaceQueue=window.__CollectishAskSurfaceQueue||[];
  const nativeFetch=window.fetch.bind(window);

  function rewritten(input){
    const raw=input instanceof Request?input.url:String(input||'');
    try{
      const u=new URL(raw,location.href);
      if(!u.pathname.endsWith('/functions/v1/ask-collectish'))return null;
      u.pathname=u.pathname.replace(/\/ask-collectish$/,'/ask-collectish-ui');
      return u.toString();
    }catch{return null}
  }

  window.fetch=async function(input,init){
    const url=rewritten(input);
    if(!url)return nativeFetch(input,init);
    // Ask currently uses a URL string + RequestInit. Keep Request inputs intact as a
    // defensive fallback rather than attempting to clone a consumed request body.
    const response=input instanceof Request
      ? await nativeFetch(input,init)
      : await nativeFetch(url,init);
    try{
      const data=await response.clone().json();
      if(data?.surface_schema==='collectish.ask.surface.v1'&&Array.isArray(data.surfaces)&&data.surfaces.length){
        window.__CollectishAskSurfaceQueue.push({schema:data.surface_schema,surfaces:data.surfaces,conversation_id:data.conversation_id||null});
      }
    }catch{}
    return response;
  };
})();
