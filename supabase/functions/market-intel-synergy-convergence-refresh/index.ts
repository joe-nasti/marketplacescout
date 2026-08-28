import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const U=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const H=()=>({apikey:S,Authorization:`Bearer ${S}`,'Content-Type':'application/json'});
const enc=(x:any)=>encodeURIComponent(String(x??''));
const keyOf=(x:any)=>String(x||'').trim().toLowerCase();

async function auth(token:string){if(!token)return false;if(S&&token===S)return true;try{const r=await fetch(`${U}/auth/v1/admin/users?page=1&per_page=1`,{headers:{apikey:token,Authorization:`Bearer ${token}`}});return r.ok}catch{return false}}
async function rest(path:string,opt:any={}){const r=await fetch(`${U}/rest/v1/${path}`,{method:opt.method||'GET',headers:{...H(),...(opt.prefer?{Prefer:opt.prefer}:{})},body:opt.body===undefined?undefined:JSON.stringify(opt.body)});const raw=await r.text();let d:any;try{d=raw?JSON.parse(raw):null}catch{d=raw}if(!r.ok)throw Error(d?.message||`REST ${r.status}`);return d}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return J({error:'POST required'},405);
  const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
  if(!S||!(await auth(token)))return J({error:'Service authentication required'},401);
  let body:any={};try{body=await req.json()}catch{}
  const limit=Math.max(1,Math.min(100,Number(body.limit??40)));
  try{
    const cutoff=new Date(Date.now()-14*86400000).toISOString();
    const rawRels=await rest(`market_intel_card_relationships?select=user_id,relationship_id,source_intel_id,source_name,target_card_name,target_scryfall_id,conviction,created_at&direction=eq.bullish&target_is_actionable=eq.true&created_at=gte.${enc(cutoff)}&order=conviction.desc,created_at.desc&limit=${limit*3}`);
    const seen=new Set<string>(),rels:any[]=[];
    for(const r of rawRels||[]){const k=`${r.user_id}|${r.target_scryfall_id}`;if(!r.target_scryfall_id||seen.has(k))continue;seen.add(k);rels.push(r);if(rels.length>=limit)break}
    let refreshed=0,totalSignals=0,multiSource=0,strong=0,noOracle=0;const details:any[]=[];
    for(const r of rels){
      const oracleRows=await rest(`mtgjson_cards?select=scryfall_oracle_id&scryfall_id=eq.${enc(r.target_scryfall_id)}&scryfall_oracle_id=not.is.null&limit=1`).catch(()=>[]);
      const oracleId=oracleRows?.[0]?.scryfall_oracle_id||null;if(!oracleId){noOracle++;continue}
      const catalyst=await rest(`market_intel_items?select=published_at,observed_at,created_at,source_name,source_type,source_profile&intel_id=eq.${enc(r.source_intel_id)}&user_id=eq.${enc(r.user_id)}&limit=1`).catch(()=>[]);
      const ci=catalyst?.[0]||{};const catalystAt=new Date(ci.published_at||ci.observed_at||ci.created_at||r.created_at||Date.now()).getTime();
      const windowStart=catalystAt-24*3600000,windowEnd=catalystAt+7*86400000;
      const links=await rest(`market_intel_scout_signal_links?select=intel_id&user_id=eq.${enc(r.user_id)}&oracle_id=eq.${enc(oracleId)}&limit=1000`).catch(()=>[]);
      const ids=[...new Set((links||[]).map((x:any)=>x.intel_id).filter((x:any)=>x&&x!==r.source_intel_id))];
      const items:any[]=[];
      for(let i=0;i<ids.length;i+=30){const q=ids.slice(i,i+30).join(',');if(!q)continue;const rows=await rest(`market_intel_items?select=intel_id,source_name,source_type,source_profile,source_subtype,published_at,observed_at,created_at&user_id=eq.${enc(r.user_id)}&intel_id=in.(${q})&limit=1000`).catch(()=>[]);items.push(...(rows||[]))}
      const catalystSource=keyOf(ci.source_name||r.source_name||ci.source_profile||ci.source_type);
      const valid=items.filter(x=>{const t=new Date(x.published_at||x.observed_at||x.created_at||0).getTime();const sk=keyOf(x.source_name||x.source_profile||x.source_type);return t>=windowStart&&t<=windowEnd&&sk&&sk!==catalystSource});
      const sourceKeys=new Set(valid.map(x=>keyOf(x.source_name||x.source_profile||x.source_type)).filter(Boolean));
      const typeKeys=new Set(valid.map(x=>keyOf(x.source_type||'unknown')).filter(Boolean));
      const creators=new Set(valid.filter(x=>keyOf(x.source_type)==='youtube'||keyOf(x.source_profile).includes('creator')).map(x=>keyOf(x.source_name||x.source_profile||x.source_type)));
      const nonvideo=new Set(valid.filter(x=>!(keyOf(x.source_type)==='youtube'||keyOf(x.source_profile).includes('creator'))).map(x=>keyOf(x.source_name||x.source_profile||x.source_type)));
      const n=sourceKeys.size,t=typeKeys.size;const score=Math.min(100,(n<=0?10:n===1?35:n===2?60:n===3?78:90)+Math.min(10,Math.max(0,t-1)*4));const state=n>=3?'strong_convergence':n>=1?'multi_source':'single_source';
      const latest=valid.length?new Date(Math.max(...valid.map(x=>new Date(x.published_at||x.observed_at||x.created_at).getTime()))).toISOString():null;
      const sources=[...new Set(valid.map(x=>x.source_name).filter(Boolean))],signalCount=new Set(valid.map(x=>x.intel_id)).size;
      await rest('market_intel_synergy_convergence_cache',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:{user_id:r.user_id,relationship_id:r.relationship_id,source_intel_id:r.source_intel_id,oracle_id:oracleId,target_card_name:r.target_card_name,corroborating_signal_count:signalCount,independent_source_count:n,independent_source_type_count:t,independent_creator_count:creators.size,independent_nonvideo_source_count:nonvideo.size,corroborating_sources:sources,latest_corroboration_at:latest,convergence_score:score,convergence_state:state,refreshed_at:new Date().toISOString()}});
      refreshed++;totalSignals+=signalCount;if(state==='multi_source')multiSource++;if(state==='strong_convergence')strong++;details.push({card:r.target_card_name,state,score,independent_sources:n,signals:signalCount,sources});
    }
    return J({ok:true,relationships_considered:rels.length,relationships_refreshed:refreshed,no_oracle:noOracle,corroborating_signals:totalSignals,multi_source:multiSource,strong_convergence:strong,details});
  }catch(e){return J({error:(e as Error).message},502)}
});
