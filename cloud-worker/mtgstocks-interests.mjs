const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const INTERESTS_URL='https://www.mtgstocks.com/interests';
const MAX_PER_WINDOW=Number(process.env.MTGSTOCKS_INTERESTS_MAX_PER_WINDOW||40);
if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const H={apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,'Content-Type':'application/json'};
async function sb(path,{method='GET',body,prefer}={}){const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method,headers:{...H,...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(d?.message||`Supabase ${r.status}: ${String(t).slice(0,300)}`);return d}
const decode=s=>String(s||'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
const num=s=>{const n=Number(String(s||'').replace(/[$,%+]/g,'').replace(/,/g,''));return Number.isFinite(n)?n:null};
function rowsFrom(section){const out=[];for(const m of section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){const cells=[...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(x=>decode(x[1]));if(cells.length<4)continue;const pct=num(cells.at(-1)),oldPrice=num(cells.at(-2)),newPrice=num(cells.at(-3));const name=cells[0];if(!name||pct===null||newPrice===null||oldPrice===null)continue;out.push({name,newPrice,oldPrice,pct});}return out}
function parse(html){const lower=html.toLowerCase();const y=lower.indexOf('since yesterday'),w=lower.indexOf('since last week');if(y<0)throw new Error('MTGStocks Interests markup missing Since yesterday');const day=rowsFrom(html.slice(y,w>y?w:undefined));const week=w>y?rowsFrom(html.slice(w)):[];return {day,week}}
const page=await fetch(INTERESTS_URL,{headers:{'User-Agent':'Collectish market intelligence/1.0 (+https://github.com/joe-nasti/marketplacescout)','Accept':'text/html'}});if(!page.ok)throw new Error(`MTGStocks Interests HTTP ${page.status}`);const html=await page.text();const parsed=parse(html);if(!parsed.day.length&&!parsed.week.length)throw new Error('MTGStocks Interests parsed zero rows');
const users=await sb('market_intel_items?select=user_id&order=created_at.asc&limit=1');const userId=users?.[0]?.user_id;if(!userId)throw new Error('No market_intel user available');
const start=new Date();start.setUTCHours(0,0,0,0);const existing=await sb(`market_intel_items?select=title&source_name=eq.MTGStocks&source_subtype=eq.interests&observed_at=gte.${encodeURIComponent(start.toISOString())}&limit=500`);const seen=new Set((existing||[]).map(x=>x.title));
let inserted=0;
for(const [window,rows] of [['24h',parsed.day],['7d',parsed.week]]){
  for(const r of rows.slice(0,MAX_PER_WINDOW)){
    const title=`Interests · ${window} · ${r.name}`;if(seen.has(title))continue;
    const direction=r.pct>0?'bullish':r.pct<0?'bearish':'neutral';
    const item=await sb('market_intel_items?select=intel_id',{method:'POST',prefer:'return=representation',body:{user_id:userId,source_type:'other',source_name:'MTGStocks',source_url:INTERESTS_URL,title,summary:`MTGStocks Interests ${window}: ${r.name} moved from $${r.oldPrice.toFixed(2)} to $${r.newPrice.toFixed(2)} (${r.pct>=0?'+':''}${r.pct.toFixed(1)}%).`,claim_type:'price',direction,signal_stage:'confirming',confidence:0.95,published_at:new Date().toISOString(),observed_at:new Date().toISOString(),source_profile:'market_movement',source_subtype:'interests',metadata_json:{provider:'mtgstocks',lane:'interests',window,new_price:r.newPrice,old_price:r.oldPrice,change_pct:r.pct}}});
    const intelId=item?.[0]?.intel_id;if(!intelId)continue;
    await sb('market_intel_entities',{method:'POST',body:{intel_id:intelId,user_id:userId,entity_type:'card',entity_name:r.name,confidence:0.92}});
    inserted++;seen.add(title);
  }
}
let wake=null;if(inserted){wake=await sb('rpc/enqueue_signal_scout_wakes',{method:'POST',body:{p_hours:24}})}
console.log(JSON.stringify({ok:true,source:INTERESTS_URL,parsed:{day:parsed.day.length,week:parsed.week.length},inserted,wake},null,2));