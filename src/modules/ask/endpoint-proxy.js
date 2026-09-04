// Ask transport bridge. Routing intelligence now lives server-side so web and Discord
// share one Delvin resolver/presentation contract instead of duplicating client regexes.
(() => {
  if(window.__collectishAskEndpointProxyInstalled)return;
  window.__collectishAskEndpointProxyInstalled=true;
  window.__CollectishAskSurfaceQueue=window.__CollectishAskSurfaceQueue||[];
  const nativeFetch=window.fetch.bind(window);
  const externalResearch=/search (?:the )?web|research externally|look online|external research|latest (?:news|articles|discussion)|web research|search online|find (?:recent )?(?:news|articles|discussion)/i;
  const explicitCardTarget=q=>{const text=String(q||'');return /\b[A-Z0-9]{2,8}\s*#\s*[A-Za-z0-9-]+\b/.test(text)||/\b(?:sku|product(?:\s*id)?)\s*(?:#|:)?\s*\d+\b/i.test(text)||/tcgplayer\.com\/product\/\d+/i.test(text)};
  const marketWideTarget=q=>{const text=String(q||'').toLowerCase();return /\bmarket radar\b/.test(text)||/\b(?:top|biggest|best|leading)\s+(?:market\s+)?(?:movers?|gainers?|losers?|opportunities)\b/.test(text)||/\bwhat(?:'s| is| are)\s+(?:moving|spiking|rising|gaining)\s+(?:today|now|right now)\b/.test(text)||/\bwhat should i (?:look at|watch|buy)\s+(?:today|now|right now)\b/.test(text)||/\bbest\s+(?:scout\s+)?opportunities\s+(?:today|now|right now)\b/.test(text)};
  function rewritten(input){
    const raw=input instanceof Request?input.url:String(input||'');
    try{const u=new URL(raw,location.href);if(!u.pathname.endsWith('/functions/v1/ask-collectish'))return null;u.pathname=u.pathname.replace(/\/ask-collectish$/,'/ask-collectish-api-v2');return u.toString()}catch{return null}
  }
  function requestBody(init={}){try{return init?.body&&typeof init.body==='string'?JSON.parse(init.body):null}catch{return null}}
  function withCanonicalContext(init={}){
    if(!init?.body||typeof init.body!=='string')return init;
    try{
      const body=JSON.parse(init.body);if(String(body?.action||'chat')!=='chat')return init;
      const canonical=window.CollectishContext?.legacy?.();if(!canonical)return {...init,body:JSON.stringify({...body,client:body.client||'web'})};
      const prompt=String(body?.message||body?.question||''),supplied=body.context||{},context={...canonical,...supplied,entity:canonical.entity,view:canonical.view};
      const contextMode=explicitCardTarget(prompt)?'explicit_target':marketWideTarget(prompt)?'market_wide':null;
      if(contextMode){context.entity=null;context.sku_id=null;context.product_id=null;context.product_name_hint=null;context.set_name=null;context.entity_context_mode=`fallback_suppressed_${contextMode}`;if(contextMode==='market_wide')context.query_scope='market_wide'}
      return {...init,body:JSON.stringify({...body,client:body.client||'web',context})};
    }catch{return init}
  }
  function status(text,kind=''){const el=document.getElementById('cxAskStatus');if(!el)return;el.textContent=text;if(kind)el.dataset.kind=kind}
  window.fetch=async function(input,init){
    const url=rewritten(input);if(!url)return nativeFetch(input,init);
    const nextInit=input instanceof Request?init:withCanonicalContext(init),body=requestBody(nextInit);
    const isExternal=String(body?.action||'chat')==='chat'&&externalResearch.test(String(body?.message||body?.question||''));
    if(isExternal)status('Searching external sources…');
    const response=input instanceof Request?await nativeFetch(new Request(url,input),nextInit):await nativeFetch(url,nextInit);
    try{
      const data=await response.clone().json();
      if(/^collectish\.ask\.surface\.v\d+$/.test(String(data?.surface_schema||''))&&Array.isArray(data.surfaces)&&data.surfaces.length)window.__CollectishAskSurfaceQueue.push({schema:data.surface_schema,surfaces:data.surfaces,conversation_id:data.conversation_id||null});
      if(data?.orchestration?.shared_delvin_router)status('Delvin · shared deterministic','ok');
      else if(isExternal&&data?.orchestration?.pass4)status(`Web research · ${data.surfaces?.find?.(s=>s?.type==='external_research')?.source_count||0} sources`,'ok');
      else if(isExternal&&data?.orchestration?.external_research_error)status('Web research failed','bad');
    }catch{if(isExternal)status('Web research finished')}
    return response;
  };
})();