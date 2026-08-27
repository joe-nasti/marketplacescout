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
const directions=new Set(['bullish','bearish','neutral']);
const stages=new Set(['leading','confirming','lagging','neutral','noise','unclassified']);

async function serviceAuth(t:string){if(!t)return false;if(S&&t===S)return true;try{const r=await fetch(`${U}/auth/v1/admin/users?page=1&per_page=1`,{headers:{apikey:t,Authorization:`Bearer ${t}`}});return r.ok}catch{return false}}
async function rest(path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(S),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
async function rpc(name:string,args:any={}){return rest(`rpc/${name}`,{method:'POST',body:args})}
function norm(s:any){return String(s||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')}
function mmss(ms:number){const s=Math.max(0,Math.floor(ms/1000));return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`}
function parseJson(raw:string){const s=String(raw||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');try{return JSON.parse(s)}catch{}const a=s.indexOf('{'),z=s.lastIndexOf('}');if(a>=0&&z>a){const slice=s.slice(a,z+1);try{return JSON.parse(slice)}catch{}try{return JSON.parse(slice.replace(/,\s*([}\]])/g,'$1'))}catch{}}throw Error('Event extractor returned invalid JSON')}
async function oa(prompt:string,maxOutput=3600){if(!OPENAI)throw Error('OPENAI_API_KEY not configured');const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${OPENAI}`,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,store:false,input:prompt,max_output_tokens:maxOutput})});const raw=await r.text();let d:any;try{d=JSON.parse(raw)}catch{d={error:{message:raw}}}if(!r.ok)throw Error(d?.error?.message||`OpenAI ${r.status}`);let out='';for(const x of d?.output||[])if(x.type==='message')for(const c of x.content||[])if(c.type==='output_text')out+=c.text;return out}
async function parseAnalysis(raw:string){try{return parseJson(raw)}catch{const repaired=await oa(`Repair this malformed or truncated JSON into valid JSON. Preserve only complete event objects you can recover. Return ONLY JSON in the shape {"events":[]}. MALFORMED JSON:\n${String(raw||'').slice(0,20000)}`,2600);return parseJson(repaired)}}
function editDistance(a:string,b:string){const x=norm(a),y=norm(b);if(x===y)return 0;if(!x.length)return y.length;if(!y.length)return x.length;let prev=Array.from({length:y.length+1},(_,i)=>i);for(let i=1;i<=x.length;i++){const cur=[i];for(let j=1;j<=y.length;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(x[i-1]===y[j-1]?0:1));prev=cur}return prev[y.length]}
function acceptableFuzzy(input:string,resolved:string){const a=norm(input),b=norm(resolved);if(!a||!b)return false;if(a===b)return true;const d=editDistance(a,b),max=Math.max(a.length,b.length);return d<=3||d/max<=0.2}
async function scryfall(name:string,mode:'exact'|'fuzzy'){try{const r=await fetch(`https://api.scryfall.com/cards/named?${mode}=${encodeURIComponent(name)}`,{headers:{'User-Agent':'MarketplaceScout/0.6 (+creator video signals)'}});if(!r.ok)return null;const c=await r.json();return c?.id?{name:String(c.name||name),scryfall_id:String(c.id),set_code:c.set?String(c.set):null}:null}catch{return null}}
async function resolveCard(name:string){const exact=await scryfall(name,'exact');if(exact)return exact;const fuzzy=await scryfall(name,'fuzzy');return fuzzy&&acceptableFuzzy(name,fuzzy.name)?fuzzy:null}
function claimFor(type:string){if(['competitive_test','competitive_result','deck_innovation'].includes(type))return'competitive';if(type==='reprint_reveal')return'reprint';if(['precon_reveal','new_commander_synergy','precon_upgrade','precon_cut','spoiler_reaction'].includes(type))return'product';return'demand'}
function subtypeFor(lane:string,type:string){if(type&&type!=='other')return type;if(lane==='competitive')return'competitive_test';if(lane==='commander_gameplay')return'commander_gameplay';if(lane==='commander_product')return'commander_product';return'creator_video'}
function eventKey(videoId:string,type:string,start:number,card:string){return `${videoId}|${type}|${start}|${norm(card)}`}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return J({error:'POST required'},405);
  const caller=bearer(req);if(!caller||!(await serviceAuth(caller)))return J({error:'Service authentication required'},401);
  if(!S)return J({error:'Service role unavailable'},500);
  let b:any={};try{b=await req.json()}catch{return J({error:'Invalid JSON'},400)}
  const owner=String(b?.user_id||''),segments=(Array.isArray(b?.segments)?b.segments:[]).slice(0,1500);
  const videoId=trim(b?.video_id,100),videoUrl=trim(b?.video_url||`https://www.youtube.com/watch?v=${videoId}`,2000),videoTitle=trim(b?.video_title,500),publishedAt=b?.published_at||null;
  const channelName=trim(b?.channel_name,160),channelId=trim(b?.channel_id,160),lane=['competitive','commander_gameplay','commander_product','general'].includes(String(b?.creator_lane))?String(b.creator_lane):'general';
  if(!UUID.test(owner)||!videoId||!segments.length)return J({error:'user_id, video_id and timestamped segments are required'},400);
  try{
    const transcript=segments.map((x:any)=>`[${mmss(Number(x?.offset)||0)}] ${trim(x?.text,1200)}`).join('\n').slice(0,68000);
    const prompt=`You extract timestamped Magic: The Gathering creator-video market events for Collectish. Return ONLY compact JSON {"events":[{"entity_name":string,"event_type":"competitive_test"|"competitive_result"|"deck_innovation"|"commander_showcase"|"commander_recommendation"|"precon_reveal"|"reprint_reveal"|"new_commander_synergy"|"precon_upgrade"|"precon_cut"|"spoiler_reaction"|"creator_convergence"|"other","direction":"bullish"|"bearish"|"neutral","signal_stage":"leading"|"confirming"|"lagging"|"neutral","confidence":number,"start_ms":integer,"end_ms":integer|null,"prominence":number,"evidence":string,"summary":string}]}. Return at most 12 strongest events. Keep evidence <=160 characters and summary <=220 characters. Correct obvious speech-to-text misspellings of MTG card names from context, but never invent a card not actually discussed. A mere card name, decklist inclusion, routine cast, rules explanation, or passing mention is NOT an event. Require a meaningful thesis, explicit recommendation, repeated competitive test/result discussion, memorable gameplay showcase, product/reprint reveal, upgrade/cut recommendation, or novel synergy. prominence must be 0..1 and >=0.55 for a surfaced event. confidence is confidence that the creator actually expressed the summarized evidence, not confidence the market will move. Convert transcript markers to milliseconds exactly: [18:42] means 1,122,000 ms. Do not invent timestamp precision between markers. Competitive creator experimentation is usually leading evidence; a documented result is confirming. A reprint reveal is generally bearish for existing printings. Creator lane: ${lane}. Channel: ${channelName||'unknown'}. Video: ${videoTitle||videoId}. Transcript:\n${transcript}`;
    const parsed=await parseAnalysis(await oa(prompt,4800));
    const candidates=(Array.isArray(parsed?.events)?parsed.events:[]).slice(0,12);
    const existing=await rest(`market_intel_items?select=intel_id,metadata_json&user_id=eq.${encodeURIComponent(owner)}&source_url=eq.${encodeURIComponent(videoUrl)}&limit=100`).catch(()=>[]);
    const existingByKey=new Map((existing||[]).map((x:any)=>[String(x?.metadata_json?.video_event_key||''),x]));
    const saved:any[]=[];let rejectedCards=0,belowThreshold=0,duplicates=0;
    for(const x of candidates){
      const prominence=clamp(x?.prominence);if(prominence<0.55){belowThreshold++;continue}
      const requested=trim(x?.entity_name,300);if(!requested)continue;
      const card=await resolveCard(requested);if(!card){rejectedCards++;continue}
      const type=eventTypes.has(String(x?.event_type))?String(x.event_type):'other';
      const start=Math.max(0,Math.round(Number(x?.start_ms)||0)),end=Number.isFinite(Number(x?.end_ms))?Math.max(start,Math.round(Number(x.end_ms))):null;
      const key=eventKey(videoId,type,start,card.name);let intelId=existingByKey.get(key)?.intel_id||null;
      if(intelId){duplicates++}else{
        const direction=directions.has(String(x?.direction))?String(x.direction):'neutral';
        const signalStage=stages.has(String(x?.signal_stage))?String(x.signal_stage):(lane==='competitive'?'leading':'neutral');
        const confidence=clamp(x?.confidence);
        const summary=trim(x?.summary||x?.evidence,1200)||`${card.name}: ${type.replace(/_/g,' ')}`;
        const inserted=await rest('market_intel_items',{method:'POST',prefer:'return=representation',body:{user_id:owner,source_type:'youtube',source_name:channelName||'YouTube',source_url:videoUrl,title:videoTitle||card.name,author:channelName||null,summary,claim_type:claimFor(type),direction,signal_stage:signalStage,confidence,published_at:publishedAt,source_profile:lane==='competitive'?'creator_competitive':'creator_commander',source_subtype:subtypeFor(lane,type),metadata_json:{platform:'youtube',video_id:videoId,channel_id:channelId||null,creator_lane:lane,transcript_provider:'supadata',transcript_mode:'native',timestamped:true,video_event_key:key,event_type:type,start_ms:start,end_ms:end,prominence}}});
        const item=Array.isArray(inserted)?inserted[0]:inserted;intelId=item?.intel_id||null;if(!intelId)continue;
        await rest('market_intel_entities',{method:'POST',prefer:'return=minimal',body:{intel_id:intelId,user_id:owner,entity_type:'card',entity_name:card.name,scryfall_id:card.scryfall_id,set_code:card.set_code,confidence:0.99}});
        existingByKey.set(key,{intel_id:intelId});
      }
      const eventRow={intel_id:intelId,user_id:owner,video_id:videoId,channel_id:channelId||null,channel_name:channelName||null,creator_lane:lane,event_type:type,start_ms:start,end_ms:end,prominence,evidence:trim(x?.evidence,900)||null,transcript_provider:'supadata',transcript_mode:'native'};
      await rest('market_intel_video_events',{method:'POST',prefer:'resolution=ignore-duplicates,return=minimal',body:eventRow}).catch(()=>null);
      saved.push({...eventRow,entity_name:card.name,direction:directions.has(String(x?.direction))?String(x.direction):'neutral'});
    }
    if(saved.length){await rpc('refresh_market_intel_entity_links',{}).catch(()=>null);await rpc('refresh_market_intel_evaluations',{}).catch(()=>null)}
    return J({ok:true,events_saved:saved.length,events_considered:candidates.length,duplicates,rejected_cards:rejectedCards,below_threshold:belowThreshold,events:saved,model:MODEL});
  }catch(e){return J({error:(e as Error).message},502)}
});
