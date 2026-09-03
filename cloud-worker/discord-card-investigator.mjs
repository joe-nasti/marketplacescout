const DISCORD_API='https://discord.com/api/v10';
const encoder=new TextEncoder();
const decoder=new TextDecoder();
const base=env=>String(env.SUPABASE_URL||'').replace(/\/$/,'');
const web=env=>String(env.COLLECTISH_WEB_URL||'https://joe-nasti.github.io/marketplacescout/').replace(/\/$/,'/');
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})}
function hexToBytes(v,n){const h=String(v||'').trim();if(!new RegExp(`^[0-9a-f]{${n*2}}$`,'i').test(h))return null;const out=new Uint8Array(n);for(let i=0;i<n;i++)out[i]=parseInt(h.slice(i*2,i*2+2),16);return out}
async function verify(request,raw,publicKeyHex){const sig=hexToBytes(request.headers.get('x-signature-ed25519'),64),ts=request.headers.get('x-signature-timestamp')||'',pk=hexToBytes(publicKeyHex,32);if(!sig||!ts||!pk)return false;const a=encoder.encode(ts),b=new Uint8Array(raw),m=new Uint8Array(a.length+b.length);m.set(a);m.set(b,a.length);const key=await crypto.subtle.importKey('raw',pk,{name:'Ed25519'},false,['verify']);return crypto.subtle.verify({name:'Ed25519'},key,sig,m)}
async function rpc(env,name,body){if(!env.SUPABASE_SERVICE_ROLE_KEY)return null;const r=await fetch(`${base(env)}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error(`${name} HTTP ${r.status}`);return r.json()}
function qFrom(x){const o=(Array.isArray(x?.data?.options)?x.data.options:[]).find(v=>String(v?.name||'').toLowerCase()==='question');return String(o?.value||'').trim()}
function short(v,n=70){const s=String(v||'').replace(/\s+/g,' ').trim();return s.length>n?`${s.slice(0,n-1)}…`:s}
function money(v){const n=Number(v);return Number.isFinite(n)?`$${n.toFixed(2)}`:'—'}
function num(v,d=1){const n=Number(v);return Number.isFinite(n)?n.toFixed(d):'—'}
function pct(v){const n=Number(v);return Number.isFinite(n)?`${n>=0?'+':''}${n.toFixed(1)}%`:'—'}
function skuUrl(env,x){return`${web(env)}?sku=${encodeURIComponent(String(x.sku_id||''))}`}
function extract(q){const s=String(q||'').trim();const patterns=[
  {intent:'why',re:/^why\s+is\s+(.+?)\s+(?:moving|going up|spiking|selling|hot)\??$/i},
  {intent:'real',re:/^is\s+(?:the\s+)?(.+?)\s+(?:move\s+)?(?:real|noise|legit|actually moving)\??$/i},
  {intent:'late',re:/^(?:am\s+i\s+late\s+(?:on|to)\s+|is\s+it\s+too\s+late\s+(?:for|on)\s+)(.+?)\??$/i},
  {intent:'printing',re:/^(?:which|what)\s+printing\s+(?:of\s+)?(.+?)\s+(?:should\s+i\s+buy|looks best|is best)\??$/i},
  {intent:'printing',re:/^(?:best|cheapest executable)\s+printing\s+(?:of\s+)?(.+?)\??$/i},
  {intent:'liquidity',re:/^(?:how\s+liquid\s+is|what(?:'s| is)\s+the\s+liquidity\s+(?:on|of))\s+(.+?)\??$/i},
  {intent:'liquidity',re:/^(?:can\s+i\s+buy|can\s+i\s+move)\s+(\d+)\s+copies\s+of\s+(.+?)\??$/i},
  {intent:'direct',re:/^is\s+(?:the\s+)?direct\s+premium\s+(?:on|for)\s+(.+?)\s+sustainable\??$/i},
  {intent:'analyze',re:/^(?:analyze|investigate|check)\s+(.+?)\??$/i}
];
  for(const p of patterns){const m=s.match(p.re);if(!m)continue;if(p.intent==='liquidity'&&m.length===3)return{intent:p.intent,card:m[2].trim(),quantity:Number(m[1])};return{intent:p.intent,card:m[1].trim(),quantity:null}}
  return null
}
function choose(rows){return [...rows].sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0)||(Number(b.avg_daily_qty_sold)||0)-(Number(a.avg_daily_qty_sold)||0))[0]||null}
function directPremium(x){const m=Number(x?.market),d=Number(x?.direct_low);return m>0&&Number.isFinite(d)?((d-m)/m)*100:null}
function daysCover(x){const a=Number(x?.direct_available),s=Number(x?.avg_daily_qty_sold);return s>0&&Number.isFinite(a)?a/s:null}
function thesis(intent,d,rows,qty){const signal=d.latest_radar_signal||null;const best=choose(rows),fastest=[...rows].sort((a,b)=>(Number(b.avg_daily_qty_sold)||0)-(Number(a.avg_daily_qty_sold)||0))[0]||best;const pieces=[];if(intent==='why'||intent==='real'||intent==='analyze'){
  if(signal)pieces.push(`Latest radar: **${signal.evidence_tier||'signal'}** from ${signal.source_count||1} source${Number(signal.source_count||1)===1?'':'s'} (${Array.isArray(signal.sources)?signal.sources.join(' + '):'market evidence'}).`);else pieces.push('No current Delvin radar observation is attached to this card, so treat the move as less corroborated.');
  if(fastest?.avg_daily_qty_sold!=null)pieces.push(`Fastest tracked printing is ${fastest.set_code} at **${num(fastest.avg_daily_qty_sold,1)}/day** with Direct ${fastest.direct_available??'—'}.`);
  if(intent==='real')pieces.push(signal&&Number(signal.source_count)>=2?'**Read:** corroborated enough to investigate as a real move.':'**Read:** still single-source / insufficiently corroborated; investigate, don’t chase.');
}
if(intent==='late'){
  const move=Math.max(...rows.map(x=>Number(x.market_change_24h_pct)).filter(Number.isFinite),-999);const seven=Math.max(...rows.map(x=>Number(x.market_change_7d_pct)).filter(Number.isFinite),-999);
  if(move>=15||seven>=30)pieces.push(`**Read:** at least one printing has already repriced materially (${move>-999?`${pct(move)} 24h`:''}${seven>-999?` ${pct(seven)} 7d`:''}). Entry risk is elevated.`);else if(signal&&fastest&&Number(fastest.avg_daily_qty_sold)>=2)pieces.push('**Read:** demand/supply evidence is active without a large measured Market repricing yet. This looks earlier rather than fully chased.');else pieces.push('**Read:** not enough price/demand evidence to call this early or late confidently.');
}
if(intent==='printing'){
  if(best)pieces.push(`**Best current Scout execution:** ${best.set_code} ${best.printing} · grade ${best.grade||'—'} / ${best.score??'—'} · buy ${money(best.cheapest_buy)} via ${best.cheapest_source||'—'} · Market ${money(best.market)} · Direct ${money(best.direct_low)}.`);
  const liquid=[...rows].sort((a,b)=>(Number(b.avg_daily_qty_sold)||0)-(Number(a.avg_daily_qty_sold)||0))[0];if(liquid&&liquid.sku_id!==best?.sku_id)pieces.push(`Most liquid tracked printing: ${liquid.set_code} ${liquid.printing} at ${num(liquid.avg_daily_qty_sold,1)}/day.`)
}
if(intent==='liquidity'){
  const q=Number(qty)||10;if(fastest){const daily=Number(fastest.avg_daily_qty_sold)||0;const days=daily>0?q/daily:null;pieces.push(`${fastest.set_code} ${fastest.printing} is the fastest tracked printing at **${num(daily,1)}/day**.${days?` ${q} copies equals roughly **${num(days,1)} days** of current observed unit velocity.`:''}`);pieces.push(days!=null&&days<=2?'**Read:** that size is relatively small versus current velocity.':days!=null&&days<=7?'**Read:** executable, but large enough to care about entry/exit slippage.':'**Read:** that position is large versus observed velocity; treat exit liquidity as a real risk.');}
}
if(intent==='direct'){
  if(best){const prem=directPremium(best),cover=daysCover(best);pieces.push(`${best.set_code} ${best.printing}: Direct ${money(best.direct_low)} vs Market ${money(best.market)} (${pct(prem)} premium), Direct available ${best.direct_available??'—'}${cover!=null?`, ~${num(cover,1)}d cover`:''}.`);pieces.push(prem!=null&&prem>25&&cover!=null&&cover<2?'**Read:** premium has real scarcity support right now, but it is vulnerable to Direct restock.':prem!=null&&prem>25?'**Read:** premium is large but current Direct depth does not make it obviously durable.':'**Read:** the Direct premium is not unusually stretched on the best-ranked printing.');}
}
return pieces.join('\n')}
function printingLines(env,rows){return rows.slice(0,5).map((x,i)=>{const prem=directPremium(x),cover=daysCover(x);return`${i+1}. [${x.set_code} ${x.printing}](${skuUrl(env,x)}) · grade **${x.grade||'—'}**/${x.score??'—'} · Market ${money(x.market)} · Low ${money(x.tcg_low)} · Direct ${money(x.direct_low)}${prem!=null?` (${pct(prem)})`:''} · ${num(x.avg_daily_qty_sold,1)}/day · Direct ${x.direct_available??'—'}${cover!=null?` / ${num(cover,1)}d`:''}${x.market_change_24h_pct!=null?` · 24h ${pct(x.market_change_24h_pct)}`:''}`}).join('\n')}
async function edit(x,env,embed){const r=await fetch(`${DISCORD_API}/webhooks/${x.application_id||env.DISCORD_APPLICATION_ID}/${x.token}/messages/@original`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'',embeds:[embed],allowed_mentions:{parse:[]}})});if(!r.ok)throw new Error(`Discord edit HTTP ${r.status}`)}
export async function maybeHandleCardInvestigator(request,env,ctx){if(request.method!=='POST')return null;let parsed,raw;try{raw=await request.clone().arrayBuffer();parsed=JSON.parse(decoder.decode(raw))}catch{return null}if(parsed?.type!==2||String(parsed?.data?.name||'').toLowerCase()!=='ask')return null;const q=qFrom(parsed),intent=extract(q);if(!intent)return null;if(!await verify(request,raw,env.DISCORD_PUBLIC_KEY))return new Response('invalid request signature',{status:401});ctx?.waitUntil?.((async()=>{try{const d=await rpc(env,'ask_delvin_card_investigation_v1',{p_card_name:intent.card});if(!d?.ok){await edit(parsed,env,{title:'Delvin card investigator',description:d?.error||'Card not found.'});return}const rows=Array.isArray(d.printings)?d.printings:[];const embed={title:`${d.card_name} · investigation`,description:thesis(intent.intent,d,rows,intent.quantity)||'No actionable interpretation available yet.',fields:rows.length?[{name:'Tracked printings',value:printingLines(env,rows)}]:[],footer:{text:'Deterministic Scout + price-history + Delvin radar evidence · exact printing economics can differ'}};await edit(parsed,env,embed)}catch(e){console.warn('card investigator failed',String(e?.message||e))}})());return json({type:5,data:{}})}
