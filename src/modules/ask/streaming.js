import store from '../../state/store.js';
import { beginAskLatencySample } from './latency.js';

// Progressive SSE transport for low-latency Scout card questions. The fast
// path lives in the existing Supabase project; explicit Investigate/tool-heavy
// requests continue through the canonical Ask V3 JSON/tool loop.
(() => {
  if(window.__collectishAskStreamingInstalled)return;
  window.__collectishAskStreamingInstalled=true;
  const cfg=window.COLLECTISH_CONFIG||{};
  const supabaseStream=cfg.supabaseUrl?`${String(cfg.supabaseUrl).replace(/\/$/,'')}/functions/v1/ask-collectish-stream`:'';
  const STREAM_ENDPOINT=String(cfg.askStreamUrl||supabaseStream).trim();
  if(!STREAM_ENDPOINT)return;

  let active=null;
  const num=v=>v==null||v===''?null:Number(v);
  function session(){try{return JSON.parse(localStorage.getItem('collectishSession')||'null')}catch{return null}}
  function messages(){return document.getElementById('cxAskMessages')}
  function status(text,kind=''){const el=document.getElementById('cxAskStatus');if(el){el.textContent=text;el.dataset.kind=kind}}
  function currentContext(){
    const screen=(document.querySelector('.cx-page.active')?.id||'').replace(/^cx/,'').toLowerCase()||'unknown';
    if(screen==='scout'){
      const card=document.querySelector('#cxParityCards .cx-scout-card.selected');
      const sku=card?.dataset?.sku||store.get().scout?.selectedSku||null;
      const row=(store.get().scout?.rows||[]).find(r=>String(r.sku_id)===String(sku))||null;
      const name=row?.product_name||card?.querySelector('.cx-scout-card-body>strong')?.textContent?.trim()||document.querySelector('#cxParityDetail .cx-v5-title .cx-section-title')?.textContent?.trim()||null;
      const href=document.querySelector('#cxParityDetail a[href*="tcgplayer.com/product/"]')?.getAttribute('href')||'';
      const product=row?.product_id||(/\/product\/(\d+)/.exec(href)||[])[1]||null;
      return {screen,sku_id:sku,product_id:product,product_name_hint:name,row};
    }
    const selected=document.querySelector(`#cx${screen[0]?.toUpperCase()||''}${screen.slice(1)} [data-sku].cx-ai-selected`);
    return {screen,sku_id:selected?.dataset?.sku||null,product_id:selected?.dataset?.product||null,row:null};
  }
  function compactScout(row){
    if(!row)return null;
    return {
      name:row.product_name??row.name??null,
      skuId:row.sku_id??null,
      productId:row.product_id??null,
      set:row.set_name??null,
      printing:row.printing??null,
      condition:row.condition??null,
      grade:row.promoted_grade??null,
      score:num(row.promoted_score),
      market:num(row.sku_market_price),
      low:num(row.tcg_low),
      lowWithShipping:num(row.low_with_shipping),
      directLow:num(row.direct_low),
      directAvailable:num(row.direct_available),
      directListings:num(row.direct_listings),
      avgDailyQtySold:num(row.avg_daily_qty_sold),
      salesRank:num(row.sales_rank),
      edhrecRank:num(row.edhrec_rank),
      demandSignal:row.demand_signal??null,
      demandScore:num(row.demand_signal_score),
      demandAdjustment:num(row.demand_adjustment),
      trendAdjustment:num(row.trend_adjustment),
      ckBuylist:num(row.ck_buylist),
      buylistBacked:Boolean(row.buylist_backed),
      buylistRoiPct:num(row.buylist_roi_pct),
      directNet:num(row.direct_net_est),
      confidence:row.confidence_label??null,
      latestScanAt:row.latest_scan_at??null
    };
  }
  function fastPayload(context){
    const cardSnapshot=compactScout(context.row);
    const signalsSnapshot=cardSnapshot?window.CollectishIntelRollups?.getCompactForRow?.(context.row)||null:null;
    return {cardSnapshot,signalsSnapshot};
  }
  function shouldUseFastStream(text,context=currentContext()){
    if(context.screen!=='scout'||!(context.product_id||context.sku_id))return false;
    const q=String(text||'').toLowerCase();
    if(/\b(investigate|purchase list|portfolio|allocate|rebalance|restock|reprice|sync|refresh|seller|order|syp|inventory)\b/.test(q))return false;
    if(/\b(show me|filter|sort|history|trend)\b|what changed|changed since/.test(q))return false;
    return true;
  }
  function userBubble(text){const host=messages();if(!host)return;const w=document.createElement('div');w.className='cx-ask-msg cx-ask-user';const b=document.createElement('div');b.className='cx-ask-msg-body';b.textContent=text;w.append(b);host.append(w);host.scrollTop=host.scrollHeight}
  function assistantBubble(){const host=messages();if(!host)return null;const w=document.createElement('div');w.className='cx-ask-msg cx-ask-assistant cx-ask-streaming';const b=document.createElement('div');b.className='cx-ask-msg-body';b.dataset.md='1';w.append(b);host.append(w);host.scrollTop=host.scrollHeight;document.dispatchEvent(new CustomEvent('collectish:ask-message-rendered',{detail:{role:'assistant',element:b}}));return {w,b}}
  function retryChip(wrapper,retry){if(!wrapper||wrapper.querySelector('.cx-ask-stream-retry'))return;const chip=document.createElement('button');chip.type='button';chip.className='cx-ask-starter cx-ask-stream-retry';chip.textContent='Retry';chip.onclick=e=>{e.preventDefault();e.stopPropagation();chip.remove();retry()};wrapper.append(chip)}
  function parseEvent(block){let event='message';const data=[];for(const raw of block.split('\n')){const line=raw.replace(/\r$/,'');if(line.startsWith('event:'))event=line.slice(6).trim();else if(line.startsWith('data:'))data.push(line.slice(5).trimStart())}if(!data.length)return {event,data:null};const raw=data.join('\n');try{return {event,data:JSON.parse(raw)}}catch{return {event,data:{text:raw}}}}
  async function readSse(response,onEvent,signal){
    if(!response.body)throw Error('Streaming response body unavailable');
    const reader=response.body.getReader(),decoder=new TextDecoder('utf-8');let buffer='',doneEvent=false;
    try{while(true){if(signal?.aborted)throw new DOMException('Aborted','AbortError');const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true}).replace(/\r\n/g,'\n');let split;while((split=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,split);buffer=buffer.slice(split+2);if(!block.trim())continue;const parsed=parseEvent(block);onEvent(parsed);if(parsed.event==='done'){doneEvent=true;return}}}buffer+=decoder.decode();if(buffer.trim()){const parsed=parseEvent(buffer);onEvent(parsed);if(parsed.event==='done')doneEvent=true}if(!doneEvent)throw Error('Ask stream ended before done')}
    finally{try{await reader.cancel()}catch{}reader.releaseLock()}
  }
  async function streamAsk(text){
    const token=session()?.token;if(!token)throw Error('Sign in required');
    active?.controller.abort();
    const controller=new AbortController(),bubble=assistantBubble();if(!bubble)return;
    const renderer=window.CollectishMarkdown?.createStream?.(bubble.b,'');if(!renderer)throw Error('Streaming Markdown renderer unavailable');
    const fullContext=currentContext(),context={screen:fullContext.screen,sku_id:fullContext.sku_id,product_id:fullContext.product_id,product_name_hint:fullContext.product_name_hint},snapshots=fastPayload(fullContext),latency=beginAskLatencySample({screen:context.screen,transport:'supabase-fast'});
    active={controller,bubble,text};status('Streaming · gpt-5-mini…');let meta=null;
    try{
      const response=await fetch(STREAM_ENDPOINT,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Accept':'text/event-stream'},body:JSON.stringify({message:text,context,...snapshots}),signal:controller.signal});
      latency.headers();if(!response.ok)throw Error(`Ask Collectish HTTP ${response.status}`);
      const type=response.headers.get('content-type')||'';if(!type.includes('text/event-stream'))throw Error('Ask endpoint did not return an SSE stream');
      await readSse(response,({event,data})=>{if(event==='meta'){meta=data||{};latency.meta(meta);status('Streaming · gpt-5-mini…',meta.cached?'ok':'')}else if(event==='delta'&&data?.text){latency.delta();renderer.append(data.text)}else if(event==='error')throw Error(data?.message||'Ask stream failed')},controller.signal);
      renderer.close();bubble.w.classList.remove('cx-ask-streaming');const sample=latency.finish();status(`gpt-5-mini · ${sample?.ttftMs??'—'}ms TTFT`,'ok');
    }catch(error){renderer.close();bubble.w.classList.remove('cx-ask-streaming');if(error?.name==='AbortError'){latency.finish({aborted:true});status('Stopped');return}latency.finish({error:true});status('Stream interrupted','bad');retryChip(bubble.w,()=>streamAsk(text).catch(()=>{}));const note=document.createElement('small');note.className='cx-ask-stream-error';note.textContent=error?.message||String(error);if(!bubble.w.querySelector('.cx-ask-stream-error'))bubble.w.append(note);throw error}
    finally{if(active?.controller===controller)active=null}
  }
  function interceptText(target){if(target?.matches?.('#cxAskForm'))return String(document.getElementById('cxAskInput')?.value||'').trim();if(target?.closest?.('.cx-ask-starter')&&!target.closest('.cx-ask-stream-retry'))return String(target.closest('.cx-ask-starter')?.textContent||'').trim();return ''}
  document.addEventListener('submit',e=>{if(!e.target?.matches?.('#cxAskForm'))return;const text=interceptText(e.target),context=currentContext();if(!text||!shouldUseFastStream(text,context))return;e.preventDefault();e.stopImmediatePropagation();const input=document.getElementById('cxAskInput');if(input){input.value='';input.style.height='auto'}userBubble(text);streamAsk(text).catch(()=>{})},true);
  document.addEventListener('click',e=>{const starter=e.target?.closest?.('.cx-ask-starter');if(starter&&!starter.classList.contains('cx-ask-stream-retry')){const text=interceptText(starter),context=currentContext();if(text&&shouldUseFastStream(text,context)){e.preventDefault();e.stopImmediatePropagation();userBubble(text);streamAsk(text).catch(()=>{});return}}if(e.target?.closest?.('[data-ask-close],.cx-ask-close'))active?.controller.abort()},true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')active?.controller.abort()},true);
  window.CollectishAskStreaming={endpoint:STREAM_ENDPOINT,shouldUseFastStream};
})();
