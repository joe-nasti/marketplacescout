import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const SUPABASE_URL=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const ANON=Deno.env.get('SUPABASE_ANON_KEY')||'';
const TOPDECK_KEY=Deno.env.get('TOPDECK_API_KEY')||'';
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...CORS,'Content-Type':'application/json','Cache-Control':'no-store'}});
const bearer=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
async function auth(token:string){const r=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:ANON,Authorization:`Bearer ${token}`}});if(!r.ok)throw new Error('Unauthorized');return await r.json()}
const clean=(v:any)=>String(v??'').replace(/\s+/g,' ').trim();
const SUPPORTED=['Standard','Pioneer','Modern','Legacy','Pauper','Vintage'];

async function topdeckJson(url:string,init:RequestInit,timeoutMs=15000){
  const c=new AbortController();const t=setTimeout(()=>c.abort(),timeoutMs);
  try{
    const r=await fetch(url,{...init,signal:c.signal,headers:{Authorization:TOPDECK_KEY,'Accept':'application/json','User-Agent':'MarketplaceScout/0.4 constructed intelligence',...(init.headers||{})}});
    const text=await r.text();
    if(!r.ok)throw new Error(`TopDeck API HTTP ${r.status}: ${text.slice(0,240)}`);
    try{return JSON.parse(text)}catch{throw new Error('TopDeck API returned non-JSON data')}
  }catch(e){if((e as Error)?.name==='AbortError')throw new Error(`TopDeck API timed out after ${Math.round(timeoutMs/1000)}s`);throw e}
  finally{clearTimeout(t)}
}
async function discover(format:string,start:number,end:number,minSize:number){
  const data=await topdeckJson('https://topdeck.gg/api/v2/tournaments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({game:'Magic: The Gathering',format,start,end,participantMin:minSize,columns:['name','wins','draws','losses']})},12000);
  if(!Array.isArray(data))throw new Error(`TopDeck ${format} discovery returned an unexpected payload`);
  return data;
}
async function standingsFor(tid:string){
  const data=await topdeckJson(`https://topdeck.gg/api/v2/tournaments/${encodeURIComponent(tid)}/standings`,{method:'GET'},12000);
  if(!Array.isArray(data))throw new Error('TopDeck standings returned an unexpected payload');
  return data;
}
function sectionRows(deckObj:any,sectionName:string){
  const src=deckObj?.[sectionName];if(!src||typeof src!=='object')return[] as any[];
  const out:any[]=[];
  for(const [name,val] of Object.entries(src)){
    const qty=typeof val==='number'?val:Number((val as any)?.quantity??(val as any)?.qty??1);
    if(clean(name)&&Number.isFinite(qty)&&qty>0)out.push({card_name:clean(name),quantity:Math.round(qty)});
  }
  return out;
}
function parseDeckObj(deckObj:any){
  if(!deckObj||typeof deckObj!=='object')return[] as any[];
  const cards:any[]=[];
  for(const [sectionKey,dbSection] of [['Mainboard','main'],['Sideboard','side'],['Companion','companion']] as const){for(const r of sectionRows(deckObj,sectionKey))cards.push({section:dbSection,...r})}
  return cards;
}
function dedupeCards(rows:any[]){const m=new Map<string,any>();for(const r of rows){const key=`${r.section}\u0000${r.card_name.toLocaleLowerCase('en-US')}`;const old=m.get(key);if(old)old.quantity+=Number(r.quantity||0);else m.set(key,{...r,quantity:Number(r.quantity||0)})}return [...m.values()]}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
  if(req.method!=='POST')return J({error:'POST required'},405);
  const token=bearer(req);if(!token)return J({error:'Authentication required'},401);
  try{await auth(token)}catch{return J({error:'Authentication required'},401)}
  if(!SERVICE)return J({error:'Service role unavailable'},500);
  if(!TOPDECK_KEY)return J({error:'TOPDECK_API_KEY is not configured.'},500);
  const db=createClient(SUPABASE_URL,SERVICE,{auth:{persistSession:false}}),started=Date.now();
  try{
    let body:any={};try{body=await req.json()}catch{}
    const requested=Array.isArray(body?.formats)?body.formats.map(clean):SUPPORTED.slice(0,5);
    const formats=requested.filter((x:string)=>SUPPORTED.includes(x)).slice(0,6);
    const days=Math.max(7,Math.min(60,Number(body?.days)||21));
    const minSize=Math.max(8,Math.min(256,Number(body?.min_size)||16));
    const perFormat=Math.max(1,Math.min(2,Number(body?.per_format)||1));
    const {data:existing,error:existingError}=await db.from('competitive_events').select('source_event_id').eq('primary_source','topdeck');if(existingError)throw existingError;
    const seen=new Set((existing||[]).map((x:any)=>String(x.source_event_id||'')));
    const now=Math.floor(Date.now()/1000),start=now-days*86400;
    const targets:any[]=[];const discovery:any[]=[];
    for(const format of formats){
      if(Date.now()-started>28000)break;
      try{
        const batch=await discover(format,start,now,minSize);
        const unseen=batch.filter((t:any)=>t?.TID&&!seen.has(String(t.TID))).sort((a:any,b:any)=>Number(b?.startDate||0)-Number(a?.startDate||0)).slice(0,perFormat);
        targets.push(...unseen.map((t:any)=>({...t,_format:format})));
        discovery.push({format,found:batch.length,unseen:unseen.length});
      }catch(e){discovery.push({format,error:(e as Error).message})}
    }
    let events=0,decks=0,cards=0,errors=0;const details:any[]=[];
    for(const t of targets){
      if(Date.now()-started>54000){errors++;details.push({tid:t?.TID,format:t?._format,error:'Execution budget reached'});break}
      try{
        const tid=String(t.TID),format=String(t._format),standings=await standingsFor(tid),ts=Number(t.startDate||0),dateStr=ts?new Date(ts*1000).toISOString().slice(0,10):null;
        if(standings.length<minSize)continue;
        const eventUrl=`https://topdeck.gg/event/${encodeURIComponent(tid)}`;
        const structured=standings.filter((s:any)=>parseDeckObj(s?.deckObj).length>0).length;
        const {data:event,error:eventError}=await db.from('competitive_events').upsert({canonical_event_key:`topdeck:${tid}`,primary_source:'topdeck',source_event_id:tid,source_url:eventUrl,event_name:clean(t.tournamentName)||`${format} ${tid}`,format,event_type:'Paper Tournament',event_date:dateStr,player_count:standings.length,published_deck_count:standings.length,coverage_type:'complete_event',coverage_note:`TopDeck v2 returned complete published standings; structured decklists exposed for ${structured}/${standings.length} entries.`,published_at:dateStr?`${dateStr}T12:00:00Z`:null,fetched_at:new Date().toISOString(),raw_meta:{source:'TopDeck v2 API',format,topCut:t.topCut??null,swissNum:t.swissNum??null,standings_count:standings.length,structured_decks:structured,parser:'topdeck-v2-constructed'}},{onConflict:'canonical_event_key'}).select('event_id').single();if(eventError)throw eventError;
        const {error:sourceError}=await db.from('competitive_event_sources').upsert({event_id:event.event_id,source_name:'TopDeck.gg',source_url:eventUrl,source_event_id:tid,source_kind:'primary'},{onConflict:'event_id,source_name,source_url'});if(sourceError)throw sourceError;
        const deckPayload=standings.map((s:any,idx:number)=>({event_id:event.event_id,player_name:clean(s?.name)||`Player ${idx+1}`,placement:Number(s?.standing)||idx+1,archetype:null,record:`${Number(s?.wins)||0}-${Number(s?.losses)||0}-${Number(s?.draws)||0}`,source_deck_id:clean(s?.id)||null,source_url:eventUrl,_cards:parseDeckObj(s?.deckObj)}));
        const dbDeckPayload=deckPayload.map(({_cards,...d}:any)=>d);if(dbDeckPayload.length){const {error:deckError}=await db.from('competitive_decks').upsert(dbDeckPayload,{onConflict:'event_id,player_name,placement'});if(deckError)throw deckError}
        const {data:stored,error:storedError}=await db.from('competitive_decks').select('deck_id,player_name,placement').eq('event_id',event.event_id);if(storedError)throw storedError;
        const idMap=new Map((stored||[]).map((d:any)=>[`${d.player_name}\u0000${d.placement}`,d.deck_id]));const deckIds=[...idMap.values()];if(deckIds.length){const {error:delError}=await db.from('competitive_deck_cards').delete().in('deck_id',deckIds);if(delError)throw delError}
        const cardPayload:any[]=[];for(const d of deckPayload){const deckId=idMap.get(`${d.player_name}\u0000${d.placement}`);if(!deckId)continue;for(const r of dedupeCards(d._cards))cardPayload.push({deck_id:deckId,section:r.section,card_name:r.card_name,quantity:r.quantity,scryfall_id:null})}
        for(let i=0;i<cardPayload.length;i+=500){const {error:cardError}=await db.from('competitive_deck_cards').insert(cardPayload.slice(i,i+500));if(cardError)throw cardError}
        events++;decks+=dbDeckPayload.length;cards+=cardPayload.length;details.push({tid,event:clean(t.tournamentName),format,date:dateStr,players:standings.length,structured_decks:structured,card_rows:cardPayload.length});
      }catch(e){errors++;details.push({tid:t?.TID,format:t?._format,error:(e as Error).message})}
    }
    return J({ok:true,events,decks,cards,errors,formats,days,min_size:minSize,discovery,elapsed_ms:Date.now()-started,source:'TopDeck v2 API',details});
  }catch(e){return J({error:(e as Error).message,elapsed_ms:Date.now()-started,source:'TopDeck v2 API'},502)}
});
