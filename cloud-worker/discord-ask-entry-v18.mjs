import entry from './discord-ask-entry-v17.mjs';

const DISCORD_API = 'https://discord.com/api/v10';
const CATALYST_COLOR = 0x9b59b6;
const MARKET_COLOR = 0x2ecc71;
const TIMELINE_COLOR = 0x3498db;
const PRINTING_COLOR = 0xf1c40f;
const RISK_COLOR = 0xe67e22;

function supabaseBase(env) { return String(env.SUPABASE_URL || '').replace(/\/$/, ''); }
function serviceHeaders(env) { return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }; }
async function serviceRest(env, path, init = {}) {
  const response = await fetch(`${supabaseBase(env)}/rest/v1/${path}`, {
    method: init.method || 'GET', headers: { ...serviceHeaders(env), ...(init.prefer ? { Prefer: init.prefer } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const raw = await response.text(); let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) throw new Error(data?.message || `Supabase REST ${response.status}`);
  return data;
}
async function editOriginalDiscord(job, payload) {
  const response = await fetch(`${DISCORD_API}/webhooks/${job.application_id}/${job.interaction_token}/messages/@original`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }),
  });
  if (!response.ok) throw new Error(`Discord webhook edit HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`);
}
async function claimDelivery(env, job) {
  const rows = await serviceRest(env, 'rpc/claim_discord_ask_delivery', { method: 'POST', body: { p_interaction_id: job.interaction_id, p_discord_user_id: job.discord_user_id } });
  return Array.isArray(rows) ? rows[0] : rows;
}
async function updateDelivery(env, interactionId, patch) {
  return serviceRest(env, `discord_ask_deliveries?interaction_id=eq.${encodeURIComponent(interactionId)}`, { method: 'PATCH', body: { ...patch, updated_at: new Date().toISOString() } });
}

function moveAlias(question) {
  const q = String(question || '').trim();
  const patterns = [
    /^why\s+(?:did|has)\s+(.+?)\s+(?:spike|spiked|move|moved|jump|jumped|rise|rose|rally|rallied)\??$/i,
    /^why\s+is\s+(.+?)\s+(?:spiking|moving|rising|jumping|up)\??$/i,
    /^what\s+(?:drove|is\s+driving|was\s+driving)\s+(.+?)(?:'s)?(?:\s+(?:spike|move|price|rise))?\??$/i,
    /^what\s+happened\s+to\s+(.+?)\??$/i,
  ];
  for (const p of patterns) { const m = q.match(p); if (m?.[1]) return m[1].trim().replace(/[?.!,]+$/g, ''); }
  return null;
}
async function lookupFamily(env, alias) {
  return serviceRest(env, 'rpc/ask_collectish_public_card_lookup_v1', { method: 'POST', body: { p_query: alias, p_limit: 30 } });
}
async function recentSignals(env, alias) {
  const cutoff = new Date(Date.now() - 21 * 86400000).toISOString();
  const term = encodeURIComponent(`*${alias}*`);
  return serviceRest(env, `market_intel_items?observed_at=gte.${encodeURIComponent(cutoff)}&or=(title.ilike.${term},summary.ilike.${term})&select=intel_id,source_name,source_url,title,summary,published_at,observed_at&order=observed_at.desc&limit=24`).catch(() => []);
}
async function currentPrices(env, rows) {
  const skus = [...new Set((rows || []).map(r => String(r.sku_id || '')).filter(Boolean))];
  if (!skus.length) return [];
  return serviceRest(env, `tcgplayer_official_sku_price_current?sku_id=in.(${skus.join(',')})&select=sku_id,product_id,market_price,low_price,lowest_listing_price,direct_low_price,observed_at`).catch(() => []);
}
async function salesBuckets(env, rows) {
  const skus = [...new Set((rows || []).map(r => String(r.sku_id || '')).filter(Boolean))];
  if (!skus.length) return [];
  const since = new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10);
  return serviceRest(env, `marketplace_sku_sales_buckets?sku_id=in.(${skus.join(',')})&bucket_start_date=gte.${since}&select=sku_id,product_id,bucket_start_date,market_price,low_sale_price,high_sale_price,quantity_sold,transaction_count&order=bucket_start_date.asc`).catch(() => []);
}
async function familyResearch(env, job, alias, rows, prices, signals) {
  const products = [...new Set((rows || []).map(r => `${r.card_name} [${r.set_code} #${r.collector_number || '?'} ${r.printing || ''}]`))];
  const response = await fetch(`${supabaseBase(env)}/functions/v1/ask-collectish-family-research`, {
    method: 'POST', headers: serviceHeaders(env), body: JSON.stringify({
      discord_user_id: String(job.discord_user_id || ''),
      question: `Why did ${alias} Magic: The Gathering cards spike? Identify the strongest common catalyst and compare its timing with the observed card-family market move. Research the family as a whole.`,
      card: { name: alias, product_name: alias, family_alias: alias, family_products: products },
      internal_evidence: { family_alias: alias, resolved_printings: rows, current_tcgplayer_prices: prices, recent_collectish_signals: signals },
    }),
  });
  const raw = await response.text(); let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }
  if (!response.ok) throw new Error(data?.error || `Family research ${response.status}`);
  return data;
}

