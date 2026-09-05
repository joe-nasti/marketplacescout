import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const bearer=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const H=(t:string)=>({apikey:t===S&&S?S:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const trim=(x:any,n=12000)=>String(x??'').trim().slice(0,n);

const targets=[
  {key:'paper-movers',url:'https://www.mtggoldfish.com/movers/paper/all',title:'MTGGoldfish Paper Movers & Shakers',profile:'market_data',subtype:'mtggoldfish_price_movers'},
  {key:'mtgo-movers',url:'https://www.mtggoldfish.com/movers/online/all',title:'MTGGoldfish MTGO Movers & Shakers',profile:'market_data',subtype:'mtggoldfish_mtgo_price_movers'},
  {key:'standard-meta',url:'https://www.mtggoldfish.com/metagame/standard/full',title:'MTGGoldfish Standard Metagame',profile:'competitive_data',subtype:'mtggoldfish_metagame_snapshot'},
  {key:'modern-meta',url:'https://www.mtggoldfish.com/metagame/modern/full',title:'MTGGoldfish Modern Metagame',profile:'competitive_data',subtype:'mtggoldfish_metagame_snapshot'},
  {key:'pioneer-meta',url:'https://www.mtggoldfish.com/metagame/pioneer/full',title:'MTGGoldfish Pioneer Metagame',profile:'competitive_data',subtype:'mtggoldfish_metagame_snapshot'},
  {key:'pauper-meta',url:'https://www.mtggoldfish.com/metagame/pauper/full',title:'MTGGoldfish Pauper Metagame',profile:'competitive_data',subtype:'mtggoldfish_metagame_snapshot'},
  {key:'legacy-meta',url:'https://www.mtggoldfish.com/metagame/legacy/full',title:'MTGGoldfish Legacy Metagame',profile:'competitive_data',subtype:'mtggoldfish_metagame_snapshot'},
  {key:'vintage-meta',url:'https://www.mtggoldfish.com/metagame/vintage/full',title:'MTGGoldfish Vintage Metagame',profile:'competitive_data',subtype:'mtggoldfish_metagame_snapshot'}
];

async function serviceAuth(t:string){if(!t)return false;if(S&&t===S)return true;try{const r=await fetch(`${U}/auth/v1/admin/users?page=1&per_page=1`,{headers:{apikey:t,Authorization:`Bearer ${t}`}});return r.ok}catch{return false}}
async function rest(t:string,path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(t),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
async function sha(v:string){const bytes=new TextEncoder().encode(v),hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function plain(html:string){return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/\s+/g,' ').trim().slice(0,30000)}
async function fetchPage(url:string){const c=new AbortController(),timer=setTimeout(()=>c.abort(),15000);try{const r=await fetch(url,{redirect:'follow',signal:c.signal,headers:{'User-Agent':'CollectishSignals/1.0 (+structured MTG market monitoring)','Accept':'text/html,application/xhtml+xml'}});if(!r.ok)throw Error(`MTGGoldfish HTTP ${r.status}`);return plain(await r.text())}finally{clearTimeout(timer)}}
async function owner(){const rows=await rest(S,'source_captures?select=user_id&capture_type=eq.feed_subscription&source=eq.MTGGoldfish&limit=1');const id=String(rows?.[0]?.user_id||'');if(!UUID.test(id))throw Error('MTGGoldfish Signals owner not found');return id}
async function ingest(t:any,target:any,ownerId:string,text:string){const stamp=new Date().toISOString().slice(0,13);const sourceUrl=`${target.url}${target.url.includes('?')?'&':'?'}collectish_snapshot=${encodeURIComponent(stamp)}`;const body={_scheduler_user_id:ownerId,url:sourceUrl,rendered_title:target.title,rendered_text:text,source_type:'article',source_name:'MTGGoldfish',source_profile:target.profile,source_subtype:target.subtype,published_at:new Date().toISOString()};const r=await fetch(`${U}/functions/v1/market-intel-ingest`,{method:'POST',headers:H(t),body:JSON.stringify(body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):{}}catch{d={error:raw}}if(!r.ok)throw Error(d?.error||`Ingest ${r.status}`);return d}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return J({error:'POST required'},405);
  const caller=bearer(req);if(!caller||!(await serviceAuth(caller)))return J({error:'Service authentication required'},401);
  if(!S)return J({error:'Service role unavailable'},500);
  let b:any;try{b=await req.json()}catch{b={}}
  const index=Math.max(0,Math.min(Number(b?.target_index)||0,targets.length-1));
  const target=targets[index];
  try{
    const ownerId=await owner();
    const text=await fetchPage(target.url);
    const hash=await sha(text);
    const existing=await rest(S,`source_captures?select=capture_id,content_hash,metadata_json&user_id=eq.${encodeURIComponent(ownerId)}&source=eq.MTGGoldfish&capture_type=eq.structured_snapshot&source_key=eq.${encodeURIComponent(target.key)}&order=captured_at.desc&limit=1`).catch(()=>[]);
    if(existing?.[0]?.content_hash===hash)return J({ok:true,target:target.key,changed:false,saved:0,duplicates:0});
    const result=await ingest(S,target,ownerId,text);
    await rest(S,'source_captures?on_conflict=user_id,source,capture_type,source_key',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:{user_id:ownerId,source:'MTGGoldfish',capture_type:'structured_snapshot',source_key:target.key,content_type:'text/html+snapshot',payload_json:{url:target.url,title:target.title,source_profile:target.profile,source_subtype:target.subtype},payload_text:text,content_hash:hash,metadata_json:{status:'saved',ingested_at:new Date().toISOString(),saved:Number(result?.saved||0),duplicates:Number(result?.duplicates||0)}}});
    return J({ok:true,target:target.key,changed:true,saved:Number(result?.saved||0),duplicates:Number(result?.duplicates||0)});
  }catch(e){return J({error:(e as Error).message,target:target.key},502)}
});
