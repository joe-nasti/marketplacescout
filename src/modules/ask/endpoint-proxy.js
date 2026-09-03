// Narrow transport bridge for Ask Collectish structured surfaces.
// Rewrites the legacy Ask endpoint to the stable client-neutral API facade and
// short-circuits shared Delvin deterministic queries before the general LLM path.
(() => {
  if(window.__collectishAskEndpointProxyInstalled)return;
  window.__collectishAskEndpointProxyInstalled=true;
  window.__CollectishAskSurfaceQueue=window.__CollectishAskSurfaceQueue||[];
  const nativeFetch=window.fetch.bind(window);
  const externalResearch=/search (?:the )?web|research externally|look online|external research|latest (?:news|articles|discussion)|web research|search online|find (?:recent )?(?:news|articles|discussion)/i;
  const explicitCardTarget=q=>{
    const text=String(q||'');
    return /\b[A-Z0-9]{2,8}\s*#\s*[A-Za-z0-9-]+\b/.test(text)
      || /\b(?:sku|product(?:\s*id)?)\s*(?:#|:)?\s*\d+\b/i.test(text)
      || /tcgplayer\.com\/product\/\d+/i.test(text);
  };

  function rewritten(input){
    const raw=input instanceof Request?input.url:String(input||'');
    try{
      const u=new URL(raw,location.href);
      if(!u.pathname.endsWith('/functions/v1/ask-collectish'))return null;
      u.pathname=u.pathname.replace(/\/ask-collectish$/,'/ask-collectish-api');
      return u.toString();
    }catch{return null}
  }

  function rpcUrl(input){
    const raw=input instanceof Request?input.url:String(input||'');
    try{
      const u=new URL(raw,location.href);
      if(!u.pathname.includes('/functions/v1/'))return null;
      u.pathname='/rest/v1/rpc/resolve_delvin_shared_query_v1';
      u.search='';
      return u.toString();
    }catch{return null}
  }

  function requestBody(init={}){try{return init?.body&&typeof init.body==='string'?JSON.parse(init.body):null}catch{return null}}
  function withCanonicalContext(init={}){
    if(!init?.body||typeof init.body!=='string')return init;
    try{
      const body=JSON.parse(init.body);
      if(String(body?.action||'chat')!=='chat')return init;
      const canonical=window.CollectishContext?.legacy?.();
      if(!canonical)return init;
      const prompt=String(body?.message||body?.question||'');
      const supplied=body.context||{};
      const context={...canonical,...supplied,entity:canonical.entity,view:canonical.view};
      if(explicitCardTarget(prompt)){
        context.entity=null;
        context.sku_id=null;
        context.product_id=null;
        context.product_name_hint=null;
        context.set_name=null;
        context.entity_context_mode='fallback_suppressed_explicit_target';
      }
      return {...init,body:JSON.stringify({...body,client:body.client||'web',context})};
    }catch{return init}
  }
  function status(text,kind=''){
    const el=document.getElementById('cxAskStatus');if(!el)return;
    el.textContent=text;if(kind)el.dataset.kind=kind;
  }
  const num=(v,d=1)=>Number.isFinite(Number(v))?Number(v).toFixed(d):null;
  const money=v=>Number.isFinite(Number(v))?`$${Number(v).toFixed(2)}`:null;
  function sharedRows(r){
    if(Array.isArray(r?.payload?.payload?.rows))return r.payload.payload.rows;
    if(Array.isArray(r?.payload?.payload?.early_movers))return r.payload.payload.early_movers;
    if(Array.isArray(r?.payload?.rows))return r.payload.rows;
    return [];
  }
  function rowLabel(x){
    const name=x?.card_name||x?.product_name||x?.set_code||x?.set_name||'Signal';
    const bits=[];
    if(x?.set_code&&name!==x.set_code)bits.push(x.set_code);
    if(x?.printing)bits.push(x.printing);
    if(x?.evidence_tier)bits.push(x.evidence_tier);
    if(x?.radar_score!=null)bits.push(`radar ${num(x.radar_score)}`);
    else if(x?.cohort_score!=null)bits.push(`cohort ${num(x.cohort_score)}`);
    else if(x?.importance_score!=null)bits.push(`importance ${num(x.importance_score)}`);
    else if(x?.pressure_score!=null)bits.push(`pressure ${num(x.pressure_score)}`);
    else if(x?.demand_score!=null)bits.push(`demand ${num(x.demand_score)}`);
    if(x?.pct_change!=null)bits.push(`${Number(x.pct_change)>=0?'+':''}${num(x.pct_change)}%`);
    if(x?.avg_daily_qty_sold!=null)bits.push(`${num(x.avg_daily_qty_sold)} / day`);
    if(x?.sales_day!=null)bits.push(`${num(x.sales_day)} / day cohort`);
    if(x?.median_market!=null)bits.push(`median ${money(x.median_market)}`);
    return `${name}${bits.length?` · ${bits.join(' · ')}`:''}`;
  }
  function sharedAnswer(r){
    const rows=sharedRows(r).slice(0,8);
    const title=r?.prompt||({collectible_family_index:`${r?.treatment||'Collectible'} across sets`,set_intelligence:`${r?.set_code||'Set'} intelligence`,set_treatment_intelligence:`${r?.set_code||'Set'} · ${r?.treatment||'treatment'}`,printing_family:`${r?.card_name||'Card'} printing family`,card_investigation:`${r?.card_name||'Card'} investigation`}[r?.route])||'Delvin deterministic result';
    if(!rows.length)return `${title}. Delvin resolved this through the shared deterministic query layer; structured evidence is attached below.`;
    return `${title}\n${rows.map((x,i)=>`${i+1}. ${rowLabel(x)}`).join('\n')}`;
  }
  async function maybeShared(input,init,body){
    if(input instanceof Request||String(body?.action||'chat')!=='chat')return null;
    const question=String(body?.message||body?.question||'').trim();if(!question)return null;
    const url=rpcUrl(input);if(!url)return null;
    const headers={...(init?.headers||{}),'Content-Type':'application/json'};
    try{
      const r=await nativeFetch(url,{method:'POST',headers,body:JSON.stringify({p_question:question,p_limit:30})});
      if(!r.ok)return null;
      const data=await r.json();if(!data?.handled)return null;
      const surface={type:data.surface_type||'delvin_query',domain:'collectish',title:data.prompt||'Delvin',route:data.route,query_key:data.query_key||null,data};
      window.__CollectishAskSurfaceQueue.push({schema:'collectish.ask.surface.v10',surfaces:[surface],conversation_id:body?.conversation_id||null});
      status('Delvin · deterministic','ok');
      return new Response(JSON.stringify({
        api_schema:'collectish.ask.api.v1',client:body?.client||'web',session_id:body?.conversation_id||null,conversation_id:body?.conversation_id||null,
        response:sharedAnswer(data),model:null,usage:null,tools:[{name:'resolve_delvin_shared_query_v1',ok:true,classification:'READ'}],
        surface_schema:'collectish.ask.surface.v10',surfaces:[surface],orchestration:{deterministic_route:data.route,shared_delvin_router:true}
      }),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    }catch{return null}
  }

  window.fetch=async function(input,init){
    const url=rewritten(input);
    if(!url)return nativeFetch(input,init);
    const nextInit=input instanceof Request?init:withCanonicalContext(init);
    const body=requestBody(nextInit);
    const shared=await maybeShared(input,nextInit,body);
    if(shared)return shared;
    const isExternal=String(body?.action||'chat')==='chat'&&externalResearch.test(String(body?.message||body?.question||''));
    if(isExternal)status('Searching external sources…');
    const response=input instanceof Request
      ? await nativeFetch(new Request(url,input),nextInit)
      : await nativeFetch(url,nextInit);
    try{
      const data=await response.clone().json();
      if(/^collectish\.ask\.surface\.v\d+$/.test(String(data?.surface_schema||''))&&Array.isArray(data.surfaces)&&data.surfaces.length){
        window.__CollectishAskSurfaceQueue.push({schema:data.surface_schema,surfaces:data.surfaces,conversation_id:data.conversation_id||null});
      }
      if(isExternal&&data?.orchestration?.pass4)status(`Web research · ${data.surfaces?.find?.(s=>s?.type==='external_research')?.source_count||0} sources`,'ok');
      else if(isExternal&&data?.orchestration?.external_research_error)status('Web research failed','bad');
    }catch{if(isExternal)status('Web research finished')}
    return response;
  };
})();