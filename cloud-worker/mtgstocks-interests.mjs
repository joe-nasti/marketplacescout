const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const INTERESTS_URL='https://www.mtgstocks.com/interests';
const API_ROOT='https://api.mtgstocks.com/interests';
const MAX_PER_STREAM=Number(process.env.MTGSTOCKS_INTERESTS_MAX_PER_WINDOW||40);
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(d?.message||`Supabase ${r.status}: ${String(t).slice(0,300)}`);return d}
async function getJson(url){const r=await fetch(url,{headers:{'User-Agent':'Collectish market intelligence/1.0 (+https://github.com/joe-nasti/marketplacescout)','Accept':'application/json','Referer':'https://www.mtgstocks.com/'}});const t=await r.text();if(!r.ok)throw new Error(`MTGStocks API ${r.status}: ${t.slice(0,220)}`);try{return JSON.parse(t)}catch{throw new Error(`MTGStocks API returned non-JSON: ${t.slice(0,220)}`)}}
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const cleanName=s=>String(s||'').trim();
const canonicalName=s=>cleanName(s).replace(/\s*\((?:extended art|borderless|showcase[^)]*|retro frame|galaxy foil|surge foil|rainbow foil|etched|foil etched|serialized[^)]*)\)\s*$/i,'').trim();
const windowFor=s=>/week/i.test(String(s||''))?'7d':'24h';
const streams=[
  {priceType:'market',finish:'regular',url:`${API_ROOT}/market/regular`},
  {priceType:'market',finish:'foil',url:`${API_ROOT}/market/foil`},
  {priceType:'average',finish:'regular',url:`${API_ROOT}/average/regular`},
  {priceType:'average',finish:'foil',url:`${API_ROOT}/average/foil`}
];
const fetched=[];
for(const stream of streams){const payload=await getJson(stream.url);const interests=Array.isArray(payload?.interests)?payload.interests:[];fetched.push({...stream,date:payload?.date||null,interests});}
if(!fetched.some(x=>x.interests.length))throw new Error('MTGStocks Interests API returned zero rows across all streams');
const users=await sb('market_intel_items?select=user_id&order=created_at.asc&limit=1');const userId=users?.[0]?.user_id;if(!userId)throw new Error('No market_intel user available');
const sourceDates=fetched.map(x=>x.date).filter(Boolean).sort();const sourceDate=sourceDates.at(-1)||new Date().toISOString().slice(0,10);
const existing=await sb(`market_intel_items?select=title&source_name=eq.MTGStocks&source_subtype=eq.interests&metadata_json->>source_date=eq.${encodeURIComponent(sourceDate)}&limit=1000`);const seen=new Set((existing||[]).map(x=>x.title));
let inserted=0,skipped=0;
for(const stream of fetched){
  for(const raw of stream.interests.slice(0,MAX_PER_STREAM)){
    const print=raw?.print||{};const originalName=cleanName(print.name||raw.name);if(!originalName){skipped++;continue}
    const entityName=canonicalName(originalName)||originalName;
    const newPrice=finite(raw.present_price),oldPrice=finite(raw.past_price),pct=finite(raw.percentage);if(newPrice===null||oldPrice===null||pct===null){skipped++;continue}
    const window=windowFor(raw.interest_type);const title=`Interests · ${stream.priceType} · ${stream.finish} · ${window} · ${originalName}`;if(seen.has(title)){skipped++;continue}
    const direction=pct>0?'bullish':pct<0?'bearish':'neutral';const at=new Date().toISOString();
    const item=await sb('market_intel_items?select=intel_id',{method:'POST',prefer:'return=representation',body:{user_id:userId,source_type:'other',source_name:'MTGStocks',source_url:INTERESTS_URL,title,summary:`MTGStocks Interests ${stream.priceType} ${stream.finish} ${window}: ${originalName} moved from $${oldPrice.toFixed(2)} to $${newPrice.toFixed(2)} (${pct>=0?'+':''}${pct.toFixed(1)}%).`,claim_type:'price',direction,signal_stage:'confirming',confidence:0.95,published_at:at,observed_at:at,source_profile:'market_movement',source_subtype:'interests',metadata_json:{provider:'mtgstocks',lane:'interests',source_date:stream.date||sourceDate,window,interest_type:raw.interest_type||null,price_type:stream.priceType,finish:stream.finish,new_price:newPrice,old_price:oldPrice,change_pct:pct,mtgstocks_print_id:print.id||null,mtgstocks_set_id:print.set_id||null,mtgstocks_set_name:print.set_name||null,original_card_name:originalName}}});
    const intelId=item?.[0]?.intel_id;if(!intelId){skipped++;continue}
    await sb('market_intel_entities',{method:'POST',body:{intel_id:intelId,user_id:userId,entity_type:'card',entity_name:entityName,confidence:0.92}});
    inserted++;seen.add(title);
  }
}
let wake=null;if(inserted)wake=await sb('rpc/enqueue_signal_scout_wakes',{method:'POST',body:{p_hours:24}});
console.log(JSON.stringify({ok:true,source:INTERESTS_URL,sourceDate,streams:fetched.map(x=>({priceType:x.priceType,finish:x.finish,date:x.date,rows:x.interests.length})),inserted,skipped,wake},null,2));