// Cloudflare HTTP worker for low-latency Ask Collectish responses.
// Required secret: OPENAI_API_KEY
// Optional KV binding: ASK_CACHE (falls back to isolate-local memory cache).

const OPENAI_URL='https://api.openai.com/v1/chat/completions';
const CACHE_TTL_MS=30*60*1000;
const memoryCache=new Map();
const encoder=new TextEncoder();
const decoder=new TextDecoder();

const SSE_HEADERS={
  'Content-Type':'text/event-stream',
  'Cache-Control':'no-cache',
  'Connection':'keep-alive',
  'X-Accel-Buffering':'no',
};
const JSON_HEADERS={'Content-Type':'application/json'};
const RAW_ARRAY_KEYS=new Set([
  'listings','rawListings','raw_listings','sellerListings','seller_listings','marketplaceListings','marketplace_listings',
  'offers','rawOffers','raw_offers','sales','rawSales','raw_sales','priceLadder','price_ladder','ladder','inventoryRows','inventory_rows'
]);

const cleanText=(value,max=1200)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const finite=value=>Number.isFinite(Number(value))?Number(value):null;
const pick=(obj,...keys)=>{for(const key of keys){if(obj?.[key]!==undefined&&obj?.[key]!==null)return obj[key]}return null};

export function compactCard(card={}){
  return {
    name:cleanText(pick(card,'name','product_name','productName'),180),
    low:finite(pick(card,'low','tcg_low','tcgLow','low_with_shipping')),
    direct:finite(pick(card,'directLow','direct_low','direct')),
    spread:finite(pick(card,'directMultiplier','direct_multiplier','spread','directSpread')),
    ckBuylist:finite(pick(card,'ckBuylist','ck_buylist','cardKingdomBuylist')),
  };
}
function looksLikeCard(value){
  return value&&typeof value==='object'&&!Array.isArray(value)&&Boolean(pick(value,'name','product_name','productName','card_id','cardId','product_id','productId'));
}
function collectCards(body){
  const sources=[body?.cards,body?.context?.cards,body?.context?.opportunities,body?.context?.products,body?.card,body?.context?.card];
  const found=[];
  for(const source of sources){
    if(Array.isArray(source)){for(const item of source){if(looksLikeCard(item))found.push(compactCard(item));if(found.length>=20)break}}
    else if(looksLikeCard(source))found.push(compactCard(source));
    if(found.length>=20)break;
  }
  return found.filter(card=>card.name||card.low!==null||card.direct!==null);
}
function prune(value,depth=0){
  if(depth>4)return undefined;
  if(value==null||typeof value==='number'||typeof value==='boolean')return value;
  if(typeof value==='string')return cleanText(value,500);
  if(Array.isArray(value)){
    if(value.length>12)return {count:value.length,omitted:true};
    return value.slice(0,12).map(item=>prune(item,depth+1)).filter(item=>item!==undefined);
  }
  if(typeof value==='object'){
    const out={};
    for(const [key,item] of Object.entries(value)){
      if(RAW_ARRAY_KEYS.has(key)&&Array.isArray(item)){out[`${key}Count`]=item.length;continue}
      if(['cards','opportunities','products','card'].includes(key))continue;
      const next=prune(item,depth+1);if(next!==undefined)out[key]=next;
    }
    return out;
  }
  return undefined;
}
export function compressRequest(body={}){
  const cards=collectCards(body);
  const context=prune(body.context||{});
  const conversation=(Array.isArray(body.conversation)?body.conversation:[])
    .slice(-2)
    .map(turn=>({role:['assistant','user'].includes(turn?.role)?turn.role:'user',content:cleanText(turn?.content||turn?.text,1200)}))
    .filter(turn=>turn.content);
  return {cards,context,conversation};
}
function cardIdentity(body,compressed){
  return cleanText(pick(body,'cardId','card_id','productId','product_id','skuId','sku_id',body?.context?.cardId,body?.context?.productId)||compressed.cards?.[0]?.name||'general',160);
}
function questionKind(body){
  return cleanText(pick(body,'questionType','question_type','intent','surface')||body?.message||body?.question||'general',240).toLowerCase();
}
async function sha256(text){
  const bytes=await crypto.subtle.digest('SHA-256',encoder.encode(text));
  return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function queryCacheKey(body,compressed=compressRequest(body)){
  const scope=cleanText(pick(body,'userId','user_id')||'shared',120);
  return `ask:v1:${await sha256(`${scope}|${cardIdentity(body,compressed)}|${questionKind(body)}`)}`;
}
function promptContext(compressed){
  const payload={cards:compressed.cards};
  if(compressed.context&&Object.keys(compressed.context).length)payload.context=compressed.context;
  return JSON.stringify(payload);
}
export function buildOpenAIRequest(body,compressed=compressRequest(body)){
  const question=cleanText(body?.message||body?.question,2000);
  const messages=[
    {role:'system',content:'You are Ask Collectish, a concise MTG market decision assistant. Answer from the supplied compact pricing context. Prioritize actionable price/spread/exit information, state uncertainty briefly, and do not invent missing prices.'},
    ...compressed.conversation,
    {role:'user',content:`Question: ${question}\nCompact market context: ${promptContext(compressed)}`},
  ];
  return {
    model:'gpt-5-mini',
    stream:true,
    max_completion_tokens:350,
    reasoning_effort:'minimal',
    messages,
  };
}
function sse(event,data){return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`}
function streamCached(text,key){
  return new ReadableStream({start(controller){
    controller.enqueue(encoder.encode(sse('meta',{cached:true,key})));
    controller.enqueue(encoder.encode(sse('delta',{text})));
    controller.enqueue(encoder.encode(sse('done',{cached:true})));
    controller.close();
  }});
}
async function cacheGet(env,key){
  const now=Date.now();
  if(env?.ASK_CACHE?.get){
    try{const hit=await env.ASK_CACHE.get(key,{type:'json'});if(hit?.text&&now-Number(hit.createdAt||0)<CACHE_TTL_MS)return hit.text}catch{}
  }
  const local=memoryCache.get(key);
  if(local&&now-local.createdAt<CACHE_TTL_MS)return local.text;
  if(local)memoryCache.delete(key);
  return null;
}
async function cachePut(env,key,text){
  if(!text)return;
  const value={createdAt:Date.now(),text};
  memoryCache.set(key,value);
  if(memoryCache.size>128){const first=memoryCache.keys().next().value;memoryCache.delete(first)}
  if(env?.ASK_CACHE?.put){try{await env.ASK_CACHE.put(key,JSON.stringify(value),{expirationTtl:1800})}catch{}}
}
function corsHeaders(request){
  const origin=request.headers.get('Origin');
  return origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS'}:{};
}
function parseOpenAIBlock(block){
  for(const line of block.split('\n')){
    if(!line.startsWith('data:'))continue;
    const data=line.slice(5).trim();
    if(!data||data==='[DONE]')continue;
    try{const json=JSON.parse(data);const text=json?.choices?.[0]?.delta?.content;if(typeof text==='string'&&text)return text}catch{}
  }
  return '';
}
async function openAIStream(body,env,key,ctx){
  if(!env?.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY is not configured');
  const compressed=compressRequest(body);
  const payload=buildOpenAIRequest(body,compressed);
  const upstream=await fetch(OPENAI_URL,{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json','Accept':'text/event-stream'},body:JSON.stringify(payload)});
  if(!upstream.ok){const detail=(await upstream.text()).slice(0,500);throw new Error(`OpenAI HTTP ${upstream.status}: ${detail}`)}
  if(!upstream.body)throw new Error('OpenAI response had no stream body');

  let full='';let buffer='';
  return new ReadableStream({
    async start(controller){
      controller.enqueue(encoder.encode(sse('meta',{cached:false,key})));
      const reader=upstream.body.getReader();
      try{
        while(true){
          const {done,value}=await reader.read();if(done)break;
          buffer+=decoder.decode(value,{stream:true}).replace(/\r\n/g,'\n');
          let boundary;
          while((boundary=buffer.indexOf('\n\n'))>=0){
            const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
            const text=parseOpenAIBlock(block);
            if(text){full+=text;controller.enqueue(encoder.encode(sse('delta',{text})))}
          }
        }
        buffer+=decoder.decode();
        const tail=parseOpenAIBlock(buffer);if(tail){full+=tail;controller.enqueue(encoder.encode(sse('delta',{text:tail})))}
        controller.enqueue(encoder.encode(sse('done',{cached:false})));
        controller.close();
        const job=cachePut(env,key,full);if(ctx?.waitUntil)ctx.waitUntil(job);else await job;
      }catch(error){
        controller.enqueue(encoder.encode(sse('error',{message:String(error?.message||error).slice(0,300)})));
        controller.close();
      }finally{reader.releaseLock()}
    }
  });
}

export async function handleAskCollectish(request,env={},ctx={}){
  const cors=corsHeaders(request);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  const url=new URL(request.url);
  if(url.pathname!=='/api/ask-collectish')return new Response('Not found',{status:404});
  if(request.method!=='POST')return new Response(JSON.stringify({error:'POST required'}),{status:405,headers:{...JSON_HEADERS,...cors}});
  let body;try{body=await request.json()}catch{return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:{...JSON_HEADERS,...cors}})}
  const question=cleanText(body?.message||body?.question,2000);if(!question)return new Response(JSON.stringify({error:'message is required'}),{status:400,headers:{...JSON_HEADERS,...cors}});
  const compressed=compressRequest(body);const key=await queryCacheKey(body,compressed);const cached=await cacheGet(env,key);
  try{
    const stream=cached!==null?streamCached(cached,key):await openAIStream(body,env,key,ctx);
    return new Response(stream,{status:200,headers:{...SSE_HEADERS,...cors}});
  }catch(error){
    const stream=streamCached(`Ask Collectish is temporarily unavailable. ${String(error?.message||error).slice(0,180)}`,key);
    return new Response(stream,{status:502,headers:{...SSE_HEADERS,...cors}});
  }
}

export default {fetch:handleAskCollectish};
