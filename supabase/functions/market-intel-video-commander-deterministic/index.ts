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
const trim=(x:any,n=1600)=>String(x??'').trim().slice(0,n);
const norm=(s:any)=>String(s||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES=new Set(['spoiler_reaction','new_commander_synergy','commander_recommendation','commander_showcase']);
const TRIGGERS=[
 {re:/a lot more powerful than it looks/i,p:.92,label:'strong positive evaluation'},
 {re:/\b(?:most )?obvious include\b/i,p:.93,label:'obvious include'},
 {re:/\bthis card is busted\b|\bcard is busted\b/i,p:.97,label:'busted recommendation'},
 {re:/\breally powerful\b|\bvery powerful\b/i,p:.88,label:'powerful recommendation'},
 {re:/\bperfect\b/i,p:.89,label:'perfect fit'},
 {re:/\bworks? really well\b|\breally good in this deck\b|\breally good with\b/i,p:.84,label:'strong synergy'},
 {re:/\byou(?:'|’)ll want\b|\byou will want\b/i,p:.82,label:'recommended include'},
 {re:/\bi would combine this with\b/i,p:.81,label:'recommended synergy'},
 {re:/\bseems? really good\b|\bpretty real\b/i,p:.78,label:'positive evaluation'},
 {re:/\bsnowballs? very,? very fast\b|\bsnowballing value\b/i,p:.80,label:'high-impact synergy'}
];
const NEG=/\bnot good\b|\bnot powerful\b|\bavoid\b|\bdon't play\b|\bdo not play\b|\bcut this\b|\bunderwhelming\b/i;

async function serviceAuth(t:string){if(!t)return false;if(S&&t===S)return true;try{const r=await fetch(`${U}/auth/v1/admin/users?page=1&per_page=1`,{headers:{apikey:t,Authorization:`Bearer ${t}`}});return r.ok}catch{return false}}
async function rest(path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
async function rpc(name:string,args:any={}){return rest(`rpc/${name}`,{method:'POST',body:args})}
function parse(raw:string){const s=String(raw||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');try{return JSON.parse(s)}catch{}const a=s.indexOf('{'),z=s.lastIndexOf('}');if(a>=0&&z>a)try{return JSON.parse(s.slice(a,z+1).replace(/,\s*([}\]])/g,'$1'))}catch{}return null}
async function oa(prompt:string,max=650){if(!OPENAI)return null;try{const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${OPENAI}`,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,store:false,input:prompt,max_output_tokens:max})});const d=await r.json();if(!r.ok)return null;let out='';for(const x of d?.output||[])if(x.type==='message')for(const c of x.content||[])if(c.type==='output_text')out+=c.text;return parse(out)}catch{return null}}
function edit(a:string,b:string){const x=norm(a),y=norm(b);let p=Array.from({length:y.length+1},(_,i)=>i);for(let i=1;i<=x.length;i++){const c=[i];for(let j=1;j<=y.length;j++)c[j]=Math.min(c[j-1]+1,p[j]+1,p[j-1]+(x[i-1]===y[j-1]?0:1));p=c}return p[y.length]}
function sim(a:string,b:string){const x=norm(a),y=norm(b);if(!x||!y)return 0;if(x===y)return 1;return 1-edit(x,y)/Math.max(x.length,y.length)}
async function scryfall(name:string){for(const mode of ['exact','fuzzy'] as const){try{const r=await fetch(`https://api.scryfall.com/cards/named?${mode}=${encodeURIComponent(name)}`,{headers:{'User-Agent':'MarketplaceScout/1.0 (+commander deterministic video signals)'}});if(!r.ok)continue;const c=await r.json();if(c?.id&&(mode==='exact'||sim(name,c.name)>=.70))return{name:String(c.name),id:String(c.id),set:String(c.set||'')}}catch{}}return null}
function triggerFor(text:string){if(NEG.test(text))return null;let best:any=null;for(const t of TRIGGERS)if(t.re.test(text)&&(!best||t.p>best.p))best=t;return best}
async function resolveSubject(passage:string,trigger:string,title:string){return oa(`A Magic: The Gathering Commander podcast passage was already selected because it contains an explicit positive evaluation (${trigger}). Identify the ONE primary MTG card that is being positively evaluated. Return ONLY JSON {"canonical_name":string|null,"event_type":"spoiler_reaction"|"new_commander_synergy"|"commander_recommendation"|"commander_showcase","confidence":number,"summary":string}. Use spoiler_reaction if the positively evaluated card is a newly introduced commander/legend being reviewed. Use new_commander_synergy if it is an existing card recommended specifically for one of those new commanders. Use commander_recommendation for a general EDH recommendation. If the positive words refer only to a strategy rather than a particular card, return canonical_name null. Episode: ${title}. Passage: ${passage}`,650)}

Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:C});if(req.method!=='POST')return J({error:'POST required'},405);const t=bearer(req);if(!t||!(await serviceAuth(t)))return J({error:'Service authentication required'},401);if(!S)return J({error:'Service role unavailable'},500);
 let b:any={};try{b=await req.json()}catch{}const target=trim(b?.video_id,100),force=!!b?.force;
 try{
  const rows=await rest('source_captures?select=capture_id,user_id,source,payload_json,metadata_json&capture_type=eq.video_transcript&order=captured_at.desc&limit=100');let cap:any=null;for(const r of rows||[]){const p=r.payload_json||{};if(!UUID.test(String(r.user_id||''))||r?.metadata_json?.status!=='saved')continue;if(!['commander_product','commander_gameplay'].includes(String(p.creator_lane||'')))continue;if(target&&p.video_id!==target)continue;if(!Array.isArray(p.segments)||!p.segments.length)continue;if(!force&&Number(r?.metadata_json?.commander_deterministic_events_saved||0)>0)continue;cap=r;break}if(!cap)return J({ok:true,processed:0,events_saved:0,reason:'no_eligible_cached_commander_video',transcript_credits_used:0});
  const p=cap.payload_json,segments=p.segments,owner=String(cap.user_id),hits:any[]=[];
  for(let i=0;i<segments.length;i++){const text=String(segments[i]?.text||''),tr=triggerFor(text);if(!tr)continue;const around=[segments[i-1]?.text,text,segments[i+1]?.text].filter(Boolean).join(' ');hits.push({i,start_ms:Math.max(0,Math.round(Number(segments[i]?.offset)||0)),prominence:tr.p,label:tr.label,passage:trim(around,2800),evidence:trim(text,700)})}
  hits.sort((a,b)=>b.prominence-a.prominence||a.start_ms-b.start_ms);const selected:any[]=[];for(const h of hits){if(selected.some(x=>Math.abs(x.start_ms-h.start_ms)<25000))continue;selected.push(h);if(selected.length>=18)break}
  const resolved=await Promise.all(selected.map(async h=>({...h,subject:await resolveSubject(h.passage,h.label,String(p.title||''))})));
  let saved=0,rejected=0,duplicates=0;const events:any[]=[];
  for(const h of resolved){const name=trim(h.subject?.canonical_name,300),type=TYPES.has(String(h.subject?.event_type))?String(h.subject.event_type):'commander_recommendation',confidence=Math.max(.55,Math.min(.98,Number(h.subject?.confidence)||.8));if(!name){rejected++;continue}const card=await scryfall(name);if(!card){rejected++;continue}const url=p.url||`https://www.youtube.com/watch?v=${p.video_id}`,key=`${p.video_id}|${type}|${h.start_ms}|${norm(card.name)}`,existing=await rest(`market_intel_items?select=intel_id,metadata_json&user_id=eq.${encodeURIComponent(owner)}&source_url=eq.${encodeURIComponent(url)}&limit=100`).catch(()=>[]);let intelId=(existing||[]).find((q:any)=>String(q?.metadata_json?.video_event_key||'')===key)?.intel_id||null;if(intelId)duplicates++;
   if(!intelId){const ins=await rest('market_intel_items',{method:'POST',prefer:'return=representation',body:{user_id:owner,source_type:'youtube',source_name:cap.source||'YouTube',source_url:url,title:p.title||card.name,author:cap.source||null,summary:trim(h.subject?.summary,1100)||`${card.name}: ${h.label}`,claim_type:type==='spoiler_reaction'||type==='new_commander_synergy'?'product':'demand',direction:'bullish',signal_stage:'leading',confidence,published_at:p.published_at||null,source_profile:'creator_commander',source_subtype:type,metadata_json:{platform:'youtube',video_id:p.video_id,channel_id:p.channel_id||null,creator_lane:p.creator_lane||'commander_product',transcript_provider:'supadata',transcript_mode:'native',timestamped:true,video_event_key:key,event_type:type,start_ms:h.start_ms,prominence:h.prominence,deterministic_commander:true,trigger_label:h.label,resolution_method:'local_passage+scryfall',resolution_confidence:.92}}});intelId=Array.isArray(ins)?ins[0]?.intel_id:null;if(!intelId)continue;await rest('market_intel_entities',{method:'POST',prefer:'return=minimal',body:{intel_id:intelId,user_id:owner,entity_type:'card',entity_name:card.name,scryfall_id:card.id,set_code:card.set,confidence:.92}})}
   await rest('market_intel_video_events',{method:'POST',prefer:'resolution=ignore-duplicates,return=minimal',body:{intel_id:intelId,user_id:owner,video_id:p.video_id,channel_id:p.channel_id||null,channel_name:cap.source||null,creator_lane:p.creator_lane||'commander_product',event_type:type,start_ms:h.start_ms,end_ms:null,prominence:h.prominence,evidence:h.evidence,transcript_provider:'supadata',transcript_mode:'native'}}).catch(()=>null);saved++;events.push({entity_name:card.name,event_type:type,start_ms:h.start_ms,prominence:h.prominence,trigger:h.label,evidence:h.evidence,summary:trim(h.subject?.summary,300)})}
  if(saved){await rpc('refresh_market_intel_entity_links',{}).catch(()=>null);await rpc('refresh_market_intel_evaluations',{}).catch(()=>null)}await rest(`source_captures?capture_id=eq.${encodeURIComponent(cap.capture_id)}&user_id=eq.${encodeURIComponent(owner)}`,{method:'PATCH',body:{metadata_json:{...(cap.metadata_json||{}),events_saved:Math.max(Number(cap?.metadata_json?.events_saved||0),saved),commander_deterministic_events_saved:saved,commander_deterministic_processed_at:new Date().toISOString(),commander_deterministic_triggers:hits.length,commander_deterministic_resolved:selected.length,commander_deterministic_rejected:rejected}}}).catch(()=>null);
  return J({ok:true,processed:1,video_id:p.video_id,title:p.title,channel:cap.source,trigger_hits:hits.length,passages_resolved:selected.length,rejected_cards:rejected,duplicates,events_saved:saved,events,transcript_credits_used:0});
 }catch(e){return J({error:(e as Error).message},502)}
});
