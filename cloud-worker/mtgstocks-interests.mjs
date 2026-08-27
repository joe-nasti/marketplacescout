import { execFileSync } from 'node:child_process';

const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const INTERESTS_URL='https://www.mtgstocks.com/interests';
const API_ROOT='https://api.mtgstocks.com/interests';
const MAX_PER_STREAM=Number(process.env.MTGSTOCKS_INTERESTS_MAX_PER_WINDOW||40);
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(d?.message||`Supabase ${r.status}: ${String(t).slice(0,300)}`);return d}
const htmlDecode=s=>String(s||'').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
function jsonViaChrome(url){const bins=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean);let last='';for(const bin of bins){try{const dom=execFileSync(bin,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--dump-dom',url],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});const pre=dom.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)?.[1];const text=htmlDecode(pre||dom.replace(/<[^>]+>/g,''));return JSON.parse(text.trim())}catch(e){last=String(e?.stderr||e?.message||e).slice(0,240)}}throw new Error(`Chrome fallback failed: ${last}`)}
async function getJson(url){const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36','Accept':'application/json,text/plain,*/*','Referer':'https://www.mtgstocks.com/','Origin':'https://www.mtgstocks.com'}});const t=await r.text();if(r.ok){try{return JSON.parse(t)}catch{}}if(r.status===403||!r.ok)return jsonViaChrome(url);throw new Error(`MTGStocks API ${r.status}: ${t.slice(0,220)}`)}
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
let inserted=0,skipped=0;const insertedIds=[];
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
    inserted++;insertedIds.push(intelId);seen.add(title);
  }
}
let resolution=null,wake=null;
if(insertedIds.length){
  resolution=await sb('rpc/resolve_mtgstocks_interest_links',{method:'POST',body:{p_intel_ids:insertedIds}});
  wake=await sb('rpc/enqueue_market_intel_scout_wakes',{method:'POST',body:{p_intel_ids:insertedIds}});
}
console.log(JSON.stringify({ok:true,source:INTERESTS_URL,sourceDate,streams:fetched.map(x=>({priceType:x.priceType,finish:x.finish,date:x.date,rows:x.interests.length})),inserted,skipped,resolution,wake},null,2));