function money(v) { const n = Number(v); return Number.isFinite(n) ? `$${n.toFixed(2)}` : '—'; }
function pct(v) { const n = Number(v); return Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(1)}%` : '—'; }
function day(v) { const s = String(v || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || '—'; return new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); }
function clip(v, max = 1000) { const s = String(v || '').trim(); return s.length <= max ? s : `${s.slice(0, max - 1)}…`; }
function cleanMarkdown(s) { return String(s || '').replace(/^#{1,6}\s+/gm, '').replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1').trim(); }
function confidenceBadge(v) { const s = String(v || 'unknown').toLowerCase(); return s === 'high' ? '🟢 HIGH' : s === 'medium' ? '🟡 MEDIUM' : s === 'low' ? '🔴 LOW' : '⚪ UNKNOWN'; }
function timingBadge(v) { const s = String(v || 'unknown').toLowerCase(); return s === 'strong' ? '🟢 STRONG' : s === 'moderate' ? '🟡 MODERATE' : s === 'weak' ? '🔴 WEAK' : '⚪ UNKNOWN'; }
function parseMove(signal) {
  const text = `${signal?.title || ''} ${signal?.summary || ''}`;
  const m = text.match(/\b(average|market)\b.*?\b(foil|regular|nonfoil|non-foil)?\b.*?from \$([\d.]+) to \$([\d.]+) \(([+-]?[\d.]+)%\)/i);
  if (!m) return null;
  return { metric: m[1].toLowerCase(), finish: (m[2] || '').toLowerCase(), from: Number(m[3]), to: Number(m[4]), change: Number(m[5]), title: signal.title, url: signal.source_url, observed_at: signal.observed_at };
}
function signalSummary(signals) {
  const moves = (signals || []).map(parseMove).filter(Boolean);
  const market = moves.filter(m => m.metric === 'market').sort((a,b) => Math.abs(b.change)-Math.abs(a.change));
  const average = moves.filter(m => m.metric === 'average').sort((a,b) => Math.abs(b.change)-Math.abs(a.change));
  return { moves, market, average };
}
function earliestSignalDate(signals) {
  const times = (signals || []).map(s => Date.parse(s.observed_at || s.published_at || '')).filter(Number.isFinite);
  return times.length ? new Date(Math.min(...times)).toISOString().slice(0,10) : null;
}
function salesAroundEvent(buckets, eventDate) {
  if (!eventDate) return null;
  const e = Date.parse(`${eventDate}T00:00:00Z`); if (!Number.isFinite(e)) return null;
  let preQty=0, preTx=0, postQty=0, postTx=0, preBuckets=0, postBuckets=0;
  for (const b of buckets || []) {
    const t=Date.parse(`${String(b.bucket_start_date).slice(0,10)}T00:00:00Z`); if(!Number.isFinite(t)) continue;
    const delta=(t-e)/86400000;
    if(delta>=-9 && delta<0){preQty+=Number(b.quantity_sold||0);preTx+=Number(b.transaction_count||0);preBuckets++;}
    if(delta>=0 && delta<=9){postQty+=Number(b.quantity_sold||0);postTx+=Number(b.transaction_count||0);postBuckets++;}
  }
  if(!preBuckets&&!postBuckets) return null;
  const preDaily=preBuckets?preQty/(preBuckets*3):null, postDaily=postBuckets?postQty/(postBuckets*3):null;
  const lift=preDaily>0&&postDaily!=null?((postDaily-preDaily)/preDaily)*100:null;
  return {preQty,preTx,postQty,postTx,preBuckets,postBuckets,preDaily,postDaily,lift};
}
function variantFromSignal(s) {
  const title=String(s?.title||''); const pieces=title.split('·').map(x=>x.trim()).filter(Boolean); return pieces.at(-1)||null;
}
function affectedPrintings(rows, signals, prices) {
  const pmap=new Map((prices||[]).map(p=>[String(p.sku_id),p])); const out=[]; const seen=new Set();
  for(const r of rows||[]){const key=`${r.product_id}|${r.sku_id}|${r.printing}`;if(seen.has(key))continue;seen.add(key);const p=pmap.get(String(r.sku_id));out.push({name:r.card_name,set:r.set_code,cn:r.collector_number,printing:r.printing,sku:r.sku_id,market:p?.market_price,low:p?.lowest_listing_price??p?.low_price,resolved:true});}
  const resolvedNames=out.map(x=>x.name.toLowerCase());
  for(const s of signals||[]){const v=variantFromSignal(s);if(!v)continue;if(resolvedNames.some(n=>n.includes(v.toLowerCase())||v.toLowerCase().includes(n.split(' // ')[0])))continue;if(out.some(x=>x.name.toLowerCase()===v.toLowerCase()))continue;out.push({name:v,set:null,cn:null,printing:'signal-only variant',sku:null,market:null,low:null,resolved:false});}
  return out.slice(0,8);
}
function marketRead(summary, sales) {
  const maxMarket=Math.max(0,...summary.market.map(m=>m.change)); const maxAvg=Math.max(0,...summary.average.map(m=>m.change));
  if(maxMarket>=75 || maxAvg>=150){
    if(sales?.lift!=null && sales.lift>40) return {label:'WATCH · CHASE RISK',detail:'Price and buyer activity both accelerated. The catalyst is real, but the move is already extended; chasing after a memorial/nostalgia spike carries reversal risk.'};
    return {label:'WATCH · CHASE RISK',detail:'Pricing moved dramatically. Wait for TCGplayer sales-volume confirmation and supply stabilization before treating the new level as durable.'};
  }
  return {label:'WATCH',detail:'The move is notable but not yet extreme. Favor confirmed sales velocity and sustained demand over listing-price enthusiasm.'};
}
function sourceLabel(s) {
  try { const h=new URL(s.url).hostname.replace(/^www\./,''); if(/apnews/.test(h))return 'AP News'; if(/hasbro/.test(h))return 'Hasbro'; if(/wizards|magic\.wizards/.test(h))return 'Wizards'; if(/hollywoodreporter/.test(h))return 'THR'; if(/variety/.test(h))return 'Variety'; if(/nytimes/.test(h))return 'NY Times'; if(/washingtonpost/.test(h))return 'Washington Post'; return h.split('.')[0].replace(/(^|[-_])\w/g,m=>m.replace(/[-_]/,'').toUpperCase()); } catch { return clip(s.title||'Source',60); }
}
function linkComponents(research, signals) {
  const items=[]; const seen=new Set();
  for(const s of research?.sources||[]){if(!s?.url||seen.has(s.url))continue;seen.add(s.url);items.push({type:2,style:5,label:sourceLabel(s).slice(0,80),url:s.url});if(items.length>=4)break;}
  const mtg=(signals||[]).find(s=>s?.source_url); if(mtg?.source_url&&!seen.has(mtg.source_url))items.push({type:2,style:5,label:'MTGStocks signals',url:mtg.source_url});
  return items.length?[{type:1,components:items.slice(0,5)}]:[];
}
function dossier(alias, rows, prices, signals, buckets, research) {
  const a=research?.analysis||{}; const ssum=signalSummary(signals); const eventDate=a.event_date||null; const firstSignal=earliestSignalDate(signals); const sales=salesAroundEvent(buckets,eventDate); const read=marketRead(ssum,sales); const printings=affectedPrintings(rows,signals,prices);
  const heroSummary=clip(a.catalyst_summary||cleanMarkdown(research?.answer||'External research completed.'),650);
  const hero={color:CATALYST_COLOR,title:`⚡ ${alias.toUpperCase()} · MARKET MOVE`,description:`**Likely catalyst — ${a.catalyst_title||'external event identified'}**\n${heroSummary}`,fields:[
    {name:'CATALYST CONFIDENCE',value:confidenceBadge(a.causal_confidence),inline:true},
    {name:'EVENT CONFIDENCE',value:confidenceBadge(a.event_confidence),inline:true},
    {name:'TIMING FIT',value:timingBadge(a.timing_fit),inline:true},
    {name:'MARKET READ',value:`**${read.label}**\n${clip(read.detail,420)}`,inline:false},
  ],footer:{text:'Collectish market intelligence · public market evidence only'}};

  const timelineBits=[]; if(eventDate)timelineBits.push(`**${day(eventDate)}**  ·  🌐 ${a.catalyst_title||'Catalyst event'}`); if(firstSignal)timelineBits.push(`**${day(firstSignal)}**  ·  ⚡ First captured Optimus market-signal wave`); const latest=(signals||[])[0]?.observed_at; if(latest)timelineBits.push(`**${day(latest)}**  ·  📈 Latest captured repricing / Interests confirmation`);
  const timeline={color:TIMELINE_COLOR,title:'🕒 SEQUENCE',description:timelineBits.join('\n↓\n')||'Timing data unavailable.',footer:{text:'Event date and publication date are reconciled separately when sources differ'}};

  const marketFields=[];
  if(ssum.market.length){const m=ssum.market[0];marketFields.push({name:'TCGPLAYER / MTGSTOCKS MARKET',value:`**${money(m.from)} → ${money(m.to)}  ·  ${pct(m.change)}**\nTransaction-derived market movement is the stronger pricing signal.`,inline:false});}
  if(ssum.average.length){const m=ssum.average[0];marketFields.push({name:'MTGSTOCKS AVERAGE',value:`${money(m.from)} → ${money(m.to)}  ·  ${pct(m.change)}\nListing/average repricing can overshoot actual cleared-sale prices.`,inline:false});}
  if(sales){const pre=sales.preDaily==null?'—':`${sales.preDaily.toFixed(2)}/day`;const post=sales.postDaily==null?'—':`${sales.postDaily.toFixed(2)}/day`;marketFields.push({name:'TCGPLAYER MARKETPLACE BUYERS',value:`Copies sold: **${pre} before → ${post} after**${sales.lift==null?'':`  ·  ${pct(sales.lift)} lift`}\nObserved buckets: ${sales.preBuckets} pre / ${sales.postBuckets} post. TCGplayer Marketplace only — not Collectish Seller History.`,inline:false});}
  else marketFields.push({name:'TCGPLAYER MARKETPLACE BUYERS',value:'No comparable dated sales buckets are currently cached for this family. Price movement is confirmed, but buyer-volume confirmation is incomplete.',inline:false});
  const market={color:MARKET_COLOR,title:'📈 MARKET CONFIRMATION',fields:marketFields,footer:{text:'Market ≠ Average ≠ sales volume · shown separately on purpose'}};

  const pLines=printings.map((p,i)=>`${p.resolved?'🟩':'🟨'} **${p.name}**${p.set?` · ${p.set}${p.cn?` #${p.cn}`:''}`:''}${p.printing?` · ${p.printing}`:''}${p.market!=null?`\n↳ Market ${money(p.market)} · Low ${money(p.low)}`:''}${!p.resolved?'\n↳ Seen in market Signals; exact SKU identity not yet resolved in the lookup index.':''}`);
  const printing={color:PRINTING_COLOR,title:`🃏 AFFECTED PRINTINGS · ${printings.length} detected`,description:clip(pLines.join('\n\n'),3900),footer:{text:'🟩 resolved SKU · 🟨 signal-only family variant'}};

  const alts=(Array.isArray(a.alternatives)?a.alternatives:[]).slice(0,3); const altLines=alts.length?alts.map(x=>`${String(x.fit||'low').toLowerCase()==='high'?'🟢':String(x.fit||'').toLowerCase()==='medium'?'🟡':'⚪'} **${x.title}** · ${String(x.fit||'low').toUpperCase()} fit`).join('\n'):'No credible competing catalyst ranked close to the leading hypothesis.';
  const sourceLines=(research?.sources||[]).slice(0,5).map(s=>`• **${sourceLabel(s)}** — ${clip(s.title||'Source',120)}`).join('\n');
  const evidence={color:RISK_COLOR,title:'🧭 ALTERNATIVES + PROVENANCE',fields:[{name:'Other hypotheses',value:clip(altLines,1000),inline:false},{name:'Best sources',value:sourceLines||'No named sources returned.',inline:false}],footer:{text:'Buttons below open source material directly'}};
  return {content:'',embeds:[hero,timeline,market,printing,evidence],components:linkComponents(research,signals)};
}

