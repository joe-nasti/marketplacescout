import { ASK_PREFETCH_CONFIG } from '../../core/config.js';

let active=null;
const cache=new Map();
const now=()=>Date.now();
const str=v=>v==null?'':String(v);

function session(){try{return JSON.parse(localStorage.getItem('collectishSession')||'null')}catch{return null}}
function endpoint(){return String(window.COLLECTISH_CONFIG?.askStreamUrl||'').trim()}
function fresh(key){const hit=cache.get(key);return Boolean(hit&&now()-hit.at<ASK_PREFETCH_CONFIG.ttlMs)}

export function abortAskPrefetch(){
  if(active){active.abort();active=null}
}

export async function prefetchAskContext({scope='generic',identity='',snapshot=null,context={}}={}){
  if(!ASK_PREFETCH_CONFIG.enabled)return {skipped:'disabled'};
  const url=endpoint();if(!url)return {skipped:'no-endpoint'};
  const token=session()?.token;if(!token)return {skipped:'no-session'};
  const key=`${scope}:${str(identity||snapshot?.name)}`;
  if(!snapshot?.name||!str(identity||snapshot.name))return {skipped:'no-context'};
  if(fresh(key))return {skipped:'fresh'};

  abortAskPrefetch();
  const controller=new AbortController();active=controller;
  try{
    const response=await fetch(url,{
      method:'POST',
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Accept':'text/event-stream'},
      body:JSON.stringify({
        message:'Prepare concise pricing context for likely Ask follow-up.',
        questionType:'prefetch-context',
        cardId:identity||snapshot.name,
        contextType:scope,
        cards:scope==='scout'?[snapshot]:undefined,
        sealed:scope==='sealed'?snapshot:undefined,
        context
      }),
      signal:controller.signal
    });
    if(response.ok)cache.set(key,{at:now(),snapshot});
    if(response.body){const reader=response.body.getReader();try{while(true){const {done}=await reader.read();if(done)break}}finally{reader.releaseLock()}}
    return {ok:response.ok,status:response.status};
  }catch(error){
    if(error?.name==='AbortError')return {aborted:true};
    return {ok:false,error:error?.message||String(error)};
  }finally{if(active===controller)active=null}
}

export function getAskPrefetchState(){return {enabled:ASK_PREFETCH_CONFIG.enabled,active:Boolean(active),cacheSize:cache.size}}

window.CollectishAskPrefetch={prefetch:prefetchAskContext,abort:abortAskPrefetch,config:ASK_PREFETCH_CONFIG,state:getAskPrefetchState};
