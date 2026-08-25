import store from '../../state/store.js';
import { ASK_PREFETCH_CONFIG } from '../../core/config.js';

let active=null;
const cache=new Map();
const now=()=>Date.now();
const str=v=>v==null?'':String(v);
const num=v=>v==null||v===''?null:Number(v);

function session(){try{return JSON.parse(localStorage.getItem('collectishSession')||'null')}catch{return null}}
function endpoint(){return String(window.COLLECTISH_CONFIG?.askStreamUrl||'').trim()}
function rowFor(detail={}){
  const sku=str(detail.sku_id??detail.sku);
  const rows=store.get().scout?.rows||[];
  return rows.find(r=>str(r.sku_id)===sku)||detail;
}
function compact(row={}){
  return {
    name:row.name??row.product_name??row.card_name??row.product_name_hint??null,
    low:num(row.low??row.tcg_low??row.tcg_low_price??row.sku_low_price),
    direct:num(row.direct??row.directLow??row.direct_low??row.tcg_direct_low??row.direct_low_price),
    spread:num(row.spread??row.directMultiplier??row.direct_multiplier),
    ckBuylist:num(row.ckBuylist??row.ck_buylist??row.cardkingdom_buylist??row.card_kingdom_buylist)
  };
}
function keyFor(row={}){return str(row.product_id??row.sku_id??row.name??row.product_name??row.card_name)}
function fresh(key){const hit=cache.get(key);return Boolean(hit&&now()-hit.at<ASK_PREFETCH_CONFIG.ttlMs)}
function abortActive(){if(active){active.abort();active=null}}

export async function prefetchAskCardContext(detail={}){
  if(!ASK_PREFETCH_CONFIG.enabled)return {skipped:'disabled'};
  const url=endpoint();if(!url)return {skipped:'no-endpoint'};
  const token=session()?.token;if(!token)return {skipped:'no-session'};
  const row=rowFor(detail),card=compact(row),key=keyFor(row);
  if(!key||!card.name)return {skipped:'no-card'};
  if(fresh(key))return {skipped:'fresh'};

  abortActive();
  const controller=new AbortController();active=controller;
  try{
    const response=await fetch(url,{
      method:'POST',
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Accept':'text/event-stream'},
      body:JSON.stringify({
        message:'Prepare concise pricing context for likely Ask follow-up.',
        questionType:'prefetch-context',
        cardId:row.product_id??row.sku_id??key,
        cards:[card],
        context:{screen:'scout',product_id:row.product_id??null,sku_id:row.sku_id??null}
      }),
      signal:controller.signal
    });
    if(response.ok)cache.set(key,{at:now(),card});
    // We only need to establish/warm the request path; drain quietly so the
    // browser can reuse the connection without rendering speculative output.
    if(response.body){const reader=response.body.getReader();try{while(true){const {done}=await reader.read();if(done)break}}finally{reader.releaseLock()}}
    return {ok:response.ok,status:response.status};
  }catch(error){
    if(error?.name==='AbortError')return {aborted:true};
    return {ok:false,error:error?.message||String(error)};
  }finally{if(active===controller)active=null}
}

export function abortAskCardPrefetch(){abortActive()}

function onOpen(e){void prefetchAskCardContext(e.detail||{})}
function onClick(e){
  if(e.target?.closest?.('[data-detail-close],.cx-detail-close,.cx-modal-close,.cx-detail-backdrop,[data-ask-close]'))abortActive();
}
function onKey(e){if(e.key==='Escape')abortActive()}
function onPage(){abortActive()}

document.addEventListener('collectish:open-scout-card',onOpen);
document.addEventListener('click',onClick,true);
document.addEventListener('keydown',onKey,true);
document.addEventListener('collectish:page-changed',onPage);

window.CollectishAskPrefetch={prefetch:prefetchAskCardContext,abort:abortAskCardPrefetch,config:ASK_PREFETCH_CONFIG};
