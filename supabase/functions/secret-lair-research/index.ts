import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const O=Deno.env.get('OPENAI_API_KEY')||'';
const MODEL=Deno.env.get('ASK_WEB_MODEL')||'gpt-5.4-mini';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const js=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const tok=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const clip=(v:any,n=12000)=>{const s=typeof v==='string'?v:JSON.stringify(v??{});return s.length>n?s.slice(0,n)+'…':s};
const canonical=(raw:string)=>{try{const u=new URL(raw);['utm_source','utm_medium','utm_campaign','utm_term','utm_content'].forEach(k=>u.searchParams.delete(k));u.hash='';return u.toString()}catch{return raw}};
const host=(raw:string)=>{try{return new URL(raw).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}};
async function user(t:string){const r=await fetch(`${U}/auth/v1/user`,{headers:{apikey:A,Authorization:`Bearer ${t}`}});if(!r.ok)throw Error('Unauthorized');const x=await r.json();if(!x?.id)throw Error('Unauthorized');return x}
async function openai(body:any){const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${O}`,'Content-Type':'application/json'},body:JSON.stringify(body)});const raw=await r.text();let d:any;try{d=JSON.parse(raw)}catch{d={error:{message:raw.slice(0,800)}}}if(!r.ok)throw Error(d?.error?.message||`OpenAI ${r.status}`);return d}
function outputText(r:any){const direct=r?.output_text;if(typeof direct==='string'&&direct.trim())return direct.trim();const out:string[]=[];for(const x of r?.output||[]){if(x?.type==='message')for(const c of x?.content||[]){if(typeof c?.text==='string'&&c.text.trim())out.push(c.text)}}return out.join('\n').trim()}
function searchRows(r:any){const rows:any[]=[];for(const x of r?.output||[]){if(x?.type!=='web_search_call')continue;for(const s of x?.action?.sources||[])if(s?.url)rows.push({title:s.title||null,url:canonical(s.url),published_at:s.published_at||s.date||null,snippet:s.snippet||null});for(const s of x?.results||x?.action?.results||[])if(s?.url||s?.link)rows.push({title:s.title||s.name||null,url:canonical(s.url||s.link),published_at:s.published_at||s.published_date||s.date||null,snippet:s.snippet||s.text||s.description||null})}return rows}
function sourceKind(url:string){const h=host(url);if(/magic\.wizards\.com|wizards\.com|secretlair\.wizards\.com/.test(h))return'Official';if(/reddit\.com/.test(h))return'Reddit';if(/youtube\.com|youtu\.be/.test(h))return'YouTube';if(/tcgplayer\.com|mtgstocks\.com|cardmarket\.com|tcgstrat\.com/.test(h))return'Market';return'Web'}
function sources(r:any){const seen=new Set<string>();return searchRows(r).filter(x=>{if(seen.has(x.url))return false;seen.add(x.url);return true}).map(x=>({...x,kind:sourceKind(x.url)})).sort((a,b)=>{const q=(k:string)=>k==='Official'?5:k==='Market'?4:k==='Reddit'||k==='YouTube'?3:1;return q(b.kind)-q(a.kind)}).slice(0,16)}
function extract(raw:string){const marker='SECRET_LAIR_RESEARCH_JSON=';const at=raw.lastIndexOf(marker);if(at<0)return{answer:raw.trim(),evidence:[]};const answer=raw.slice(0,at).trim();let evidence:any[]=[];try{const x=JSON.parse(raw.slice(at+marker.length).trim());if(Array.isArray(x))evidence=x}catch{}return{answer,evidence:evidence.slice(0,30)}}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return js({error:'POST required'},405);
  const t=tok(req);if(!t)return js({error:'Authentication required'},401);
  let u:any;try{u=await user(t)}catch{return js({error:'Authentication required'},401)}
  let b:any;try{b=await req.json()}catch{return js({error:'Invalid JSON'},400)}
  if(!O)return js({error:'OPENAI_API_KEY not configured'},500);
  const release=b?.release||{},drop=b?.drop||null,question=String(b?.question||'Evaluate this Secret Lair opportunity').trim();
  if(!release?.release_name&&!release?.name)return js({error:'release context required'},400);
  const instructions=`You are Collectish Secret Lair intelligence. You MUST use public web search. Research the named Secret Lair release and, when supplied, the specific drop. Seek independent evidence from official Wizards/Secret Lair pages, Reddit MTG/Secret Lair/finance communities, YouTube or editorial coverage, and relevant market pages. Evaluate collector desirability and business opportunity separately. Look specifically for card/reprint value, staple depth, anchor cards, art/treatment reaction, version-of-choice potential, premium-printing competition, IP/fandom heat, obscurity, reprint fatigue, sale mechanics, WPN or other distribution, bundles/promos, and sentiment. Treat rumors/bonus-card guesses as speculation and assign them ZERO base EV until confirmed.

Supply rule: Secret Lair product supply is global. US, REU and UK are storefront/allocation regions, not three independent print runs. Their inventories can differ and they can sell out or be pulled at different times because allocation and local demand differ. A US/REU/UK sellout is regional market confirmation only; never claim global supply is exhausted from one regional sellout. If exact global print quantity or allocations are unknown, say unknown.

Return a concise research brief with: Quick read; strongest bullish evidence; strongest risks; collector/treatment consensus; economics/value observations; supply and regional storefront observations; what would change the grade. Do not invent scores if inputs are insufficient. At the very end append exactly one line beginning SECRET_LAIR_RESEARCH_JSON= followed by a JSON array of evidence objects with fields: evidence_class (known_fact|observed_signal|speculation|market_state), claim_dimension, direction (bullish|bearish|neutral), confidence (0..1), summary, url, region (US|REU|UK|null). Facts require reliable support; community sentiment is observed_signal; unconfirmed bonus cards are speculation.`;
  const input=`Question: ${question}\nRelease context: ${clip(release,5000)}\nDrop context: ${clip(drop,5000)}\nExisting Collectish evidence: ${clip(b?.internal_evidence||{},7000)}\nIf researching pre-sale, prioritize evidence available before the sale start. Preserve temporal provenance.`;
  try{
    const d=await openai({model:MODEL,store:false,instructions,input,tools:[{type:'web_search_preview',search_context_size:'high'}],tool_choice:'auto',include:['web_search_call.action.sources','web_search_call.results'],max_output_tokens:2400});
    const raw=outputText(d),src=sources(d);if(!raw||!src.length)throw Error('Secret Lair web research returned insufficient output');
    const parsed=extract(raw);
    const evidence=parsed.evidence.map((e:any)=>({...e,region:['US','REU','UK'].includes(String(e?.region||'').toUpperCase())?String(e.region).toUpperCase():null,url:e?.url?canonical(String(e.url)):null}));
    await fetch(`${U}/rest/v1/ask_collectish_research_runs`,{method:'POST',headers:{apikey:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify([{user_id:u.id,query_text:question,model:d?.model||MODEL,source_count:src.length}])}).catch(()=>{});
    return js({ok:true,answer:parsed.answer,sources:src,evidence,model:d?.model||MODEL,usage:d?.usage||null,web_search_used:true});
  }catch(e){return js({ok:false,error:String((e as Error).message),web_search_used:false},502)}
});
