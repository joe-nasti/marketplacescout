const DISCORD_API='https://discord.com/api/v10';
const MAX_EMBED_DESCRIPTION=4096;
const MAX_EMBED_TOTAL=5900;
const DEEP_SCAN_PER_FINISH=80;
const base=env=>String(env.SUPABASE_URL||'').replace(/\/$/,'');
const web=env=>String(env.COLLECTISH_WEB_URL||'https://joe-nasti.github.io/marketplacescout/').replace(/\/$/,'/');

function isNamedInterestQuery(question){return /\bmtg\s*stocks?\b|\bmtgstocks\b/i.test(String(question||''))&&/\binterests?\b/i.test(String(question||''))}
function sourcePrefs(question){
  const s=String(question||'').toLowerCase();
  const asksNonfoil=/\bnon[- ]?foil\b|\bregular\b/.test(s);
  const asksFoil=/\bfoil\b/.test(s)&&!asksNonfoil;
  return{finish:asksFoil?'foil':asksNonfoil?'regular':'all',price_type:/\bmarket\b/.test(s)?'market':'average',window:/\b(?:7d|week|weekly)\b/.test(s)?'7d':'24h'};
}
function requestedCount(question){const m=String(question||'').match(/\b(?:top|show|list)\s+(\d{1,2})\b/i);return Math.max(1,Math.min(20,Number(m?.[1]||10)))}
function finishLabel(v){const s=String(v||'').toLowerCase();return s==='foil'?'Foil':s==='all'?'Nonfoil + Foil':'Nonfoil'}
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
function reason(x){
  const r=Array.isArray(x?.reasons)?x.reasons.filter(Boolean):[];
  if(!r.length)return 'worth checking against liquidity and other markets';
  return short(r.slice(0,2).join('; '),118);
}
function familyKey(x){
  const stable=String(x?.oracle_id||x?.oracle_card_id||x?.card_family_id||'').trim().toLowerCase();
  if(stable)return stable;
  return String(x?.card_name||'')
    .toLowerCase()
    .replace(/\s*\/\/\s*.*/,'')
    .replace(/\s*\([^)]*\)\s*$/,'')
    .replace(/[^a-z0-9]+/g,' ')
    .trim();
}
function independentTreatmentEvidence(x){
  if(x?.independent_treatment_evidence===true||x?.treatment_independent===true)return true;
  const reasons=Array.isArray(x?.reasons)?x.reasons.join(' ').toLowerCase():'';
  return /independent (?:treatment|printing) evidence|treatment-specific corroboration/.test(reasons);
}
function dedupeMoverFamilies(rows){
  const seen=new Set(),out=[];
  for(const row of rows){
    const key=familyKey(row);
    if(!key||!seen.has(key)||independentTreatmentEvidence(row)){
      out.push(row);
      if(key)seen.add(key);
    }
  }
  return out;
}
async function serviceRpc(env,name,body){
  if(!env.SUPABASE_SERVICE_ROLE_KEY)return null;
  const r=await fetch(`${base(env)}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok)throw new Error(`${name} HTTP ${r.status}: ${(await r.text()).slice(0,140)}`);
  return r.json();
}
async function interestsSnapshot(env,p){
  if(p.finish==='all'){
    return serviceRpc(env,'ask_mtgstocks_interests_vetted_all_v1',{p_source_date:null,p_price_type:p.price_type,p_window:p.window,p_scan_per_finish:DEEP_SCAN_PER_FINISH});
  }
  return serviceRpc(env,'ask_mtgstocks_interests_vetted_v1',{p_source_date:null,p_finish:p.finish,p_price_type:p.price_type,p_window:p.window,p_limit:DEEP_SCAN_PER_FINISH});
}
function fitDescription(lines,max=MAX_EMBED_DESCRIPTION){
  const out=[];
  for(const line of lines){
    const next=[...out,line].join('\n');
    if(next.length>max)break;
    out.push(line);
  }
  return out.join('\n');
}
function embedsForSnapshot(env,d,count){
  const raw=Array.isArray(d?.raw)?d.raw.slice(0,count):[];
  const movers=dedupeMoverFamilies(Array.isArray(d?.early_movers)?d.early_movers:[]);
  const noise=Array.isArray(d?.noise)?d.noise:[];
  const combined=String(d?.finish||'').toLowerCase()==='all';
  const header=`${d?.observed_date||'latest'} · ${metricLabel(d?.price_type)} · ${finishLabel(d?.finish)} · ${d?.window||'24h'}`;
  const rawLines=raw.map((x,i)=>`${i+1}. ${cardText(env,x)} · ${setLabel(x)} · ${finishLabel(x?.finish)} · ${pct(x?.pct_change)}`);
  const moverLines=movers.slice(0,5).map((x,i)=>`${i+1}. ${cardText(env,x)} · ${setLabel(x)} · ${finishLabel(x?.finish)} · ${pct(x?.pct_change)} — ${reason(x)}`);
  const noiseLines=noise.slice(0,6).map(x=>`• ${cardText(env,x,46)} · ${setLabel(x)} · ${finishLabel(x?.finish)} · ${pct(x?.pct_change)} — ${reason(x)}`);
  const embeds=[];
  const rawDescription=fitDescription(rawLines);
  if(rawDescription)embeds.push({title:combined?'MTGStocks Interests · Nonfoil + Foil':'MTGStocks Interests',description:rawDescription,footer:{text:header}});
  const moverDescription=fitDescription(moverLines);
  if(moverDescription){
    embeds.push({title:'Collectish early movers',description:moverDescription,footer:combined?{text:`Vetted across up to ${d?.scan_per_finish||DEEP_SCAN_PER_FINISH} Nonfoil + ${d?.scan_per_finish||DEEP_SCAN_PER_FINISH} Foil Interests`}:undefined});
  }else{
    const scanned=combined?`up to ${d?.scan_per_finish||DEEP_SCAN_PER_FINISH} Nonfoil + ${d?.scan_per_finish||DEEP_SCAN_PER_FINISH} Foil Interests`:`up to ${DEEP_SCAN_PER_FINISH} ${finishLabel(d?.finish)} Interests`;
    embeds.push({title:'Collectish early movers',description:`No cards cleared the current liquidity/corroboration vetting after scanning ${scanned}.`});
  }
  const noiseDescription=fitDescription(noiseLines);
  if(noiseDescription)embeds.push({title:'Noise / thin-market flags',description:noiseDescription});
  let used=0;
  return embeds.filter(e=>{
    const size=String(e.title||'').length+String(e.description||'').length+String(e.footer?.text||'').length;
    if(used+size>MAX_EMBED_TOTAL)return false;
    used+=size;return true;
  });
}
async function editOriginal(job,embeds){
  const r=await fetch(`${DISCORD_API}/webhooks/${job.application_id}/${job.interaction_token}/messages/@original`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'',embeds,components:[],allowed_mentions:{parse:[]}})});
  if(!r.ok)throw new Error(`Discord original edit HTTP ${r.status}: ${(await r.text()).slice(0,180)}`);
}

export async function rewriteStructuredDiscordOutput(env,job){
  if(!isNamedInterestQuery(job?.question)||!job?.application_id||!job?.interaction_token)return;
  try{
    const p=sourcePrefs(job.question),count=requestedCount(job.question);
    const d=await interestsSnapshot(env,p);
    const embeds=embedsForSnapshot(env,d,count);if(!embeds.length)return;
    await editOriginal(job,embeds);
  }catch(error){console.warn('structured discord embed rewrite skipped',String(error?.message||error).slice(0,180))}
}
