const DISCORD_API='https://discord.com/api/v10';
const EPHEMERAL=1<<6;
const MAX_CONTENT=1900;
const base=env=>String(env.SUPABASE_URL||'').replace(/\/$/,'');
const web=env=>String(env.COLLECTISH_WEB_URL||'https://joe-nasti.github.io/marketplacescout/').replace(/\/$/,'/');

function isNamedInterestQuery(question){return /\bmtg\s*stocks?\b|\bmtgstocks\b/i.test(String(question||''))&&/\binterests?\b/i.test(String(question||''))}
function sourcePrefs(question){const s=String(question||'').toLowerCase();return{finish:/\bfoil\b/.test(s)&&!/non[- ]?foil/.test(s)?'foil':'regular',price_type:/\bmarket\b/.test(s)?'market':'average',window:/\b(?:7d|week|weekly)\b/.test(s)?'7d':'24h'}}
function requestedCount(question){const m=String(question||'').match(/\b(?:top|show|list)\s+(\d{1,2})\b/i);return Math.max(1,Math.min(20,Number(m?.[1]||10)))}
function finishLabel(v){return String(v||'').toLowerCase()==='foil'?'Foil':'Nonfoil'}
function metricLabel(v){return String(v||'').toLowerCase()==='market'?'Market':'Average'}
function pct(v){const n=Number(v);return Number.isFinite(n)?`${n>=0?'+':''}${Math.abs(n)>=1000?n.toFixed(0):n.toFixed(1)}%`:'—'}
function short(v,n=58){const s=String(v||'').trim();return s.length>n?`${s.slice(0,n-1)}…`:s}
function setLabel(x){return x?.set_code||short(x?.set_name,22)||'SET?'}
function cardUrl(env,x){
  const sku=String(x?.sku_id||'');
  if(/^\d+$/.test(sku))return `${web(env)}?sku=${encodeURIComponent(sku)}`;
  const p=new URLSearchParams();
  if(x?.product_id)p.set('product',String(x.product_id));
  if(x?.card_name)p.set('card',String(x.card_name));
  if(x?.set_code||x?.set_name)p.set('set',String(x.set_code||x.set_name));
  p.set('finish',String(x?.finish||'regular'));
  return `${web(env)}?${p.toString()}`;
}
function cardText(env,x,n=58){return `[${short(x?.card_name,n)}](${cardUrl(env,x)})`}
function reason(x){const r=Array.isArray(x?.reasons)?x.reasons:[];return short(r[0]||'worth checking against liquidity and other markets',84)}
async function serviceRpc(env,name,body){
  if(!env.SUPABASE_SERVICE_ROLE_KEY)return null;
  const r=await fetch(`${base(env)}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok)throw new Error(`${name} HTTP ${r.status}: ${(await r.text()).slice(0,140)}`);
  return r.json();
}
function splitSection(title,lines){
  if(!lines.length)return[];
  const out=[];let current=title;
  for(const line of lines){
    if(`${current}\n${line}`.length<=MAX_CONTENT){current+=`\n${line}`;continue}
    if(current!==title)out.push(current);
    current=`${title} (continued)\n${line}`;
    if(current.length>MAX_CONTENT){out.push(current.slice(0,MAX_CONTENT));current=''}
  }
  if(current&&current!==title)out.push(current);
  return out;
}
function messagesForSnapshot(env,d,count){
  const raw=Array.isArray(d?.raw)?d.raw.slice(0,count):[];
  const movers=Array.isArray(d?.early_movers)?d.early_movers:[];
  const noise=Array.isArray(d?.noise)?d.noise:[];
  const title=`MTGStocks Interests — ${d?.observed_date||'latest'} · ${metricLabel(d?.price_type)} · ${finishLabel(d?.finish)} · ${d?.window||'24h'}`;
  const rawLines=raw.map((x,i)=>`${i+1}. ${cardText(env,x)} · ${setLabel(x)} · ${finishLabel(x?.finish)} · ${pct(x?.pct_change)}`);
  const moverLines=movers.slice(0,5).map((x,i)=>`${i+1}. ${cardText(env,x)} · ${setLabel(x)} · ${finishLabel(x?.finish)} · ${pct(x?.pct_change)} — ${reason(x)}`);
  const noiseLines=noise.slice(0,6).map(x=>`• ${cardText(env,x,46)} · ${setLabel(x)} · ${pct(x?.pct_change)} — ${reason(x)}`);
  return[
    ...splitSection(title,rawLines),
    ...splitSection('Collectish early movers',moverLines),
    ...splitSection('Noise / thin-market flags',noiseLines),
  ];
}
async function editOriginal(job,content){
  const r=await fetch(`${DISCORD_API}/webhooks/${job.application_id}/${job.interaction_token}/messages/@original`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({content,components:[],allowed_mentions:{parse:[]}})});
  if(!r.ok)throw new Error(`Discord original edit HTTP ${r.status}`);
}
async function followup(job,content){
  const r=await fetch(`${DISCORD_API}/webhooks/${job.application_id}/${job.interaction_token}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content,flags:EPHEMERAL,allowed_mentions:{parse:[]}})});
  if(!r.ok)throw new Error(`Discord followup HTTP ${r.status}`);
}

export async function rewriteStructuredDiscordOutput(env,job){
  if(!isNamedInterestQuery(job?.question)||!job?.application_id||!job?.interaction_token)return;
  try{
    const p=sourcePrefs(job.question),count=requestedCount(job.question);
    const d=await serviceRpc(env,'ask_mtgstocks_interests_vetted_v1',{p_source_date:null,p_finish:p.finish,p_price_type:p.price_type,p_window:p.window,p_limit:Math.max(40,count)});
    const messages=messagesForSnapshot(env,d,count);if(!messages.length)return;
    await editOriginal(job,messages[0]);
    for(const content of messages.slice(1))await followup(job,content);
  }catch(error){console.warn('structured discord multi-message rewrite skipped',String(error?.message||error).slice(0,180))}
}
