// Progressive SSE transport for Ask Collectish chat responses.
// Uses an explicit COLLECTISH_CONFIG.askStreamUrl when provided. On a custom
// Collectish origin it can also use the canonical same-origin /api route. The
// existing Supabase Ask flow remains the fallback for health, diagnostics,
// investigate, tools and rich surfaces.
(() => {
  if(window.__collectishAskStreamingInstalled)return;
  window.__collectishAskStreamingInstalled=true;
  const cfg=window.COLLECTISH_CONFIG||{};
  const sameOriginEligible=location.protocol==='https:'&&!location.hostname.endsWith('github.io');
  const STREAM_ENDPOINT=String(cfg.askStreamUrl||(sameOriginEligible?new URL('/api/ask-collectish',location.origin).href:'')).trim();
  if(!STREAM_ENDPOINT)return;

  let active=null;
  function session(){try{return JSON.parse(localStorage.getItem('collectishSession')||'null')}catch{return null}}
  function messages(){return document.getElementById('cxAskMessages')}
  function status(text,kind=''){const el=document.getElementById('cxAskStatus');if(el){el.textContent=text;el.dataset.kind=kind}}
  function currentContext(){
    const screen=(document.querySelector('.cx-page.active')?.id||'').replace(/^cx/,'').toLowerCase()||'unknown';
    if(screen==='scout'){
      const card=document.querySelector('#cxParityCards .cx-scout-card.selected');
      const sku=card?.dataset?.sku||null;
      const name=card?.querySelector('.cx-scout-card-body>strong')?.textContent?.trim()||document.querySelector('#cxParityDetail .cx-v5-title .cx-section-title')?.textContent?.trim()||null;
      const href=document.querySelector('#cxParityDetail a[href*="tcgplayer.com/product/"]')?.getAttribute('href')||'';
      const product=(/\/product\/(\d+)/.exec(href)||[])[1]||null;
      return {screen,sku_id:sku,product_id:product,product_name_hint:name};
    }
    const selected=document.querySelector(`#cx${screen[0]?.toUpperCase()||''}${screen.slice(1)} [data-sku].cx-ai-selected`);
    return {screen,sku_id:selected?.dataset?.sku||null,product_id:selected?.dataset?.product||null};
  }
  function userBubble(text){
    const host=messages();if(!host)return;
    const w=document.createElement('div');w.className='cx-ask-msg cx-ask-user';
    const b=document.createElement('div');b.className='cx-ask-msg-body';b.textContent=text;w.append(b);host.append(w);host.scrollTop=host.scrollHeight;
  }
  function assistantBubble(){
    const host=messages();if(!host)return null;
    const w=document.createElement('div');w.className='cx-ask-msg cx-ask-assistant cx-ask-streaming';
    const b=document.createElement('div');b.className='cx-ask-msg-body';b.dataset.md='1';w.append(b);host.append(w);host.scrollTop=host.scrollHeight;
    document.dispatchEvent(new CustomEvent('collectish:ask-message-rendered',{detail:{role:'assistant',element:b}}));
    return {w,b};
  }
  function retryChip(wrapper,retry){
    if(!wrapper||wrapper.querySelector('.cx-ask-stream-retry'))return;
    const chip=document.createElement('button');chip.type='button';chip.className='cx-ask-starter cx-ask-stream-retry';chip.textContent='Retry';
    chip.onclick=e=>{e.preventDefault();e.stopPropagation();chip.remove();retry()};wrapper.append(chip);
  }
  function parseEvent(block){
    let event='message';const data=[];
    for(const raw of block.split('\n')){
      const line=raw.replace(/\r$/,'');
      if(line.startsWith('event:'))event=line.slice(6).trim();
      else if(line.startsWith('data:'))data.push(line.slice(5).trimStart());
    }
    if(!data.length)return {event,data:null};
    const raw=data.join('\n');
    try{return {event,data:JSON.parse(raw)}}catch{return {event,data:{text:raw}}}
  }
  async function readSse(response,onEvent,signal){
    if(!response.body)throw Error('Streaming response body unavailable');
    const reader=response.body.getReader(),decoder=new TextDecoder('utf-8');let buffer='',doneEvent=false;
    try{
      while(true){
        if(signal?.aborted)throw new DOMException('Aborted','AbortError');
        const {value,done}=await reader.read();
        if(done)break;
        buffer+=decoder.decode(value,{stream:true}).replace(/\r\n/g,'\n');
        let split;
        while((split=buffer.indexOf('\n\n'))>=0){
          const block=buffer.slice(0,split);buffer=buffer.slice(split+2);if(!block.trim())continue;
          const parsed=parseEvent(block);onEvent(parsed);if(parsed.event==='done'){doneEvent=true;return}
        }
      }
      buffer+=decoder.decode();
      if(buffer.trim()){const parsed=parseEvent(buffer);onEvent(parsed);if(parsed.event==='done')doneEvent=true}
      if(!doneEvent)throw Error('Ask stream ended before done');
    }finally{try{await reader.cancel()}catch{}reader.releaseLock()}
  }
  async function streamAsk(text){
    const token=session()?.token;if(!token)throw Error('Sign in required');
    active?.controller.abort();
    const controller=new AbortController();
    const bubble=assistantBubble();if(!bubble)return;
    const renderer=window.CollectishMarkdown?.createStream?.(bubble.b,'');
    if(!renderer)throw Error('Streaming Markdown renderer unavailable');
    active={controller,bubble,text};status('Streaming…');
    let meta=null;
    try{
      const response=await fetch(STREAM_ENDPOINT,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Accept':'text/event-stream'},body:JSON.stringify({message:text,context:currentContext()}),signal:controller.signal});
      if(!response.ok)throw Error(`Ask Collectish HTTP ${response.status}`);
      const type=response.headers.get('content-type')||'';if(!type.includes('text/event-stream'))throw Error('Ask endpoint did not return an SSE stream');
      await readSse(response,({event,data})=>{
        if(event==='meta'){meta=data||{};status(meta.cached?'Cached answer':'Streaming…',meta.cached?'ok':'')}
        else if(event==='delta'&&data?.text)renderer.append(data.text);
        else if(event==='error')throw Error(data?.message||'Ask stream failed');
      },controller.signal);
      renderer.close();bubble.w.classList.remove('cx-ask-streaming');
      status(meta?.cached?'Cached · complete':'Complete','ok');
    }catch(error){
      renderer.close();bubble.w.classList.remove('cx-ask-streaming');
      if(error?.name==='AbortError'){status('Stopped');return}
      status('Stream interrupted','bad');
      retryChip(bubble.w,()=>streamAsk(text).catch(()=>{}));
      const note=document.createElement('small');note.className='cx-ask-stream-error';note.textContent=error?.message||String(error);if(!bubble.w.querySelector('.cx-ask-stream-error'))bubble.w.append(note);
      throw error;
    }finally{if(active?.controller===controller)active=null}
  }
  function interceptText(target){
    if(target?.matches?.('#cxAskForm'))return String(document.getElementById('cxAskInput')?.value||'').trim();
    if(target?.closest?.('.cx-ask-starter')&&!target.closest('.cx-ask-stream-retry'))return String(target.closest('.cx-ask-starter')?.textContent||'').trim();
    return '';
  }
  document.addEventListener('submit',e=>{
    if(!e.target?.matches?.('#cxAskForm'))return;
    const text=interceptText(e.target);if(!text)return;
    e.preventDefault();e.stopImmediatePropagation();
    const input=document.getElementById('cxAskInput');if(input){input.value='';input.style.height='auto'}
    userBubble(text);streamAsk(text).catch(()=>{});
  },true);
  document.addEventListener('click',e=>{
    const starter=e.target?.closest?.('.cx-ask-starter');
    if(starter&&!starter.classList.contains('cx-ask-stream-retry')){
      const text=interceptText(starter);if(text){e.preventDefault();e.stopImmediatePropagation();userBubble(text);streamAsk(text).catch(()=>{});return}
    }
    if(e.target?.closest?.('[data-ask-close],.cx-ask-close'))active?.controller.abort();
  },true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')active?.controller.abort()},true);
})();