async function handle(env,job,message){const alias=moveAlias(job.question);if(!alias)return false;const claim=await claimDelivery(env,job);if(!claim?.claimed){message.ack();return true;}try{
  await editOriginalDiscord(job,{content:`⚡ Building ${alias} market dossier…`,embeds:[],components:[]}).catch(()=>null);
  const rows=await lookupFamily(env,alias);if(!Array.isArray(rows)||!rows.length)throw new Error(`No MTG card-family match found for ${alias}`);
  const [prices,signals,buckets]=await Promise.all([currentPrices(env,rows),recentSignals(env,alias),salesBuckets(env,rows)]);
  const research=await familyResearch(env,job,alias,rows,prices,signals);
  await editOriginalDiscord(job,dossier(alias,rows,prices,signals,buckets,research));
  const a=research?.analysis||{};const responseText=`${alias}: likely catalyst ${a.catalyst_title||'identified'}; causal confidence ${a.causal_confidence||'unknown'}; timing ${a.timing_fit||'unknown'}.`;
  await updateDelivery(env,job.interaction_id,{response_text:responseText,status:'completed',completed_at:new Date().toISOString(),error_text:null});message.ack();return true;
}catch(error){const detail=String(error?.message||error).slice(0,500);await editOriginalDiscord(job,{content:`Delvin couldn't finish the market dossier: ${detail}`,embeds:[],components:[]}).catch(()=>null);await updateDelivery(env,job.interaction_id,{status:'failed',error_text:detail,completed_at:new Date().toISOString()}).catch(()=>null);message.ack();return true;}}

export default {fetch(request,env,ctx){return entry.fetch(request,env,ctx);},async queue(batch,env,ctx){const fallback=[];for(const message of batch.messages){const job=message.body||{};const alias=moveAlias(job.question);const isPrivate=String(job.response_visibility||'').toLowerCase()==='ephemeral';if(!alias||isPrivate){fallback.push(message);continue;}await handle(env,job,message);}if(fallback.length)return entry.queue({messages:fallback},env,ctx);}};
