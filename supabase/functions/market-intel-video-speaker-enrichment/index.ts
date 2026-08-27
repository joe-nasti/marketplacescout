import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const A=Deno.env.get('SUPABASE_ANON_KEY')||'';
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const OPENAI=Deno.env.get('OPENAI_API_KEY')||'';
const MODEL=Deno.env.get('MARKET_INTEL_MODEL')||Deno.env.get('ASK_COLLECTISH_MODEL')||'gpt-5-mini';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const H=()=>({apikey:S||A,Authorization:`Bearer ${S}`,'Content-Type':'application/json'});
const bearer=(r:Request)=>{const h=r.headers.get('authorization')||'';return h.toLowerCase().startsWith('bearer ')?h.slice(7):''};
const trim=(x:any,n=2000)=>String(x??'').trim().slice(0,n);
const clamp=(x:any)=>Number.isFinite(Number(x))?Math.max(0,Math.min(1,Number(x))):0;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENDORSEMENTS=new Set(['echo','explicit','independent_rationale','independent_action']);

async function serviceAuth(t:string){if(!t)return false;if(S&&t===S)return true;try{const r=await fetch(`${U}/auth/v1/admin/users?page=1&per_page=1`,{headers:{apikey:t,Authorization:`Bearer ${t}`}});return r.ok}catch{return false}}
async function rest(path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
function parseJson(raw:string){const s=String(raw||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');try{return JSON.parse(s)}catch{}const a=s.indexOf('{'),z=s.lastIndexOf('}');if(a>=0&&z>a)return JSON.parse(s.slice(a,z+1).replace(/,\s*([}\]])/g,'$1'));throw Error('invalid JSON')}
async function oa(prompt:string,max=2400){if(!OPENAI)throw Error('OPENAI_API_KEY not configured');const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${OPENAI}`,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,store:false,input:prompt,max_output_tokens:max})});const raw=await r.text();let d:any;try{d=JSON.parse(raw)}catch{d={error:{message:raw}}}if(!r.ok)throw Error(d?.error?.message||`OpenAI ${r.status}`);let out='';for(const x of d?.output||[])if(x.type==='message')for(const c of x.content||[])if(c.type==='output_text')out+=c.text;return out}
function localTranscript(segments:any[],ms:number){return (segments||[]).filter(x=>Math.abs((Number(x?.offset)||0)-ms)<=45000).map(x=>`[${Math.floor((Number(x?.offset)||0)/1000)}s] ${trim(x?.text,700)}`).join('\n').slice(0,7000)}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return J({error:'POST required'},405);
  const token=bearer(req);if(!token||!(await serviceAuth(token)))return J({error:'Service authentication required'},401);
  if(!S)return J({error:'Service role unavailable'},500);
  let body:any={};try{body=await req.json()}catch{}
  const limit=Math.max(1,Math.min(8,Number(body?.video_limit)||4));
  const target=trim(body?.video_id,120);
  try{
    const eventPath=target
      ? `market_intel_video_events?select=video_event_id,intel_id,user_id,video_id,channel_name,event_type,start_ms,prominence,evidence,speaker_name,speaker_confidence&video_id=eq.${encodeURIComponent(target)}&order=created_at.desc&limit=80`
      : 'market_intel_video_events?select=video_event_id,intel_id,user_id,video_id,channel_name,event_type,start_ms,prominence,evidence,speaker_name,speaker_confidence&speaker_name=is.null&order=created_at.desc&limit=160';
    const rows=await rest(eventPath);
    const grouped=new Map<string,any[]>();
    for(const r of rows||[]){if(!UUID.test(String(r.user_id||'')))continue;const k=`${r.user_id}|${r.video_id}`;if(!grouped.has(k))grouped.set(k,[]);grouped.get(k)!.push(r)}
    const captures=await rest('source_captures?select=capture_id,user_id,source,payload_json,metadata_json&capture_type=eq.video_transcript&order=captured_at.desc&limit=140');
    let videos=0,updated=0,skipped=0;const results:any[]=[];
    for(const [k,events] of Array.from(grouped.entries()).slice(0,limit)){
      const [userId,videoId]=k.split('|');
      const cap=(captures||[]).find((c:any)=>String(c.user_id)===userId&&String(c?.payload_json?.video_id||'')===videoId&&Array.isArray(c?.payload_json?.segments));
      if(!cap){skipped++;continue}
      const candidates=events.slice(0,24).map((e:any)=>({
        video_event_id:e.video_event_id,event_type:e.event_type,start_ms:e.start_ms,prominence:Number(e.prominence||0),evidence:trim(e.evidence,700),context:localTranscript(cap.payload_json.segments,Number(e.start_ms)||0)
      }));
      const prompt=`You are conservatively attributing speakers in a Magic: The Gathering YouTube transcript. Return ONLY JSON {"events":[{"video_event_id":string,"speaker_name":string|null,"speaker_role":"host"|"guest"|"panelist"|"player"|"unknown","endorsement_type":"echo"|"explicit"|"independent_rationale"|"independent_action","speaker_confidence":number}]}.\n\nRules:\n- Do NOT invent speaker identity. Native captions often lack diarization.\n- Only provide a speaker_name or stable label when the text clearly distinguishes that speaker by name, direct address, an explicit handoff, or other strong conversational evidence. Alternating sentences alone are NOT enough.\n- If uncertain, speaker_name=null, speaker_role=unknown, speaker_confidence<0.70. These rows intentionally receive no multi-speaker consensus credit.\n- echo = merely agrees/repeats (yeah, agreed, exactly) without a substantive thesis.\n- explicit = independently states the card is strong/weak or sought-after.\n- independent_rationale = gives a distinct reason, testing result, deckbuilding argument, or gameplay observation.\n- independent_action = expresses concrete add/play/buy/register/cut action or purchase intent.\n- speaker_confidence measures attribution confidence, not card conviction.\nChannel=${trim(cap.source||events[0]?.channel_name,200)}. Video=${trim(cap.payload_json?.title,500)}.\nEVENTS:\n${JSON.stringify(candidates)}`;
      let parsed:any;try{parsed=parseJson(await oa(prompt))}catch{skipped++;continue}
      const annotations=Array.isArray(parsed?.events)?parsed.events:[];
      const allowed=new Set(candidates.map((x:any)=>String(x.video_event_id)));
      for(const a of annotations){const id=String(a?.video_event_id||'');if(!allowed.has(id))continue;const conf=clamp(a?.speaker_confidence),name=conf>=.70?trim(a?.speaker_name,180)||null:null,role=['host','guest','panelist','player','unknown'].includes(String(a?.speaker_role))?String(a.speaker_role):'unknown',endorsement=ENDORSEMENTS.has(String(a?.endorsement_type))?String(a.endorsement_type):'explicit';await rest(`market_intel_video_events?video_event_id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,{method:'PATCH',prefer:'return=minimal',body:{speaker_name:name,speaker_role:role,endorsement_type:endorsement,speaker_confidence:conf}});updated++}
      videos++;results.push({video_id:videoId,title:trim(cap.payload_json?.title,250),events:candidates.length,annotations:annotations.length});
    }
    return J({ok:true,videos_processed:videos,events_updated:updated,videos_skipped:skipped,results});
  }catch(e){return J({error:(e as Error).message},502)}
});
