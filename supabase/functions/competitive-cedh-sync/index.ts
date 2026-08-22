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
const isCedhName=(s:any)=>/\bcedh\b|competitive\s+(?:edh|commander)|topdeck invitational|breach the bay/i.test(clean(s));

async function topdeckTournaments(days:number){
  const c=new AbortController();const t=setTimeout(()=>c.abort(),20000);
  try{
    const r=await fetch('https://topdeck.gg/api/v2/tournaments',{
      method:'POST',signal:c.signal,
      headers:{Authorization:TOPDECK_KEY,'Content-Type':'application/json','Accept':'application/json','User-Agent':'MarketplaceScout/0.2 cEDH intelligence'},
      body:JSON.stringify({game:'Magic: The Gathering',format:'EDH',last:days,columns:['name','id','decklist','wins','draws','losses']})
    });
    const text=await r.text();
    if(!r.ok)throw new Error(`TopDeck API HTTP ${r.status}: ${text.slice(0,240)}`);
    let data:any;try{data=JSON.parse(text)}catch{throw new Error('TopDeck API returned non-JSON data')}
    if(!Array.isArray(data))throw new Error('TopDeck API returned an unexpected tournament payload');
    return data;
  } finally {clearTimeout(t)}
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
  if(!deckObj||typeof deckObj!=='object')return{commander:'',cards:[] as any[]};
  const commanders=sectionRows(deckObj,'Commanders');
  const commander=commanders.map(x=>x.card_name).join(' + ');
  const cards:any[]=[];
  for(const [sectionKey,dbSection] of [['Mainboard','main'],['Sideboard','side'],['Companion','companion'],['Commanders','commander']] as const){
    for(const r of sectionRows(deckObj,sectionKey))cards.push({section:dbSection,...r});
  }
  return{commander,cards};
}
function dedupeCards(rows:any[]){
  const m=new Map<string,any>();
  for(const r of rows){const key=`${r.section}\u0000${r.card_name.toLocaleLowerCase('en-US')}`;const old=m.get(key);if(old)old.quantity+=Number(r.quantity||0);else m.set(key,{...r,quantity:Number(r.quantity||0)})}
  return [...m.values()];
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
  if(req.method!=='POST')return J({error:'POST required'},405);
  const token=bearer(req);if(!token)return J({error:'Authentication required'},401);
  try{await auth(token)}catch{return J({error:'Authentication required'},401)}
  if(!SERVICE)return J({error:'Service role unavailable'},500);
  if(!TOPDECK_KEY)return J({error:'TOPDECK_API_KEY is not configured in Supabase Edge Function secrets.'},500);
  const db=createClient(SUPABASE_URL,SERVICE,{auth:{persistSession:false}});const started=Date.now();
  try{
    let body:any={};try{body=await req.json()}catch{}
    const limit=Math.max(1,Math.min(8,Number(body?.limit)||4));
    const days=Math.max(30,Math.min(365,Number(body?.days)||120));
    const minSize=Math.max(8,Math.min(500,Number(body?.min_size)||16));
    const all=await topdeckTournaments(days);
    const candidates=all.filter((t:any)=>Array.isArray(t?.standings)&&t.standings.length>=minSize&&isCedhName(t?.tournamentName));
    candidates.sort((a:any,b:any)=>Number(b?.startDate||0)-Number(a?.startDate||0));
    const {data:existing,error:existingError}=await db.from('competitive_events').select('source_event_id').eq('primary_source','topdeck');
    if(existingError)throw existingError;
    const seen=new Set((existing||[]).map((x:any)=>String(x.source_event_id||'')));
    const targets=candidates.filter((t:any)=>t?.TID&&!seen.has(String(t.TID))).slice(0,limit);
    let events=0,decks=0,cards=0,errors=0,skippedImported=candidates.length-targets.length;const details:any[]=[];
    for(const t of targets){
      if(Date.now()-started>50000){errors++;details.push({tid:t?.TID,error:'Execution budget reached'});break}
      try{
        const tid=String(t.TID);const standings=Array.isArray(t.standings)?t.standings:[];const ts=Number(t.startDate||0);const dateStr=ts?new Date(ts*1000).toISOString().slice(0,10):null;
        const eventUrl=`https://topdeck.gg/event/${encodeURIComponent(tid)}`;
        const {data:event,error:eventError}=await db.from('competitive_events').upsert({
          canonical_event_key:`topdeck:${tid}`,primary_source:'topdeck',source_event_id:tid,source_url:eventUrl,
          event_name:clean(t.tournamentName)||`cEDH ${tid}`,format:'cEDH',event_type:'cEDH Tournament',event_date:dateStr,
          player_count:standings.length,published_deck_count:standings.length,coverage_type:'complete_event',
          coverage_note:'TopDeck v2 returned the complete published standings for this cEDH event.',
          published_at:dateStr?`${dateStr}T12:00:00Z`:null,fetched_at:new Date().toISOString(),
          raw_meta:{source:'TopDeck v2 API',format:t.format||'EDH',topCut:t.topCut??null,swissNum:t.swissNum??null,standings_count:standings.length,parser:'topdeck-v2-structured'}
        },{onConflict:'canonical_event_key'}).select('event_id').single();
        if(eventError)throw eventError;
        const {error:sourceError}=await db.from('competitive_event_sources').upsert({event_id:event.event_id,source_name:'TopDeck.gg',source_url:eventUrl,source_event_id:tid,source_kind:'primary'},{onConflict:'event_id,source_name,source_url'});if(sourceError)throw sourceError;
        const deckPayload=standings.map((s:any,idx:number)=>{const parsed=parseDeckObj(s?.deckObj);return{event_id:event.event_id,player_name:clean(s?.name)||`Player ${idx+1}`,placement:Number(s?.standing)||idx+1,archetype:parsed.commander||'Unknown Commander',record:`${Number(s?.wins)||0}-${Number(s?.losses)||0}-${Number(s?.draws)||0}`,source_deck_id:clean(s?.id)||null,source_url:eventUrl,_cards:parsed.cards}});
        const dbDeckPayload=deckPayload.map(({_cards,...d}:any)=>d);
        if(dbDeckPayload.length){const {error:deckError}=await db.from('competitive_decks').upsert(dbDeckPayload,{onConflict:'event_id,player_name,placement'});if(deckError)throw deckError}
        const {data:stored,error:storedError}=await db.from('competitive_decks').select('deck_id,player_name,placement').eq('event_id',event.event_id);if(storedError)throw storedError;
        const idMap=new Map((stored||[]).map((d:any)=>[`${d.player_name}\u0000${d.placement}`,d.deck_id]));
        const deckIds=[...idMap.values()];if(deckIds.length){const {error:delError}=await db.from('competitive_deck_cards').delete().in('deck_id',deckIds);if(delError)throw delError}
        const cardPayload:any[]=[];
        for(const d of deckPayload){const deckId=idMap.get(`${d.player_name}\u0000${d.placement}`);if(!deckId)continue;for(const r of dedupeCards(d._cards))cardPayload.push({deck_id:deckId,section:r.section,card_name:r.card_name,quantity:r.quantity,scryfall_id:null})}
        for(let i=0;i<cardPayload.length;i+=500){const {error:cardError}=await db.from('competitive_deck_cards').insert(cardPayload.slice(i,i+500));if(cardError)throw cardError}
        events++;decks+=dbDeckPayload.length;cards+=cardPayload.length;details.push({tid,event:clean(t.tournamentName),date:dateStr,players:standings.length,decks:dbDeckPayload.length,card_rows:cardPayload.length,structured_decks:deckPayload.filter((x:any)=>x._cards.length).length});
      }catch(e){errors++;details.push({tid:t?.TID,error:(e as Error).message})}
    }
    return J({ok:true,events,decks,cards,errors,available_cedh:candidates.length,skipped_imported:skippedImported,elapsed_ms:Date.now()-started,source:'TopDeck v2 API',details});
  }catch(e){return J({error:(e as Error).message,elapsed_ms:Date.now()-started,source:'TopDeck v2 API'},502)}
});
