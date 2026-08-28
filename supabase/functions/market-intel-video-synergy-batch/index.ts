import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const O=Deno.env.get('OPENAI_API_KEY')||'';
const M=Deno.env.get('MARKET_INTEL_MODEL')||'gpt-5-mini';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json'}});
const H=()=>({apikey:S,Authorization:`Bearer ${S}`,'Content-Type':'application/json'});
const trim=(x:any,n=1800)=>String(x??'').trim().slice(0,n);
const norm=(s:any)=>String(s||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const UUID=/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const TRIGGERS=[
 [/\bthis card is busted\b|\bcard is busted\b/i,.97,'busted'],
 [/\bone of the best cards? in the deck\b|\bbest card in the deck\b|\bone of the better cards? in the deck\b/i,.96,'best in deck'],
 [/\bmight be the best\b|\bprobably the best\b/i,.95,'might be best'],
 [/\bthe perfect card\b|\bis perfect\b|\bperfect for\b|\bexactly what the doctor ordered\b/i,.93,'perfect fit'],
 [/\bis insane\b|\bthat's insane\b|\bpretty gross\b|\bsuper sick\b|\bfinally playable\b/i,.92,'exceptional synergy'],
 [/\breally powerful\b|\bvery powerful\b/i,.90,'powerful'],
 [/\breally good in this deck\b|\breally good with\b|\bworks? really well\b|\bonly if you have\b|\bseems really good in this deck\b/i,.87,'strong synergy'],
 [/\byou(?:'|’)ll want\b|\byou will want\b|\bobvious include\b|\bmost obvious include\b/i,.86,'explicit include'],
 [/\bi would (?:play|put|combine|include)\b|\bone of the better cards?\b/i,.82,'recommendation'],
 [/\bgood in this deck\b|\bgood option\b|\bpretty sweet in this deck\b|\breally good card\b|\bvery good\b/i,.78,'positive synergy']
];

async function rest(path:string,opt:any={}){
 const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});
 const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}
 if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d;
}
async function serviceAuth(token:string){if(!token)return false;if(S&&token===S)return true;try{const r=await fetch(`${U}/auth/v1/admin/users?page=1&per_page=1`,{headers:{apikey:token,Authorization:`Bearer ${token}`}});return r.ok}catch{return false}}
function parseJson(raw:string){const s=String(raw||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');try{return JSON.parse(s)}catch{}const a=s.indexOf('{'),z=s.lastIndexOf('}');if(a>=0&&z>a){try{return JSON.parse(s.slice(a,z+1).replace(/,\s*([}\]])/g,'$1'))}catch{}}return {relationships:[]}}
function anchored(name:string,h:any){const n=norm(name),hay=norm(`${h.context} ${h.evidence}`);return !!n&&hay.includes(n)}
async function resolveOne(h:any,title:string){
 const prompt=`You extract one Magic: The Gathering Commander-review recommendation passage. Return compact JSON {"relationships":[{"source_card":string,"target_card":string,"relationship_type":"new_card_synergy"|"upgrade_for"|"combo_with"|"enabler_for"|"payoff_for"|"other","confidence":number,"summary":string}]}. TARGET CARD MUST be a card name literally present in SECTION CONTEXT or PRAISE PASSAGE. Never supply a card from outside the provided text. The target is the existing card being praised. SOURCE CARD is the newly reviewed commander/card responsible for the recommendation; it should also be grounded in the section. Skip generic praise of the source card. Skip negative/anti-synergy statements such as 'does not work'. Return at most ONE relationship: choose the card most directly attached to the praise trigger. Summary <=14 words. Video=${title}\nLABEL=${h.label}\nSECTION CONTEXT: ${h.context}\nPRAISE PASSAGE: ${h.evidence}`;
 const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${O}`,'Content-Type':'application/json'},body:JSON.stringify({model:M,store:false,input:prompt,reasoning:{effort:'minimal'},max_output_tokens:900})});
 const d=await r.json();if(!r.ok)throw Error(d?.error?.message||`OpenAI ${r.status}`);let out='';for(const x of d?.output||[])if(x.type==='message')for(const c of x.content||[])if(c.type==='output_text')out+=c.text;
 const rels=Array.isArray(parseJson(out)?.relationships)?parseJson(out).relationships:[];return rels.slice(0,1).map((x:any)=>({...x,id:h.id}));
}
async function resolveAll(selected:any[],title:string,concurrency=6){const out:any[]=[];let cursor=0;async function worker(){while(true){const i=cursor++;if(i>=selected.length)return;try{out.push(...await resolveOne(selected[i],title))}catch{}}}await Promise.all(Array.from({length:Math.min(concurrency,selected.length)},()=>worker()));return out}
async function card(name:string){for(const mode of ['exact','fuzzy']){try{const r=await fetch(`https://api.scryfall.com/cards/named?${mode}=${encodeURIComponent(name)}`,{headers:{'User-Agent':'MarketplaceScout/1.4'}});if(r.ok){const c=await r.json();if(c?.id)return{name:String(c.name),id:String(c.id),set:String(c.set||''),released_at:String(c.released_at||'')}}}catch{}}return null}
function trigger(text:string){for(const [re,p,label] of TRIGGERS as any[])if(re.test(text))return{p,label};return null}

Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:C});if(req.method!=='POST')return J({error:'POST required'},405);
 const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');if(!S||!(await serviceAuth(token)))return J({error:'Service authentication required'},401);
 let body:any={};try{body=await req.json()}catch{}
 try{
  const caps=await rest('source_captures?select=capture_id,user_id,source,payload_json,metadata_json&capture_type=eq.video_transcript&order=captured_at.desc&limit=120');let cap:any=null;
  for(const r of caps||[]){const p=r.payload_json||{};if(!UUID.test(String(r.user_id||''))||r?.metadata_json?.status!=='saved'||!['commander_product','commander_gameplay'].includes(String(p.creator_lane||''))||!Array.isArray(p.segments)||!p.segments.length)continue;if(body.video_id&&p.video_id!==body.video_id)continue;if(!body.force&&Number(r?.metadata_json?.synergy_relationships_saved||0)>0)continue;cap=r;break}
  if(!cap)return J({ok:true,processed:0,reason:'no_eligible_cached_video',transcript_credits_used:0});
  const p=cap.payload_json,s=p.segments,owner=String(cap.user_id),date=String(p.published_at||new Date().toISOString()).slice(0,10),hits:any[]=[];
  for(let i=0;i<s.length;i++){const h=trigger(String(s[i]?.text||''));if(!h)continue;const context=[];for(let k=Math.max(0,i-12);k<i;k++)context.push(s[k]?.text);hits.push({i,start_ms:Math.max(0,Math.round(Number(s[i]?.offset)||0)),prominence:h.p,label:h.label,evidence:trim(s[i]?.text,1700),context:trim(context.filter(Boolean).join(' '),7600)})}
  hits.sort((a,b)=>a.start_ms-b.start_ms||b.prominence-a.prominence);const selected:any[]=[];
  for(const h of hits){if(selected.some(x=>Math.abs(x.start_ms-h.start_ms)<10000)){const near=selected.find(x=>Math.abs(x.start_ms-h.start_ms)<10000);if(near&&h.prominence>near.prominence)Object.assign(near,h);continue}selected.push({...h,id:0});if(selected.length>=40)break}selected.forEach((h,i)=>h.id=i);
  const resolved=await resolveAll(selected,String(p.title||''),6);
  let saved=0,actionable=0,rejected=0;const output:any[]=[];const seen=new Set<string>();
  for(const rel of resolved){
   const h=selected.find(x=>x.id===Number(rel.id));if(!h||!rel.source_card||!rel.target_card||norm(rel.source_card)===norm(rel.target_card)||!anchored(rel.target_card,h)){rejected++;continue}
   const localKey=`${h.id}|${norm(rel.source_card)}|${norm(rel.target_card)}`;if(seen.has(localKey))continue;seen.add(localKey);
   const [src,tgt]=await Promise.all([card(rel.source_card),card(rel.target_card)]);if(!src||!tgt||src.id===tgt.id){rejected++;continue}
   const sourceFuture=!!src.released_at&&src.released_at>date;const targetExisting=!tgt.released_at||tgt.released_at<=date;
   if(!targetExisting||(p.creator_lane==='commander_product'&&!sourceFuture)){rejected++;continue}
   const catalog=await rest(`scout_card_catalog?select=sku_id&scryfall_id=eq.${encodeURIComponent(tgt.id)}&limit=1`).catch(()=>[]);const isActionable=Array.isArray(catalog)&&catalog.length>0;
   const url=p.url||`https://www.youtube.com/watch?v=${p.video_id}`;const type=['new_card_synergy','upgrade_for','combo_with','enabler_for','payoff_for','other'].includes(String(rel.relationship_type))?String(rel.relationship_type):'new_card_synergy';const key=`synergy|${p.video_id}|${h.start_ms}|${norm(tgt.name)}|${norm(src.name)}`;
   let intelId:any=null;const existing=await rest(`market_intel_items?select=intel_id,metadata_json&user_id=eq.${owner}&source_url=eq.${encodeURIComponent(url)}&limit=400`).catch(()=>[]);intelId=(existing||[]).find((q:any)=>q?.metadata_json?.video_event_key===key)?.intel_id||null;
   if(!intelId){const ins=await rest('market_intel_items',{method:'POST',prefer:'return=representation',body:{user_id:owner,source_type:'youtube',source_name:cap.source||'YouTube',source_url:url,title:p.title||tgt.name,author:cap.source||null,summary:trim(rel.summary,500)||`${tgt.name} recommended for ${src.name}`,claim_type:'product',direction:'bullish',signal_stage:'leading',confidence:Math.max(.65,Math.min(.98,Number(rel.confidence)||.82)),published_at:p.published_at||null,source_profile:'creator_commander',source_subtype:'new_commander_synergy',metadata_json:{platform:'youtube',video_id:p.video_id,video_event_key:key,event_type:'new_commander_synergy',start_ms:h.start_ms,prominence:h.prominence,relationship_source_card:src.name,relationship_target_card:tgt.name,relationship_type:type,source_is_unreleased:sourceFuture,target_is_actionable:isActionable,resolution_method:'transcript_anchored_single_passage+scryfall'}}});intelId=ins?.[0]?.intel_id||null;if(intelId)await rest('market_intel_entities',{method:'POST',prefer:'return=minimal',body:{intel_id:intelId,user_id:owner,entity_type:'card',entity_name:tgt.name,scryfall_id:tgt.id,set_code:tgt.set,confidence:.96}}).catch(()=>null)}
   await rest('market_intel_card_relationships',{method:'POST',prefer:'resolution=ignore-duplicates,return=minimal',body:{user_id:owner,source_intel_id:intelId,source_video_id:p.video_id,source_name:cap.source||'YouTube',source_url:url,source_card_name:src.name,source_scryfall_id:src.id,source_release_date:src.released_at||null,target_card_name:tgt.name,target_scryfall_id:tgt.id,target_release_date:tgt.released_at||null,relationship_type:type,direction:'bullish',conviction:Math.max(h.prominence,Math.min(.98,Number(rel.confidence)||.82)),start_ms:h.start_ms,evidence:h.evidence,summary:trim(rel.summary,500),source_is_unreleased:sourceFuture,target_is_actionable:isActionable}}).catch(()=>null);
   if(intelId)await rest('market_intel_video_events',{method:'POST',prefer:'resolution=ignore-duplicates,return=minimal',body:{intel_id:intelId,user_id:owner,video_id:p.video_id,channel_id:p.channel_id||null,channel_name:cap.source||null,creator_lane:p.creator_lane||'commander_product',event_type:'new_commander_synergy',start_ms:h.start_ms,end_ms:null,prominence:h.prominence,evidence:h.evidence,transcript_provider:'supadata',transcript_mode:'native'}}).catch(()=>null);
   saved++;if(isActionable)actionable++;output.push({source_card:src.name,target_card:tgt.name,relationship_type:type,conviction:h.prominence,source_unreleased:sourceFuture,target_actionable:isActionable,start_ms:h.start_ms});
  }
  if(saved){await rest('rpc/refresh_market_intel_entity_links',{method:'POST',body:{}}).catch(()=>null);await rest('rpc/refresh_market_intel_evaluations',{method:'POST',body:{}}).catch(()=>null)}
  await rest(`source_captures?capture_id=eq.${cap.capture_id}&user_id=eq.${owner}`,{method:'PATCH',body:{metadata_json:{...(cap.metadata_json||{}),synergy_relationships_saved:saved,synergy_relationships_actionable:actionable,synergy_relationships_processed_at:new Date().toISOString(),synergy_relationship_trigger_hits:hits.length,synergy_relationship_candidates:selected.length,synergy_relationship_batch_version:12}}}).catch(()=>null);
  return J({ok:true,processed:1,video_id:p.video_id,title:p.title,trigger_hits:hits.length,candidates:selected.length,rejected,relationships_saved:saved,actionable_relationships:actionable,relationships:output,transcript_credits_used:0});
 }catch(e){return J({error:(e as Error).message},502)}
});
