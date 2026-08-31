const SUPABASE_URL=(process.env.SUPABASE_URL||'https://bnsnlikjeogzdubgyvxk.supabase.co').replace(/\/$/,'');
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
if(!KEY)throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

const n=v=>Number.isFinite(Number(v))?Number(v):0;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,n(v)));
const lower=s=>String(s||'').trim().toLowerCase();
const baseName=s=>String(s||'').replace(/\s*\([^)]*(foil|showcase|borderless|extended art|serialized|retro frame|etched|alternate art|halo foil|rainbow foil|surge foil|galaxy foil)[^)]*\)\s*/ig,' ').replace(/\s+/g,' ').trim();
const STAGE_WEIGHT={leading:2.25,confirming:3.25,lagging:.75,neutral:0,unclassified:.25,noise:0};
const DIRECTION={bullish:1,bearish:-1,neutral:0};
const SOURCE_WEIGHT={official:1.25,article:1,youtube:1,x:.8,twitter:.8,reddit:.65,discord:.55,manual:.5,other:.5};
const SCORER_VERSION='catalyst-shadow-v1';

function hostname(value){try{return new URL(value).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}}
function sourceKey(item){return lower(hostname(item?.source_url)||item?.source_name||item?.author||item?.source_type||'unknown')}
function eventKey(item){const url=String(item?.source_url||'').replace(/[?#].*$/,'').toLowerCase();if(url)return url;return `${sourceKey(item)}|${lower(item?.title||item?.summary).slice(0,120)}`}
function ageDays(value,now=Date.now()){const t=new Date(value||0).getTime();return Number.isFinite(t)&&t>0?Math.max(0,(now-t)/86400000):30}
function recencyFactor(days){if(days<=2)return 1;if(days<=7)return .9;if(days<=21)return .7;if(days<=45)return .45;if(days<=90)return .25;return .1}
function confidenceFactor(item){const raw=item?.confidence??null;if(raw==null)return 1;const x=n(raw);return clamp(x>1?x/100:x,.35,1)}
function signalPoints(item,now){const stage=STAGE_WEIGHT[lower(item?.signal_stage)]??.25,direction=DIRECTION[lower(item?.direction)]??0;if(!stage||!direction)return 0;const source=SOURCE_WEIGHT[lower(item?.source_type)]??.75;return stage*direction*source*recencyFactor(ageDays(item?.observed_at,now))*confidenceFactor(item)}
function gradeFor(score){const s=n(score);if(s>=80)return'A';if(s>=70)return'B';if(s>=60)return'C';if(s>=50)return'D';return'F'}
function uniqueSignals(items=[]){const seen=new Set(),out=[];for(const item of items){const k=eventKey(item);if(!k||seen.has(k))continue;seen.add(k);out.push(item)}return out}
function score(row,signals,now=Date.now()){
  const deduped=uniqueSignals(signals);let raw=deduped.reduce((sum,item)=>sum+signalPoints(item,now),0);
  const sources=new Set(deduped.filter(x=>signalPoints(x,now)!==0).map(sourceKey).filter(Boolean));
  if(sources.size>=2)raw+=Math.sign(raw||1)*Math.min(3,(sources.size-1)*1.25);
  const bounded=clamp(Math.round(raw),-8,12),base=n(row.promoted_score??row.v5_shadow_score??row.opportunity_score),shadow=clamp(base+bounded,0,100);
  const sourceKeys=[...sources].sort(),intelIds=deduped.map(x=>String(x.intel_id||'')).filter(Boolean).sort();
  const times=deduped.map(x=>new Date(x.observed_at||0).getTime()).filter(x=>Number.isFinite(x)&&x>0),signalMaxAt=times.length?new Date(Math.max(...times)).toISOString():null;
  const catalystKey=[...deduped.map(eventKey).sort(),...sourceKeys.map(x=>`source:${x}`)].filter(Boolean).join('|').slice(0,4000);
  return {base,bounded,shadow,sourceKeys,intelIds,signalMaxAt,catalystKey,signalCount:deduped.length,sourceCount:sources.size,raw};
}
async function req(path,{method='GET',body,prefer}={}){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:{Authorization:`Bearer ${KEY}`,apikey:KEY,'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},body:body==null?undefined:JSON.stringify(body)});
  const text=await r.text();if(!r.ok)throw new Error(`${method} ${path} ${r.status}: ${text.slice(0,800)}`);return text?JSON.parse(text):[];
}
async function all(path,page=1000){const out=[];for(let from=0;;from+=page){const joiner=path.includes('?')?'&':'?';const rows=await req(`${path}${joiner}limit=${page}&offset=${from}`);out.push(...rows);if(rows.length<page)break}return out}
function add(map,key,value){if(!key)return;const k=String(key);if(!map.has(k))map.set(k,new Set());map.get(k).add(value)}
function indexLinks(entities,mentions){const bySf=new Map(),byPid=new Map(),byName=new Map();for(const x of [...entities,...mentions]){const id=x.intel_id;if(!id)continue;add(bySf,x.scryfall_id,id);add(byPid,x.product_id,id);add(byName,lower(baseName(x.entity_name||x.card_name)),id)}return{bySf,byPid,byName}}
function linkedIds(row,idx){const set=new Set();const merge=s=>s&&s.forEach(x=>set.add(x));merge(idx.bySf.get(String(row.scryfall_id||'')));merge(idx.byPid.get(String(row.product_id||'')));merge(idx.byName.get(lower(baseName(row.product_name))));return set}
async function startRun(){const rows=await req('market_intel_catalyst_shadow_recorder_runs',{method:'POST',prefer:'return=representation',body:{status:'running'}});return rows?.[0]?.run_id||null}
async function finishRun(runId,patch){if(!runId)return;await req(`market_intel_catalyst_shadow_recorder_runs?run_id=eq.${runId}`,{method:'PATCH',prefer:'return=minimal',body:{completed_at:new Date().toISOString(),...patch}})}
async function main(){
  const runId=await startRun();
  try{
    const cutoff=new Date(Date.now()-45*86400000).toISOString();
    const [scout,items,entities,mentions]=await Promise.all([
      all('scout_opportunities_v5_cache?select=user_id,sku_id,product_id,product_name,scryfall_id,promoted_score,promoted_grade,v5_shadow_score,v5_shadow_grade,opportunity_score&order=promoted_score.desc'),
      all(`market_intel_items?select=intel_id,user_id,source_type,source_name,source_url,title,author,summary,direction,signal_stage,confidence,observed_at&observed_at=gte.${encodeURIComponent(cutoff)}&order=observed_at.desc`),
      all(`market_intel_entities?select=intel_id,user_id,entity_name,scryfall_id,product_id,created_at&created_at=gte.${encodeURIComponent(cutoff)}`),
      all(`market_intel_card_mentions?select=intel_id,user_id,card_name,scryfall_id,product_id,created_at&created_at=gte.${encodeURIComponent(cutoff)}`)
    ]);
    const itemById=new Map(items.map(x=>[x.intel_id,x])),idx=indexLinks(entities,mentions),payload=[];
    for(const row of scout){
      const ids=linkedIds(row,idx),signals=[...ids].map(id=>itemById.get(id)).filter(x=>x&&x.user_id===row.user_id);
      if(!signals.length)continue;const s=score(row,signals);if(!s.catalystKey||!s.signalCount)continue;
      payload.push({user_id:row.user_id,sku_id:Number(row.sku_id),product_id:row.product_id==null?null:Number(row.product_id),scryfall_id:row.scryfall_id||null,card_name:String(row.product_name||'Unknown card'),official_score:s.base,official_grade:row.promoted_grade||row.v5_shadow_grade||gradeFor(s.base),shadow_modifier:s.bounded,shadow_score:s.shadow,shadow_grade:gradeFor(s.shadow),raw_modifier:s.raw,future_release:false,future_thesis_modifier:null,independent_sources:s.sourceCount,unique_events:s.signalCount,source_keys:s.sourceKeys,intel_ids:s.intelIds,catalyst_key:s.catalystKey,scorer_version:SCORER_VERSION,signal_max_at:s.signalMaxAt});
    }
    let inserted=0;const conflict='on_conflict=user_id%2Csku_id%2Ccatalyst_key%2Cofficial_score%2Cscorer_version';for(let i=0;i<payload.length;i+=100){const rows=await req(`market_intel_catalyst_shadow_snapshots?${conflict}`,{method:'POST',prefer:'resolution=ignore-duplicates,return=representation',body:payload.slice(i,i+100)});inserted+=Array.isArray(rows)?rows.length:0}
    await finishRun(runId,{status:'ok',scout_rows:scout.length,recent_intel:items.length,candidates:payload.length,inserted});
    console.log(JSON.stringify({run_id:runId,scout_rows:scout.length,recent_intel:items.length,candidates:payload.length,inserted,cutoff}));
  }catch(error){await finishRun(runId,{status:'failed',error:String(error?.message||error).slice(0,2000)}).catch(()=>{});throw error}
}
main().catch(err=>{console.error(err);process.exit(1)});
