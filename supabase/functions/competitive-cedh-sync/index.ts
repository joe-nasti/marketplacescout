import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const ANON=Deno.env.get('SUPABASE_ANON_KEY')||'';
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...CORS,'Content-Type':'application/json','Cache-Control':'no-store'}});
const bearer=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
async function auth(token:string){const r=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:ANON,Authorization:`Bearer ${token}`}});if(!r.ok)throw new Error('Unauthorized');return await r.json()}
async function postJson(path:string,body:any){
  const bases=['https://edhtop16.com/api/','https://www.edhtop16.com/api/'];
  let last='';
  for(const base of bases){
    const c=new AbortController();const t=setTimeout(()=>c.abort(),15000);
    try{
      const r=await fetch(base+path,{method:'POST',signal:c.signal,headers:{'Content-Type':'application/json','Accept':'application/json','User-Agent':'MarketplaceScout/0.1 cEDH intelligence'},body:JSON.stringify(body)});
      const text=await r.text();
      if(!r.ok){last=`${base+path} HTTP ${r.status}: ${text.slice(0,200)}`;continue}
      try{return JSON.parse(text)}catch{last=`${base+path} returned non-JSON`;continue}
    }catch(e){last=(e as Error)?.name==='AbortError'?`${base+path} timed out`:(e as Error)?.message||String(e)}finally{clearTimeout(t)}
  }
  throw new Error(last||`EDHTop16 ${path} request failed`)
}
function clean(v:any){return String(v??'').replace(/\s+/g,' ').trim()}
function deckIdFromUrl(value:any){try{const u=new URL(String(value||''));return u.pathname.split('/').filter(Boolean).pop()||null}catch{return null}}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
  if(req.method!=='POST')return J({error:'POST required'},405);
  const token=bearer(req);if(!token)return J({error:'Authentication required'},401);
  try{await auth(token)}catch{return J({error:'Authentication required'},401)}
  if(!SERVICE)return J({error:'Service role unavailable'},500);
  const db=createClient(SUPABASE_URL,SERVICE,{auth:{persistSession:false}});const started=Date.now();
  try{
    let body:any={};try{body=await req.json()}catch{}
    const limit=Math.max(1,Math.min(8,Number(body?.limit)||4));
    const days=Math.max(30,Math.min(365,Number(body?.days)||120));
    const minSize=Math.max(1,Math.min(500,Number(body?.min_size)||16));
    const since=Math.floor((Date.now()-days*86400000)/1000);
    const tourneys=await postJson('list_tourneys',{size:{$gte:minSize},dateCreated:{$gte:since}});
    if(!Array.isArray(tourneys))throw new Error('EDHTop16 list_tourneys returned an unexpected payload');
    const sorted=[...tourneys].sort((a:any,b:any)=>new Date(b?.date||0).getTime()-new Date(a?.date||0).getTime());
    const {data:existing,error:existingError}=await db.from('competitive_events').select('source_event_id').eq('primary_source','edhtop16');
    if(existingError)throw existingError;
    const seen=new Set((existing||[]).map((x:any)=>String(x.source_event_id||'')));
    const targets=sorted.filter((t:any)=>t?.TID&&!seen.has(String(t.TID))).slice(0,limit);
    let events=0,decks=0,errors=0,skipped=sorted.length-targets.length;const details:any[]=[];
    for(const t of targets){
      if(Date.now()-started>50000){details.push({tid:t.TID,error:'Execution budget reached'});errors++;break}
      try{
        const tid=String(t.TID);const entries=await postJson('req',{tourney_filter:{TID:tid}});
        if(!Array.isArray(entries))throw new Error('EDHTop16 req returned an unexpected payload');
        const eventDate=t?.date?new Date(t.date):null;const dateStr=eventDate&&!Number.isNaN(eventDate.getTime())?eventDate.toISOString().slice(0,10):null;
        const size=Number(t?.size)||entries.length||null;const complete=!!size&&entries.length>=size;const coverage=complete?'complete_event':'partial_event';
        const eventUrl=`https://www.edhtop16.com/tournament/${encodeURIComponent(tid)}`;
        const {data:event,error:eventError}=await db.from('competitive_events').upsert({canonical_event_key:`edhtop16:${tid}`,primary_source:'edhtop16',source_event_id:tid,source_url:eventUrl,event_name:clean(t?.tournamentName)||`cEDH ${tid}`,format:'cEDH',event_type:'cEDH Tournament',event_date:dateStr,player_count:size,published_deck_count:entries.length,coverage_type:coverage,coverage_note:complete?'EDHTop16 returned entries covering the published tournament size.':'EDHTop16 returned fewer entries than the published tournament size; treat as partial coverage.',published_at:dateStr?`${dateStr}T12:00:00Z`:null,fetched_at:new Date().toISOString(),raw_meta:{source:'EDHTop16 API',entry_count:entries.length,published_size:size}},{onConflict:'canonical_event_key'}).select('event_id').single();
        if(eventError)throw eventError;
        const {error:sourceError}=await db.from('competitive_event_sources').upsert({event_id:event.event_id,source_name:'EDHTop16',source_url:eventUrl,source_event_id:tid,source_kind:'primary'},{onConflict:'event_id,source_name,source_url'});if(sourceError)throw sourceError;
        const payload=entries.map((e:any,idx:number)=>({event_id:event.event_id,player_name:clean(e?.name)||`Player ${idx+1}`,placement:Number(e?.standing)||idx+1,archetype:clean(e?.commander)||'Unknown Commander',record:`${Number(e?.wins)||0}-${Number(e?.losses)||0}-${Number(e?.draws)||0}`,source_deck_id:deckIdFromUrl(e?.decklist),source_url:clean(e?.decklist)||eventUrl}));
        if(payload.length){const {error:deckError}=await db.from('competitive_decks').upsert(payload,{onConflict:'event_id,player_name,placement'});if(deckError)throw deckError}
        events++;decks+=payload.length;details.push({tid,event:clean(t?.tournamentName),size,entries:payload.length,coverage_type:coverage,date:dateStr});
      }catch(e){errors++;details.push({tid:t?.TID,error:(e as Error).message})}
    }
    return J({ok:true,events,decks,errors,skipped_imported:skipped,available:sorted.length,elapsed_ms:Date.now()-started,source:'EDHTop16 API',details});
  }catch(e){return J({error:(e as Error).message,elapsed_ms:Date.now()-started,source:'EDHTop16 API'},502)}
});
