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

  function withCanonicalContext(init={}){
    if(!init?.body||typeof init.body!=='string')return init;
    try{
      const body=JSON.parse(init.body);
      if(String(body?.action||'chat')!=='chat')return init;
      const canonical=window.CollectishContext?.legacy?.();
      if(!canonical)return init;
      return {...init,body:JSON.stringify({...body,context:{...canonical,...(body.context||{}),entity:canonical.entity,view:canonical.view}})};
    }catch{return init}
  }

  window.fetch=async function(input,init){
    const url=rewritten(input);
    if(!url)return nativeFetch(input,init);
    // Ask currently uses a URL string + RequestInit. Keep Request inputs intact as a
    // defensive fallback rather than attempting to clone a consumed request body.
    const nextInit=input instanceof Request?init:withCanonicalContext(init);
    const response=input instanceof Request
      ? await nativeFetch(input,nextInit)
      : await nativeFetch(url,nextInit);
    try{
      const data=await response.clone().json();
      if(/^collectish\.ask\.surface\.v\d+$/.test(String(data?.surface_schema||''))&&Array.isArray(data.surfaces)&&data.surfaces.length){
        window.__CollectishAskSurfaceQueue.push({schema:data.surface_schema,surfaces:data.surfaces,conversation_id:data.conversation_id||null});
      }
    }catch{}
    return response;
  };
})();