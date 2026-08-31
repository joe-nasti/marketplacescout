import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-collectish-cron-key, content-type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const n=(v:any)=>Number.isFinite(Number(v))?Number(v):0;
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,n(v)));
const lower=(s:any)=>String(s||'').trim().toLowerCase();
const baseName=(s:any)=>String(s||'').replace(/\s*\([^)]*(foil|showcase|borderless|extended art|serialized|retro frame|etched|alternate art|halo foil|rainbow foil|surge foil|galaxy foil)[^)]*\)\s*/ig,' ').replace(/\s+/g,' ').trim();
const STAGE:any={leading:2.25,confirming:3.25,lagging:.75,neutral:0,unclassified:.25,noise:0};
const DIR:any={bullish:1,bearish:-1,neutral:0};
const SRC:any={official:1.25,article:1,youtube:1,x:.8,twitter:.8,reddit:.65,discord:.55,manual:.5,other:.5};
const VER='catalyst-shadow-v1';
const H=()=>({apikey:S,Authorization:`Bearer ${S}`,'Content-Type':'application/json'});

async function rest(path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}
async function cronOk(key:string){if(!key)return false;const x=await rest('rpc/verify_collectish_cron_key',{method:'POST',body:{p_key:key}}).catch(()=>false);return x===true}
async function all(path:string,page=1000){const out:any[]=[];for(let from=0;;from+=page){const j=path.includes('?')?'&':'?';const rows=await rest(`${path}${j}limit=${page}&offset=${from}`);out.push(...(rows||[]));if(!Array.isArray(rows)||rows.length<page)break}return out}
function hostname(v:any){try{return new URL(String(v)).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}}
function sourceKey(i:any){return lower(hostname(i?.source_url)||i?.source_name||i?.author||i?.source_type||'unknown')}
function eventKey(i:any){const url=String(i?.source_url||'').replace(/[?#].*$/,'').toLowerCase();return url||`${sourceKey(i)}|${lower(i?.title||i?.summary).slice(0,120)}`}
function ageDays(v:any,now=Date.now()){const t=new Date(v||0).getTime();return Number.isFinite(t)&&t>0?Math.max(0,(now-t)/86400000):30}
function recency(d:number){if(d<=2)return 1;if(d<=7)return .9;if(d<=21)return .7;if(d<=45)return .45;if(d<=90)return .25;return .1}
function conf(i:any){const raw=i?.confidence??null;if(raw==null)return 1;const x=n(raw);return clamp(x>1?x/100:x,.35,1)}
function pts(i:any,now:number){const stage=STAGE[lower(i?.signal_stage)]??.25,dir=DIR[lower(i?.direction)]??0;if(!stage||!dir)return 0;return stage*dir*(SRC[lower(i?.source_type)]??.75)*recency(ageDays(i?.observed_at,now))*conf(i)}
function grade(s:any){const x=n(s);return x>=80?'A':x>=70?'B':x>=60?'C':x>=50?'D':'F'}
function unique(items:any[]){const seen=new Set<string>(),out:any[]=[];for(const i of items){const k=eventKey(i);if(!k||seen.has(k))continue;seen.add(k);out.push(i)}return out}
function score(row:any,signals:any[]){const now=Date.now(),d=unique(signals),sources=new Set<string>();let raw=0;for(const i of d){const p=pts(i,now);raw+=p;if(p!==0)sources.add(sourceKey(i))}if(sources.size>=2)raw+=Math.sign(raw||1)*Math.min(3,(sources.size-1)*1.25);const mod=clamp(Math.round(raw),-8,12),base=n(row.promoted_score??row.v5_shadow_score??row.opportunity_score),shadow=clamp(base+mod,0,100),sourceKeys=[...sources].sort(),intelIds=d.map(i=>String(i.intel_id||'')).filter(Boolean).sort(),times=d.map(i=>new Date(i.observed_at||0).getTime()).filter(t=>Number.isFinite(t)&&t>0),signalMaxAt=times.length?new Date(Math.max(...times)).toISOString():null,catalystKey=[...d.map(eventKey).sort(),...sourceKeys.map(x=>`source:${x}`)].filter(Boolean).join('|').slice(0,4000);return{raw,mod,base,shadow,sourceKeys,intelIds,signalMaxAt,catalystKey,signalCount:d.length,sourceCount:sources.size}}
function add(m:Map<string,Set<string>>,k:any,v:any){if(k==null||k==='')return;const s=String(k);if(!m.has(s))m.set(s,new Set());m.get(s)!.add(String(v))}
function indexLinks(xs:any[]){const sf=new Map<string,Set<string>>(),pid=new Map<string,Set<string>>(),name=new Map<string,Set<string>>();for(const x of xs){if(!x.intel_id)continue;add(sf,x.scryfall_id,x.intel_id);add(pid,x.product_id,x.intel_id);add(name,lower(baseName(x.entity_name||x.card_name)),x.intel_id)}return{sf,pid,name}}
function links(row:any,idx:any){const out=new Set<string>();const merge=(s?:Set<string>)=>s?.forEach(x=>out.add(x));merge(idx.sf.get(String(row.scryfall_id||'')));merge(idx.pid.get(String(row.product_id||'')));merge(idx.name.get(lower(baseName(row.product_name))));return out}
async function startRun(){const r=await rest('market_intel_catalyst_shadow_recorder_runs',{method:'POST',prefer:'return=representation',body:{status:'running'}});return r?.[0]?.run_id||null}
async function finishRun(id:any,patch:any){if(!id)return;await rest(`market_intel_catalyst_shadow_recorder_runs?run_id=eq.${id}`,{method:'PATCH',prefer:'return=minimal',body:{completed_at:new Date().toISOString(),...patch}})}

async function capture(){const runId=await startRun();try{const cutoff=new Date(Date.now()-45*86400000).toISOString();const [scout,items,entities,mentions]=await Promise.all([
 all('scout_opportunities_v5_cache?select=user_id,sku_id,product_id,product_name,scryfall_id,promoted_score,promoted_grade,v5_shadow_score,v5_shadow_grade,opportunity_score&order=promoted_score.desc'),
 all(`market_intel_items?select=intel_id,user_id,source_type,source_name,source_url,title,author,summary,direction,signal_stage,confidence,observed_at&observed_at=gte.${encodeURIComponent(cutoff)}&order=observed_at.desc`),
 all(`market_intel_entities?select=intel_id,user_id,entity_name,scryfall_id,product_id,created_at&created_at=gte.${encodeURIComponent(cutoff)}`),
 all(`market_intel_card_mentions?select=intel_id,user_id,card_name,scryfall_id,product_id,created_at&created_at=gte.${encodeURIComponent(cutoff)}`)
]);const byId=new Map(items.map((x:any)=>[x.intel_id,x])),idx=indexLinks([...entities,...mentions]),chosen=new Map<string,any>();for(const row of scout){const signals=[...links(row,idx)].map(id=>byId.get(id)).filter((x:any)=>x&&x.user_id===row.user_id);if(!signals.length)continue;const s=score(row,signals);if(!s.catalystKey||!s.signalCount)continue;const sampleKey=`${row.user_id}|${lower(baseName(row.product_name))}|${s.catalystKey}|${VER}`;if(chosen.has(sampleKey))continue;chosen.set(sampleKey,{user_id:row.user_id,sku_id:Number(row.sku_id),product_id:row.product_id==null?null:Number(row.product_id),scryfall_id:row.scryfall_id||null,card_name:String(row.product_name||'Unknown card'),official_score:s.base,official_grade:row.promoted_grade||row.v5_shadow_grade||grade(s.base),shadow_modifier:s.mod,shadow_score:s.shadow,shadow_grade:grade(s.shadow),raw_modifier:s.raw,future_release:false,future_thesis_modifier:null,independent_sources:s.sourceCount,unique_events:s.signalCount,source_keys:s.sourceKeys,intel_ids:s.intelIds,catalyst_key:s.catalystKey,scorer_version:VER,signal_max_at:s.signalMaxAt})}
const payload=[...chosen.values()];let inserted=0;const conflict='on_conflict=user_id%2Csku_id%2Ccatalyst_key%2Cofficial_score%2Cscorer_version';for(let i=0;i<payload.length;i+=100){const rows=await rest(`market_intel_catalyst_shadow_snapshots?${conflict}`,{method:'POST',prefer:'resolution=ignore-duplicates,return=representation',body:payload.slice(i,i+100)});inserted+=Array.isArray(rows)?rows.length:0}await finishRun(runId,{status:'ok',scout_rows:scout.length,recent_intel:items.length,candidates:payload.length,inserted});return{ok:true,run_id:runId,scout_rows:scout.length,recent_intel:items.length,candidates:payload.length,inserted}}catch(e){await finishRun(runId,{status:'failed',error:String((e as Error).message||e).slice(0,2000)}).catch(()=>{});throw e}}

Deno.serve(async(req:Request)=>{if(req.method==='OPTIONS')return new Response('ok',{headers:C});if(!['GET','POST'].includes(req.method))return J({error:'GET or POST required'},405);if(!(await cronOk(req.headers.get('x-collectish-cron-key')||'')))return J({error:'Unauthorized'},401);try{return J(await capture())}catch(e){return J({error:String((e as Error).message||e)},502)}});
