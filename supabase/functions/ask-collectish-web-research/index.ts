import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const O=Deno.env.get('OPENAI_API_KEY')||'';
const MODEL=Deno.env.get('ASK_WEB_MODEL')||'gpt-5-mini';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const js=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const tok=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const uh=(t:string)=>({apikey:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});
async function user(t:string){const r=await fetch(`${U}/auth/v1/user`,{headers:{apikey:A,Authorization:`Bearer ${t}`}});if(!r.ok)throw Error('Unauthorized');const x=await r.json();if(!x?.id)throw Error('Unauthorized');return x}
function clip(v:any,n=9000){const s=typeof v==='string'?v:JSON.stringify(v??{});return s.length>n?s.slice(0,n)+'…':s}
function outputText(r:any){const a:string[]=[];for(const x of r?.output||[])if(x?.type==='message')for(const c of x.content||[])if(c?.type==='output_text'&&c.text)a.push(c.text);return a.join('\n').trim()}
function sources(r:any){const out:any[]=[];for(const x of r?.output||[]){if(x?.type!=='web_search_call')continue;for(const s of x?.action?.sources||[])out.push({title:s?.title||null,url:s?.url||null,type:s?.type||null});}const seen=new Set();return out.filter(x=>{const k=x.url||x.title;if(!k||seen.has(k))return false;seen.add(k);return true}).slice(0,12)}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});if(req.method!=='POST')return js({error:'POST required'},405);
  const t=tok(req);if(!t)return js({error:'Authentication required'},401);let u:any;try{u=await user(t)}catch{return js({error:'Authentication required'},401)}
  let b:any;try{b=await req.json()}catch{return js({error:'Invalid JSON'},400)}const q=String(b?.question||b?.message||'').trim();if(!q)return js({error:'question required'},400);if(!O)return js({error:'OPENAI_API_KEY not configured'},500);
  const card=b?.card||b?.context?.entity||{},evidence=b?.internal_evidence||{};
  const instructions=`You are Collectish external market research. You MUST use web search on this request. Search the public web only to explain or verify an MTG market move. Prefer primary/authoritative sources first (Wizards announcements, official tournament/deck sources), then established MTG market/content sources. Separate internal Collectish observations from external evidence. Distinguish timing correlation from causation. Do not invent card-specific events. If no convincing catalyst is found, say so plainly. Keep the answer concise and decision-oriented.`;
  const input=`Question: ${q}\nCard context: ${clip(card,1800)}\nInternal Collectish evidence: ${clip(evidence,7000)}\nSearch for external events, deck results, announcements, content, or discussion that plausibly overlap the timing in the internal evidence. State which external findings are confirmed facts, which merely correlate with timing, and whether they materially strengthen the causal explanation.`;
  const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),45000);
  try{
    const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:ac.signal,headers:{Authorization:`Bearer ${O}`,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,store:false,instructions,input,tools:[{type:'web_search_preview',search_context_size:'medium'}],tool_choice:'required',include:['web_search_call.action.sources'],max_output_tokens:900})});
    const raw=await r.text();let d:any;try{d=JSON.parse(raw)}catch{d={error:{message:raw.slice(0,500)}}}if(!r.ok)throw Error(d?.error?.message||`OpenAI ${r.status}`);
    const src=sources(d),answer=outputText(d);if(!src.length)throw Error('Web search completed without source metadata');
    await fetch(`${U}/rest/v1/ask_collectish_research_runs`,{method:'POST',headers:{...uh(t),Prefer:'return=minimal'},body:JSON.stringify([{user_id:u.id,product_id:card?.product_id??null,sku_id:card?.sku_id??null,query_text:q,model:d?.model||MODEL,source_count:src.length}])}).catch(()=>{});
    return js({ok:true,answer,sources:src,model:d?.model||MODEL,usage:d?.usage||null,source_count:src.length,web_search_used:true});
  }catch(e){return js({ok:false,error:String((e as Error).message),web_search_used:false},502)}finally{clearTimeout(timer)}
});
