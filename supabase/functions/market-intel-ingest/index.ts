import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const bearer=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const H=(t:string)=>({apikey:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});
const allowedSource=new Set(['article','x','discord','reddit','youtube','official','manual','other']);
const trim=(x:any,n=500)=>String(x??'').trim().slice(0,n);
const clamp=(n:any)=>Number.isFinite(Number(n))?Math.max(0,Math.min(1,Number(n))):0.5;
const canonical=(s:any)=>`${trim(s?.claim_type,40).toLowerCase()}|${trim(s?.direction,20).toLowerCase()}|${trim(s?.entity_name,300).toLowerCase()}|${trim(s?.summary,450).toLowerCase()}`;
function sourceType(url:string,requested:any){const r=trim(requested,30).toLowerCase();if(allowedSource.has(r))return r;try{const h=new URL(url).hostname.toLowerCase();if(h==='x.com'||h==='twitter.com')return'x';if(h.includes('discord.com'))return'discord';if(h.includes('reddit.com'))return'reddit';if(h.includes('youtube.com')||h==='youtu.be')return'youtube';return'article'}catch{return'other'}}
function sourceName(url:string,requested:any){const r=trim(requested,120);if(r)return r;try{const h=new URL(url).hostname.replace(/^www\./,'');if(h==='x.com'||h==='twitter.com')return'X';if(h==='discord.com')return'Discord';return h}catch{return'Unknown'}}
async function auth(t:string){const r=await fetch(`${U}/auth/v1/user`,{headers:{apikey:A,Authorization:`Bearer ${t}`}});if(!r.ok)throw Error('Unauthorized');const u=await r.json();if(!u?.id)throw Error('Unauthorized');return u}
async function rest(t:string,path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(t),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const text=await r.text();let d:any;try{d=text?JSON.parse(text):null}catch{d=text}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
async function rpc(t:string,name:string,args:any={}){return rest(t,`rpc/${name}`,{method:'POST',body:args})}
async function analyze(t:string,b:any){const r=await fetch(`${U}/functions/v1/market-intel-analyze`,{method:'POST',headers:H(t),body:JSON.stringify({url:b.url,rendered_text:b.rendered_text,rendered_title:b.rendered_title,published_at:b.published_at,author:b.author})});const text=await r.text();let d:any;try{d=text?JSON.parse(text):{}}catch{d={error:text}}if(!r.ok)throw Error(d?.error||`Analyzer ${r.status}`);return d}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return J({error:'POST required'},405);
  const t=bearer(req);if(!t)return J({error:'Authentication required'},401);
  let user:any;try{user=await auth(t)}catch{return J({error:'Authentication required'},401)}
  let b:any;try{b=await req.json()}catch{return J({error:'Invalid JSON'},400)}
  const url=trim(b?.url||b?.analysis?.url,2000);if(!/^https?:\/\//i.test(url))return J({error:'A public http/https source URL is required'},400);
  try{
    const analysis=b?.analysis&&Array.isArray(b.analysis.signals)?b.analysis:await analyze(t,b);
    const all=Array.isArray(analysis?.signals)?analysis.signals.slice(0,20):[];
    const selected=Array.isArray(b?.selected_indexes)?b.selected_indexes.map(Number).filter((n:number)=>Number.isInteger(n)&&n>=0&&n<all.length).map((n:number)=>all[n]):all.filter((s:any)=>s?.signal_stage!=='noise');
    if(!selected.length)return J({ok:true,url,analysis,saved:0,duplicates:0,intel_ids:[]});

    const existing=await rest(t,`market_intel_items?select=intel_id,claim_type,direction,summary,market_intel_entities(entity_name)&source_url=eq.${encodeURIComponent(url)}&limit=200`).catch(()=>[]);
    const seen=new Set((existing||[]).map((x:any)=>`${trim(x.claim_type,40).toLowerCase()}|${trim(x.direction,20).toLowerCase()}|${trim(x.market_intel_entities?.[0]?.entity_name,300).toLowerCase()}|${trim(x.summary,450).toLowerCase()}`));
    const ids:string[]=[];let duplicates=0;
    for(const s of selected){
      if(seen.has(canonical(s))){duplicates++;continue}
      const inserted=await rest(t,'market_intel_items',{method:'POST',prefer:'return=representation',body:{user_id:user.id,source_type:sourceType(url,b.source_type),source_name:sourceName(url,b.source_name),source_url:url,title:trim(analysis?.title||s?.entity_name,500)||null,author:trim(analysis?.author||b?.author,250)||null,summary:trim(s?.summary,1200)||null,claim_type:trim(s?.claim_type,40)||'other',direction:trim(s?.direction,20)||'neutral',signal_stage:trim(s?.signal_stage,30)||'unclassified',confidence:clamp(s?.confidence),published_at:analysis?.published_at||b?.published_at||null}});
      const item=Array.isArray(inserted)?inserted[0]:inserted;if(!item?.intel_id)continue;
      await rest(t,'market_intel_entities',{method:'POST',prefer:'return=minimal',body:{intel_id:item.intel_id,user_id:user.id,entity_type:trim(s?.entity_type,40)||'other',entity_name:trim(s?.entity_name,300),scryfall_id:s?.scryfall_id||null,set_code:trim(s?.set_code,20)||null,confidence:s?.scryfall_id?0.99:clamp(s?.confidence)}});
      ids.push(item.intel_id);seen.add(canonical(s));
    }
    if(ids.length){await rpc(t,'refresh_market_intel_entity_links',{}).catch(()=>null);await rpc(t,'refresh_market_intel_evaluations',{}).catch(()=>null)}
    return J({ok:true,url,analysis,saved:ids.length,duplicates,intel_ids:ids,source_type:sourceType(url,b.source_type),source_name:sourceName(url,b.source_name)});
  }catch(e){return J({error:(e as Error).message},502)}
});
