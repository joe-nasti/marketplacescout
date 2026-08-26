import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const O=Deno.env.get('OPENAI_API_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const SSE={...C,'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'};
const enc=new TextEncoder();
const evt=(name:string,data:any)=>enc.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
const clip=(v:any,n=9000)=>{const s=typeof v==='string'?v:JSON.stringify(v);return s.length>n?s.slice(0,n)+'…':s};
function tok(r:Request){const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''}
const uh=(t:string)=>({apikey:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});
async function user(t:string){const r=await fetch(`${U}/auth/v1/user`,{headers:{apikey:A,Authorization:`Bearer ${t}`}});if(!r.ok)throw Error('Unauthorized');const x=await r.json();if(!x?.id)throw Error('Unauthorized');return x}
async function rpc(t:string,n:string,a:any={}){const r=await fetch(`${U}/rest/v1/rpc/${n}`,{method:'POST',headers:uh(t),body:JSON.stringify(a)});const q=await r.text();let d:any;try{d=q?JSON.parse(q):null}catch{d=q}if(!r.ok)throw Error(d?.message||`${n} failed (${r.status})`);return d}
function supported(q:string,ctx:any){if(String(ctx?.screen||'').toLowerCase()!=='scout')return false;if(!(ctx?.product_id||ctx?.sku_id))return false;const x=q.toLowerCase();if(/\b(investigate|purchase list|portfolio|allocate|rebalance|restock|reprice|sync|refresh|seller|order|syp|inventory)\b/.test(x))return false;if(/\b(show me|filter|sort|history|trend)\b|what changed|changed since/.test(x))return false;return true}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return new Response(JSON.stringify({error:'POST required'}),{status:405,headers:{...C,'Content-Type':'application/json'}});
  const t=tok(req);if(!t)return new Response(JSON.stringify({error:'Authentication required'}),{status:401,headers:{...C,'Content-Type':'application/json'}});
  try{await user(t)}catch{return new Response(JSON.stringify({error:'Authentication required'}),{status:401,headers:{...C,'Content-Type':'application/json'}})}
  let b:any={};try{b=await req.json()}catch{return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:{...C,'Content-Type':'application/json'}})}
  const q=String(b.message||'').trim(),ctx=b.context||{};
  if(!q)return new Response(JSON.stringify({error:'Message required'}),{status:400,headers:{...C,'Content-Type':'application/json'}});
  if(!supported(q,ctx))return new Response(JSON.stringify({fallback:true,reason:'tool-loop-required'}),{status:409,headers:{...C,'Content-Type':'application/json'}});
  if(!O)return new Response(JSON.stringify({error:'OPENAI_API_KEY not configured'}),{status:503,headers:{...C,'Content-Type':'application/json'}});

  const clientCard=b.cardSnapshot&&typeof b.cardSnapshot==='object'?b.cardSnapshot:null;
  const signals=b.signalsSnapshot&&typeof b.signalsSnapshot==='object'?b.signalsSnapshot:null;
  const clientPref=b.preferencesSnapshot&&typeof b.preferencesSnapshot==='object'?b.preferencesSnapshot:null;
  let card:any=clientCard,pref:any=clientPref,contextSource=clientCard?'browser-cache':'server-rpc',preferencesSource=clientPref?'browser-cache':'server-rpc';
  try{
    const jobs=[] as Promise<any>[];
    if(!clientCard)jobs.push(rpc(t,'ask_collectish_get_scout_card',{p_product_id:ctx.product_id??null,p_sku_id:ctx.sku_id??null}).then(x=>card=x));
    if(!clientPref)jobs.push(rpc(t,'ask_collectish_get_preferences',{}).then(x=>pref=x).catch(()=>{pref=null}));
    if(jobs.length)await Promise.all(jobs);
  }catch(e){return new Response(JSON.stringify({error:String((e as Error).message)}),{status:502,headers:{...C,'Content-Type':'application/json'}})}

  const body={model:'gpt-5-mini',stream:true,max_completion_tokens:350,reasoning_effort:'minimal',messages:[
    {role:'system',content:'You are Ask Collectish fast mode. Answer only from the supplied Collectish Scout and Signals context. Be concise and decision-oriented. Never invent missing metrics. Scout pricing, demand, supply, velocity, EDHREC and buylist data are primary evidence. Signals intelligence is corroborating context only: use independent-source count, claims, timing and direction to widen confidence, but never let Signals override hard Scout economics by itself. For buy questions give BUY/WATCH/PASS, the main reason, key risk, and grounded entry/exit only when supported.'},
    {role:'user',content:`QUESTION:\n${q}\n\nSCOUT_CONTEXT:\n${clip(card)}\n\nSIGNALS_CONTEXT:\n${clip(signals,2500)}\n\nUSER_PREFERENCES:\n${clip(pref,2500)}`}
  ]};

  const upstream=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${O}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!upstream.ok||!upstream.body){const text=await upstream.text();return new Response(JSON.stringify({error:`OpenAI ${upstream.status}: ${text.slice(0,400)}`}),{status:502,headers:{...C,'Content-Type':'application/json'}})}

  const stream=new ReadableStream({
    async start(controller){
      const reader=upstream.body!.getReader(),decoder=new TextDecoder();let buffer='',started=false;
      controller.enqueue(evt('meta',{model:'gpt-5-mini',cached:false,mode:'supabase-fast',context_screen:'scout',context_source:contextSource,signals:Boolean(signals),preferences_source:preferencesSource}));
      try{
        while(true){
          const {value,done}=await reader.read();if(done)break;
          buffer+=decoder.decode(value,{stream:true});let idx;
          while((idx=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,idx);buffer=buffer.slice(idx+2);for(const line of block.split('\n')){if(!line.startsWith('data:'))continue;const raw=line.slice(5).trim();if(!raw||raw==='[DONE]')continue;let j:any;try{j=JSON.parse(raw)}catch{continue}const text=j?.choices?.[0]?.delta?.content;if(text){started=true;controller.enqueue(evt('delta',{text}))}}}
        }
        controller.enqueue(evt('done',{ok:true,started}));controller.close();
      }catch(e){controller.enqueue(evt('error',{message:String((e as Error).message)}));controller.close()}
      finally{try{reader.releaseLock()}catch{}}
    },
    cancel(){try{upstream.body?.cancel()}catch{}}
  });
  return new Response(stream,{headers:SSE});
});
