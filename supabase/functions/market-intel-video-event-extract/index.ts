import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const OPENAI=Deno.env.get('OPENAI_API_KEY')||'';
const MODEL=Deno.env.get('MARKET_INTEL_MODEL')||Deno.env.get('ASK_COLLECTISH_MODEL')||'gpt-5-mini';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const H=(t:string)=>({apikey:t===S&&S?S:A,Authorization:`Bearer ${t}`,'Content-Type':'application/json'});
const bearer=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const trim=(x:any,n=2000)=>String(x??'').trim().slice(0,n);
const clamp=(n:any)=>Number.isFinite(Number(n))?Math.max(0,Math.min(1,Number(n))):0.5;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const eventTypes=new Set(['competitive_test','competitive_result','deck_innovation','commander_showcase','commander_recommendation','precon_reveal','reprint_reveal','new_commander_synergy','precon_upgrade','precon_cut','spoiler_reaction','creator_convergence','other']);

async function serviceAuth(t:string){if(!t)return false;if(S&&t===S)return true;try{const r=await fetch(`${U}/auth/v1/admin/users?page=1&per_page=1`,{headers:{apikey:t,Authorization:`Bearer ${t}`}});return r.ok}catch{return false}}
async function rest(path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(S),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
function norm(s:any){return String(s||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')}
function mmss(ms:number){const s=Math.max(0,Math.floor(ms/1000));return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`}
function parseJson(raw:string){const s=String(raw||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');try{return JSON.parse(s)}catch{}const a=s.indexOf('{'),z=s.lastIndexOf('}');if(a>=0&&z>a)return JSON.parse(s.slice(a,z+1).replace(/,\s*([}\]])/g,'$1'));throw Error('Event extractor returned invalid JSON')}
async function oa(prompt:string){if(!OPENAI)throw Error('OPENAI_API_KEY not configured');const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${OPENAI}`,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,store:false,input:prompt,max_output_tokens:3000})});const raw=await r.text();let d:any;try{d=JSON.parse(raw)}catch{d={error:{message:raw}}}if(!r.ok)throw Error(d?.error?.message||`OpenAI ${r.status}`);let out='';for(const x of d?.output||[])if(x.type==='message')for(const c of x.content||[])if(c.type==='output_text')out+=c.text;return out}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return J({error:'POST required'},405);
  const caller=bearer(req);if(!caller||!(await serviceAuth(caller)))return J({error:'Service authentication required'},401);
  if(!S)return J({error:'Service role unavailable'},500);
  let b:any={};try{b=await req.json()}catch{return J({error:'Invalid JSON'},400)}
  const owner=String(b?.user_id||''),intelIds=(Array.isArray(b?.intel_ids)?b.intel_ids:[]).map(String).filter(UUID.test),segments=(Array.isArray(b?.segments)?b.segments:[]).slice(0,1500);
  const videoId=trim(b?.video_id,100),channelName=trim(b?.channel_name,160),channelId=trim(b?.channel_id,160),lane=['competitive','commander_gameplay','commander_product','general'].includes(String(b?.creator_lane))?String(b.creator_lane):'general';
  if(!UUID.test(owner)||!intelIds.length||!videoId||!segments.length)return J({error:'user_id, intel_ids, video_id and timestamped segments are required'},400);
  try{
    const entities=await rest(`market_intel_entities?select=intel_id,entity_type,entity_name,scryfall_id,product_id&user_id=eq.${encodeURIComponent(owner)}&intel_id=in.(${intelIds.join(',')})`);
    const cardEntities=(entities||[]).filter((x:any)=>x.entity_type==='card');
    if(!cardEntities.length)return J({ok:true,events_saved:0,reason:'no_verified_card_entities'});
    const transcript=segments.map((x:any)=>`[${mmss(Number(x?.offset)||0)}] ${trim(x?.text,1200)}`).join('\n').slice(0,68000);
    const cards=cardEntities.map((x:any)=>x.entity_name).join(' | ');
    const prompt=`You extract timestamped MTG creator-video market events for Collectish. Return ONLY JSON {"events":[{"entity_name":string,"event_type":"competitive_test"|"competitive_result"|"deck_innovation"|"commander_showcase"|"commander_recommendation"|"precon_reveal"|"reprint_reveal"|"new_commander_synergy"|"precon_upgrade"|"precon_cut"|"spoiler_reaction"|"creator_convergence"|"other","start_ms":integer,"end_ms":integer|null,"prominence":number,"evidence":string}]}. Only emit events for these verified cards: ${cards}. A mere card name, decklist inclusion, routine cast, rules explanation, or passing mention is NOT an event. Require a meaningful thesis, explicit recommendation, repeated competitive test/result discussion, memorable gameplay showcase, product/reprint reveal, upgrade/cut recommendation, or novel synergy. prominence is 0..1 and must be >=0.55 for an event worth surfacing. Use timestamps from transcript markers; do not invent precision not supported by the markers. Creator lane: ${lane}. Channel: ${channelName||'unknown'}. Transcript:\n${transcript}`;
    const parsed=parseJson(await oa(prompt));
    const byName=new Map<string,any[]>();for(const e of cardEntities){const k=norm(e.entity_name);if(!byName.has(k))byName.set(k,[]);byName.get(k)!.push(e)}
    const rows:any[]=[];
    for(const x of Array.isArray(parsed?.events)?parsed.events.slice(0,30):[]){
      const matches=byName.get(norm(x?.entity_name))||[];if(!matches.length)continue;
      const prominence=clamp(x?.prominence);if(prominence<0.55)continue;
      const type=eventTypes.has(String(x?.event_type))?String(x.event_type):'other';
      const start=Math.max(0,Math.round(Number(x?.start_ms)||0)),end=Number.isFinite(Number(x?.end_ms))?Math.max(start,Math.round(Number(x.end_ms))):null;
      for(const entity of matches)rows.push({intel_id:entity.intel_id,user_id:owner,video_id:videoId,channel_id:channelId||null,channel_name:channelName||null,creator_lane:lane,event_type:type,start_ms:start,end_ms:end,prominence,evidence:trim(x?.evidence,900)||null,transcript_provider:'supadata',transcript_mode:'native'});
    }
    if(!rows.length)return J({ok:true,events_saved:0,events_considered:Array.isArray(parsed?.events)?parsed.events.length:0});
    await rest(`market_intel_video_events?user_id=eq.${encodeURIComponent(owner)}&video_id=eq.${encodeURIComponent(videoId)}`,{method:'DELETE'}).catch(()=>null);
    const inserted=await rest('market_intel_video_events',{method:'POST',prefer:'return=representation',body:rows});
    return J({ok:true,events_saved:Array.isArray(inserted)?inserted.length:rows.length,events:inserted,model:MODEL});
  }catch(e){return J({error:(e as Error).message},502)}
});
