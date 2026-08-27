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
const trim=(x:any,n=1800)=>String(x??'').trim().slice(0,n);
const clamp=(x:any)=>Number.isFinite(Number(x))?Math.max(0,Math.min(1,Number(x))):0.5;
const norm=(s:any)=>String(s||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRIGGERS=[
 {re:/\bthis card is busted\b|\bcard is busted\b/i,p:.97,label:'busted'},
 {re:/\bone of the best cards? in the deck\b|\bbest card in the deck\b/i,p:.96,label:'best in deck'},
 {re:/\bthe perfect card\b|\bis perfect\b|\bperfect for\b/i,p:.93,label:'perfect fit'},
 {re:/\bis insane\b|\bthat's insane\b|\bpretty gross\b|\bsuper sick\b/i,p:.92,label:'exceptional synergy'},
 {re:/\breally powerful\b|\bvery powerful\b/i,p:.90,label:'powerful'},
 {re:/\breally good in this deck\b|\breally good with\b|\bworks? really well\b/i,p:.87,label:'strong synergy'},
 {re:/\byou(?:'|’)ll want\b|\byou will want\b|\bobvious include\b/i,p:.86,label:'explicit include'},
 {re:/\bi would (?:play|put|combine|include)\b/i,p:.82,label:'recommendation'},
 {re:/\bgood in this deck\b|\bgood option\b|\bpretty sweet in this deck\b/i,p:.78,label:'positive synergy'}
];

async function auth(t:string){if(!t)return false;if(S&&t===S)return true;try{const r=await fetch(`${U}/auth/v1/admin/users?page=1&per_page=1`,{headers:{apikey:t,Authorization:`Bearer ${t}`}});return r.ok}catch{return false}}
async function rest(path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
async function rpc(name:string,args:any={}){return rest(`rpc/${name}`,{method:'POST',body:args})}
function parseJson(raw:string){const s=String(raw||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');try{return JSON.parse(s)}catch{}const a=s.indexOf('{'),z=s.lastIndexOf('}');if(a>=0&&z>a)try{return JSON.parse(s.slice(a,z+1).replace(/,\s*([}\]])/g,'$1'))}catch{}return null}
async function oa(prompt:string,max=900){if(!OPENAI)return null;try{const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${OPENAI}`,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,store:false,input:prompt,max_output_tokens:max})});const d=await r.json();if(!r.ok)return null;let out='';for(const x of d?.output||[])if(x.type==='message')for(const c of x.content||[])if(c.type==='output_text')out+=c.text;return parseJson(out)}catch{return null}}
async function card(name:string){for(const mode of ['exact','fuzzy'] as const){try{const r=await fetch(`https://api.scryfall.com/cards/named?${mode}=${encodeURIComponent(name)}`,{headers:{'User-Agent':'MarketplaceScout/1.3 (+video synergy relationships)'}});if(!r.ok)continue;const c=await r.json();if(c?.id)return{name:String(c.name),id:String(c.id),set:String(c.set||''),released_at:String(c.released_at||''),oracle_id:String(c.oracle_id||'')}}catch{}}return null}
function signalDate(p:any){const d=String(p?.published_at||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(d)?d:new Date().toISOString().slice(0,10)}
function trigger(text:string){let best:any=null;for(const t of TRIGGERS)if(t.re.test(text)&&(!best||t.p>best.p))best=t;return best}
async function resolveRelationship(context:string,current:string,label:string,title:string){return oa(`You are extracting ONE explicit Magic: The Gathering deck-building relationship from a Commander set-review transcript. The CURRENT segment contains a strong recommendation (${label}). Identify: (1) the NEW/UPCOMING commander or card whose deck is being discussed, using the preceding context; and (2) the EXISTING printed card being recommended because of that new card. Return ONLY JSON {"source_card":string|null,"target_card":string|null,"relationship_type":"new_card_synergy"|"upgrade_for"|"combo_with"|"enabler_for"|"payoff_for"|"other","confidence":number,"summary":string}. The source and target MUST be different cards. The target MUST be explicitly named in CURRENT or the immediately preceding sentence and must be the thing being praised/recommended. Do not return the new card itself as target. If the passage is only evaluating the new card and does not recommend an existing card, return nulls. Episode=${title}\nPRECEDING CONTEXT:\n${context}\nCURRENT:\n${current}`,850)}

Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:C});
 if(req.method!=='POST')return J({error:'POST required'},405);
 const t=bearer(req);if(!t||!(await auth(t)))return J({error:'Service authentication required'},401);if(!S)return J({error:'Service role unavailable'},500);
 let b:any={};try{b=await req.json()}catch{}const targetVideo=trim(b?.video_id,100),force=!!b?.force;
 try{
  const rows=await rest('source_captures?select=capture_id,user_id,source,payload_json,metadata_json&capture_type=eq.video_transcript&order=captured_at.desc&limit=120');let cap:any=null;
  for(const r of rows||[]){const p=r.payload_json||{};if(!UUID.test(String(r.user_id||''))||r?.metadata_json?.status!=='saved')continue;if(!['commander_product','commander_gameplay'].includes(String(p.creator_lane||'')))continue;if(targetVideo&&p.video_id!==targetVideo)continue;if(!Array.isArray(p.segments)||!p.segments.length)continue;if(!force&&Number(r?.metadata_json?.synergy_relationships_saved||0)>0)continue;cap=r;break}
  if(!cap)return J({ok:true,processed:0,relationships_saved:0,reason:'no_eligible_cached_video'});
  const p=cap.payload_json,segments=p.segments,owner=String(cap.user_id),date=signalDate(p),hits:any[]=[];
  for(let i=0;i<segments.length;i++){const text=String(segments[i]?.text||'');const tr=trigger(text);if(!tr)continue;hits.push({i,start_ms:Math.max(0,Math.round(Number(segments[i]?.offset)||0)),...tr,evidence:trim(text,1500)})}
  hits.sort((a,b)=>b.p-a.p||a.start_ms-b.start_ms);const selected:any[]=[];for(const h of hits){if(selected.some(x=>Math.abs(x.start_ms-h.start_ms)<18000))continue;selected.push(h);if(selected.length>=24)break}
  let saved=0,rejected=0,actionable=0;const output:any[]=[];
  for(const h of selected){const context=[segments[h.i-3]?.text,segments[h.i-2]?.text,segments[h.i-1]?.text].filter(Boolean).join(' ');const rel=await resolveRelationship(trim(context,3600),h.evidence,h.label,String(p.title||''));if(!rel?.source_card||!rel?.target_card||norm(rel.source_card)===norm(rel.target_card)){rejected++;continue}
   const [source,target]=await Promise.all([card(rel.source_card),card(rel.target_card)]);if(!source||!target||source.id===target.id){rejected++;continue}
   const sourceFuture=!!source.released_at&&source.released_at>date;const targetExisting=!target.released_at||target.released_at<=date;
   if(!targetExisting){rejected++;continue}
   const catalog=await rest(`scout_card_catalog?select=sku_id&scryfall_id=eq.${encodeURIComponent(target.id)}&limit=1`).catch(()=>[]);const targetActionable=Array.isArray(catalog)&&catalog.length>0;
   const url=p.url||`https://www.youtube.com/watch?v=${p.video_id}`;const type=['new_card_synergy','upgrade_for','combo_with','enabler_for','payoff_for','other'].includes(String(rel.relationship_type))?String(rel.relationship_type):'new_card_synergy';
   let intelId:string|null=null;const existing=await rest(`market_intel_items?select=intel_id,metadata_json&user_id=eq.${encodeURIComponent(owner)}&source_url=eq.${encodeURIComponent(url)}&limit=200`).catch(()=>[]);const key=`synergy|${p.video_id}|${h.start_ms}|${norm(target.name)}|${norm(source.name)}`;intelId=(existing||[]).find((q:any)=>String(q?.metadata_json?.video_event_key||'')===key)?.intel_id||null;
   if(!intelId){const ins=await rest('market_intel_items',{method:'POST',prefer:'return=representation',body:{user_id:owner,source_type:'youtube',source_name:cap.source||'YouTube',source_url:url,title:p.title||target.name,author:cap.source||null,summary:trim(rel.summary,1000)||`${target.name} recommended for ${source.name}`,claim_type:'product',direction:'bullish',signal_stage:'leading',confidence:Math.max(.65,Math.min(.98,Number(rel.confidence)||.82)),published_at:p.published_at||null,source_profile:'creator_commander',source_subtype:'new_commander_synergy',metadata_json:{platform:'youtube',video_id:p.video_id,channel_id:p.channel_id||null,creator_lane:p.creator_lane||'commander_product',video_event_key:key,event_type:'new_commander_synergy',start_ms:h.start_ms,prominence:h.p,relationship_source_card:source.name,relationship_target_card:target.name,relationship_type:type,source_is_unreleased:sourceFuture,target_is_actionable:targetActionable,trigger_label:h.label,resolution_method:'relationship_context+scryfall'}}});intelId=Array.isArray(ins)?ins[0]?.intel_id:null;if(intelId)await rest('market_intel_entities',{method:'POST',prefer:'return=minimal',body:{intel_id:intelId,user_id:owner,entity_type:'card',entity_name:target.name,scryfall_id:target.id,set_code:target.set,confidence:.94}}).catch(()=>null)}
   await rest('market_intel_card_relationships',{method:'POST',prefer:'resolution=ignore-duplicates,return=minimal',body:{user_id:owner,source_intel_id:intelId,source_video_id:p.video_id,source_name:cap.source||'YouTube',source_url:url,source_card_name:source.name,source_scryfall_id:source.id,source_release_date:source.released_at||null,target_card_name:target.name,target_scryfall_id:target.id,target_release_date:target.released_at||null,relationship_type:type,direction:'bullish',conviction:Math.max(h.p,clamp(rel.confidence)),start_ms:h.start_ms,evidence:h.evidence,summary:trim(rel.summary,1000),source_is_unreleased:sourceFuture,target_is_actionable:targetActionable}}).catch(()=>null);
   if(intelId)await rest('market_intel_video_events',{method:'POST',prefer:'resolution=ignore-duplicates,return=minimal',body:{intel_id:intelId,user_id:owner,video_id:p.video_id,channel_id:p.channel_id||null,channel_name:cap.source||null,creator_lane:p.creator_lane||'commander_product',event_type:'new_commander_synergy',start_ms:h.start_ms,end_ms:null,prominence:h.p,evidence:h.evidence,transcript_provider:'supadata',transcript_mode:'native'}}).catch(()=>null);
   saved++;if(targetActionable)actionable++;output.push({source_card:source.name,target_card:target.name,relationship_type:type,conviction:h.p,source_unreleased:sourceFuture,target_actionable:targetActionable,start_ms:h.start_ms,evidence:trim(h.evidence,260)})
  }
  if(saved){await rpc('refresh_market_intel_entity_links',{}).catch(()=>null);await rpc('refresh_market_intel_evaluations',{}).catch(()=>null)}
  await rest(`source_captures?capture_id=eq.${encodeURIComponent(cap.capture_id)}&user_id=eq.${encodeURIComponent(owner)}`,{method:'PATCH',body:{metadata_json:{...(cap.metadata_json||{}),synergy_relationships_saved:saved,synergy_relationships_actionable:actionable,synergy_relationships_processed_at:new Date().toISOString(),synergy_relationship_trigger_hits:hits.length,synergy_relationship_candidates:selected.length}}}).catch(()=>null);
  return J({ok:true,processed:1,video_id:p.video_id,title:p.title,channel:cap.source,trigger_hits:hits.length,candidates:selected.length,rejected,relationships_saved:saved,actionable_relationships:actionable,relationships:output,transcript_credits_used:0});
 }catch(e){return J({error:(e as Error).message},502)}
});
