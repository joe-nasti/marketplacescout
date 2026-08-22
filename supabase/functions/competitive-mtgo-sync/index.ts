import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const ANON=Deno.env.get('SUPABASE_ANON_KEY')||'';
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...CORS,'Content-Type':'application/json','Cache-Control':'no-store'}});
const bearer=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
async function auth(token:string){const r=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:ANON,Authorization:`Bearer ${token}`}});if(!r.ok)throw new Error('Unauthorized');return await r.json()}
function decode(s:string){return s.replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')}
function textify(html:string){return decode(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(p|div|section|article|h[1-6]|li|tr)>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/[ \t]+/g,' ').replace(/\n\s*\n+/g,'\n').trim()}
async function get(url:string,timeoutMs=12000){const c=new AbortController();const t=setTimeout(()=>c.abort(),timeoutMs);try{const r=await fetch(url,{redirect:'follow',signal:c.signal,headers:{'User-Agent':'MarketplaceScout/0.4 competitive-results','Accept':'text/html,application/xhtml+xml'}});if(!r.ok)throw new Error(`${url} HTTP ${r.status}`);return await r.text()}catch(e){if((e as Error)?.name==='AbortError')throw new Error(`${url} timed out after ${Math.round(timeoutMs/1000)}s`);throw e}finally{clearTimeout(t)}}
function formatFromName(name:string){for(const f of ['Standard','Modern','Pioneer','Legacy','Vintage','Pauper','Premodern','Duel Commander'])if(name.toLowerCase().includes(f.toLowerCase()))return f;return null}
function eventType(name:string){for(const t of ['Showcase','Super Qualifier','Qualifier','Challenge','Trial','League'])if(name.toLowerCase().includes(t.toLowerCase()))return t;return 'Other'}
function coverageFor(type:string){if(type==='League')return {coverage_type:'curated_sample',coverage_note:'WotC-curated published League sample; not suitable for field-share estimates.'};if(['Challenge','Trial','Qualifier','Super Qualifier','Showcase'].includes(type))return {coverage_type:'partial_event',coverage_note:'Published competitive event results; use published deck count as denominator only when coverage is known.'};return {coverage_type:'unknown',coverage_note:null}}
function parseEvent(html:string,url:string){const text=textify(html);const title=(text.match(/^([^\n]+(?:Challenge|Qualifier|Showcase|Trial|League)[^\n]*)/im)?.[1]||text.split('\n')[0]||'MTGO Event').trim();const posted=text.match(/Posted on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i)?.[1]||null;const players=Number(text.match(/(\d+)\s+players/i)?.[1]||0)||null;const deckStart=text.search(/\nDecklists\n/i);const body=deckStart>=0?text.slice(deckStart+10):text;const rx=/(?:^|\n)([^\n]{2,80}?)\s*\((\d+)(?:st|nd|rd|th) Place\)\s*\n/gi;const matches=[...body.matchAll(rx)];const decks:any[]=[];for(let i=0;i<matches.length;i++){const m=matches[i];const player=m[1].trim();const placement=Number(m[2]);const start=(m.index||0)+m[0].length;const end=i+1<matches.length?(matches[i+1].index||body.length):body.length;const chunk=body.slice(start,end);const lines=chunk.split('\n').map(x=>x.trim()).filter(Boolean);let section='main';const cards:any[]=[];for(const line of lines){const l=line.toLowerCase();if(l.startsWith('sideboard')){section='side';continue}if(l.startsWith('commander')){section='commander';continue}if(/^(creature|instant|sorcery|artifact|enchantment|planeswalker|land|battle|other)\b/i.test(line))continue;const cm=line.match(/^(\d{1,2})\s+(.{2,100})$/);if(!cm)continue;const qty=Number(cm[1]);const name=cm[2].replace(/\s+\(.*?\)\s*$/,'').trim();if(!qty||!name||/^\d/.test(name)||/^(Decklist|Stats)$/i.test(name))continue;cards.push({section,card_name:name,quantity:qty})}if(cards.length>=20)decks.push({player_name:player,placement,cards})}return {title,posted,players,decks,url,textLength:text.length}}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
  if(req.method!=='POST')return J({error:'POST required'},405);
  const token=bearer(req);if(!token)return J({error:'Authentication required'},401);
  try{await auth(token)}catch{return J({error:'Authentication required'},401)}
  if(!SERVICE)return J({error:'Service role unavailable'},500);
  let body:any={};try{body=await req.json()}catch{}
  const maxEvents=Math.max(1,Math.min(6,Number(body?.max_events)||4));
  const started=Date.now();
  const db=createClient(SUPABASE_URL,SERVICE,{auth:{persistSession:false}});
  try{
    const index=await get('https://www.mtgo.com/decklists',12000);
    const links=[...index.matchAll(/href=["']([^"']*\/decklist\/[^"']+)["']/gi)].map(m=>new URL(m[1],'https://www.mtgo.com').toString());
    const unique=[...new Set(links)].filter(u=>/(challenge|qualifier|showcase|trial)/i.test(u)).slice(0,maxEvents);
    if(!unique.length)return J({ok:true,events:0,decks:0,cards:0,errors:[{stage:'index',message:'No recent Challenge/Qualifier/Showcase/Trial links were found on the MTGO decklists index.'}],elapsed_ms:Date.now()-started});

    let events=0,decksSaved=0,cardsSaved=0;
    const details:any[]=[];const errors:any[]=[];
    for(const url of unique){
      if(Date.now()-started>50000){errors.push({url,stage:'budget',message:'Import stopped at the 50s execution budget; run Refresh MTGO again for remaining events.'});break}
      try{
        const html=await get(url,12000);const p=parseEvent(html,url);
        if(!p.decks.length){errors.push({url,stage:'parse',message:'No decklists matched the current parser.',textLength:p.textLength});continue}
        const slug=new URL(url).pathname.split('/').filter(Boolean).pop()||url;
        const eventDate=p.posted?new Date(p.posted+' UTC').toISOString().slice(0,10):null;
        const type=eventType(p.title);const coverage=coverageFor(type);
        const key=`mtgo:${slug}`;
        const {data:event,error:e1}=await db.from('competitive_events').upsert({canonical_event_key:key,primary_source:'mtgo',source_event_id:slug,source_url:url,event_name:p.title,format:formatFromName(p.title),event_type:type,event_date:eventDate,player_count:p.players,published_deck_count:p.decks.length,coverage_type:coverage.coverage_type,coverage_note:coverage.coverage_note,published_at:eventDate?`${eventDate}T12:00:00Z`:null,fetched_at:new Date().toISOString(),raw_meta:{parser:'text-v2',published_decks:p.decks.length}},{onConflict:'canonical_event_key'}).select('event_id').single();
        if(e1)throw e1;events++;
        const {error:se}=await db.from('competitive_event_sources').upsert({event_id:event.event_id,source_name:'MTGO',source_url:url,source_event_id:slug,source_kind:'primary'},{onConflict:'event_id,source_name,source_url'});if(se)throw se;
        for(const d of p.decks){
          const {data:deck,error:e2}=await db.from('competitive_decks').upsert({event_id:event.event_id,player_name:d.player_name,placement:d.placement,source_url:url},{onConflict:'event_id,player_name,placement'}).select('deck_id').single();if(e2)throw e2;decksSaved++;
          const {error:del}=await db.from('competitive_deck_cards').delete().eq('deck_id',deck.deck_id);if(del)throw del;
          const rows=d.cards.map((c:any)=>({deck_id:deck.deck_id,section:c.section,card_name:c.card_name,quantity:c.quantity,scryfall_id:null}));
          if(rows.length){const {error:e3}=await db.from('competitive_deck_cards').insert(rows);if(e3)throw e3;cardsSaved+=rows.length}
        }
        details.push({url,event:p.title,format:formatFromName(p.title),coverage_type:coverage.coverage_type,parsedDecks:p.decks.length,player_count:p.players});
      }catch(e){errors.push({url,stage:'event',message:(e as Error).message||String(e)})}
    }
    return J({ok:true,events,decks:decksSaved,cards:cardsSaved,details,errors,partial:errors.length>0,elapsed_ms:Date.now()-started});
  }catch(e){return J({error:(e as Error).message,elapsed_ms:Date.now()-started},502)}
});
