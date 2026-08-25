import store from '../../state/store.js';
import { rest } from '../../core/rest.js';
import { validSession } from '../../core/session.js';
import { collectishConfig } from '../../core/config.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const lower=s=>String(s||'').trim().toLowerCase();
const pretty=s=>String(s||'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
let installed=false,items=[],activeStage='all',analysis=null;

function host(){return document.getElementById('cxSignals')}
function sourceFromUrl(value){try{const u=new URL(value),name=u.hostname.replace(/^www\./,'');return name==='x.com'||name==='twitter.com'?'X':name.split('.').slice(0,-1).join('.')||name}catch{return''}}
function sourceTypeFromUrl(value){try{const h=new URL(value).hostname.toLowerCase();if(h==='x.com'||h.endsWith('.x.com')||h==='twitter.com')return'x';if(h.includes('reddit.com'))return'reddit';if(h.includes('youtube.com')||h==='youtu.be')return'youtube';return'article'}catch{return'article'}}
function normalizeUrl(value){const v=String(value||'').trim();if(!v)return'';try{const u=new URL(/^https?:\/\//i.test(v)?v:`https://${v}`);return ['http:','https:'].includes(u.protocol)?u.toString():''}catch{return''}}
function scoutMatch(entity){
  const rows=store.get().scout?.rows||[];
  if(entity?.scryfall_id){const bySf=rows.find(r=>String(r.scryfall_id||'')===String(entity.scryfall_id));if(bySf)return bySf}
  const q=lower(entity?.entity_name||entity);if(!q)return null;
  return rows.find(r=>lower(r.product_name)===q)||rows.find(r=>lower(r.product_name).startsWith(`${q} (`))||rows.find(r=>lower(r.product_name).includes(q));
}
function age(value){if(!value)return'';const ms=Date.now()-new Date(value).getTime();if(!Number.isFinite(ms))return'';const h=Math.max(0,Math.round(ms/3600000));if(h<1)return'just now';if(h<24)return`${h}h ago`;return`${Math.round(h/24)}d ago`}
function stageClass(stage){return ['leading','confirming','lagging','noise','neutral'].includes(stage)?stage:'unclassified'}

async function load(){
  const data=await rest('market_intel_items?select=*,market_intel_entities(*),market_intel_card_mentions(*)&order=observed_at.desc&limit=200');
  items=Array.isArray(data)?data:[];
  store.update('intel',{status:'ready',items,error:null,loadedAt:Date.now()});
  renderFeed();
  document.dispatchEvent(new CustomEvent('collectish:intel-changed',{detail:{count:items.length}}));
  return items;
}

function feedItem(item){
  const entities=Array.isArray(item.market_intel_entities)?item.market_intel_entities:[];
  const primaryNames=new Set(entities.filter(e=>e.entity_type==='card').map(e=>lower(e.entity_name)));
  const mentions=(Array.isArray(item.market_intel_card_mentions)?item.market_intel_card_mentions:[]).filter(m=>!primaryNames.has(lower(m.card_name)));
  const source=item.source_name||sourceFromUrl(item.source_url)||pretty(item.source_type);
  const primary=entities.length?`<div class="cx-signal-entities">${entities.map(e=>`<span>${esc(e.entity_name)}${e.scryfall_id?' ✓':''}</span>`).join('')}</div>`:'';
  const mentionTags=mentions.length?`<div class="cx-signal-entities cx-signal-card-mentions" title="Cards mentioned in the source"><small>Also mentions</small>${mentions.slice(0,10).map(m=>`<span>${esc(m.card_name)}${m.scryfall_id?' ✓':''}</span>`).join('')}${mentions.length>10?`<span>+${mentions.length-10} more</span>`:''}</div>`:'';
  return `<article class="cx-signal-card" data-intel-id="${esc(item.intel_id)}"><div class="cx-signal-card-head"><span class="cx-signal-stage ${stageClass(item.signal_stage)}">${esc(pretty(item.signal_stage))}</span><span class="cx-signal-direction ${esc(item.direction)}">${esc(pretty(item.direction))}</span><span class="cx-signal-age">${esc(age(item.observed_at))}</span></div><h3>${esc(item.title||source||'Market signal')}</h3><div class="cx-signal-meta">${esc(source)} · ${esc(pretty(item.claim_type))}${item.author?` · ${esc(item.author)}`:''}</div>${item.summary?`<p>${esc(item.summary)}</p>`:''}${primary}${mentionTags}<div class="cx-signal-actions"><a href="${esc(item.source_url)}" target="_blank" rel="noopener">Open source ↗</a><button type="button" data-delete-intel="${esc(item.intel_id)}">Remove</button></div></article>`;
}
function renderFeed(){const box=document.getElementById('cxSignalsFeed');if(!box)return;const filtered=activeStage==='all'?items:items.filter(x=>x.signal_stage===activeStage);box.innerHTML=filtered.length?filtered.map(feedItem).join(''):'<div class="cx-empty">No signals match this view yet.</div>';document.querySelectorAll('[data-signal-stage]').forEach(b=>b.classList.toggle('active',b.dataset.signalStage===activeStage))}

function renderAnalysis(){
  const box=document.getElementById('cxSignalAnalysis');if(!box)return;
  if(!analysis){box.innerHTML='';return}
  const signals=Array.isArray(analysis.signals)?analysis.signals:[];
  box.innerHTML=`<div class="cx-signal-analysis-head"><div><strong>${esc(analysis.title||'Analyzed source')}</strong><small>${esc(analysis.author||'Unknown author')} · ${signals.length} proposed signal${signals.length===1?'':'s'} · ${esc(analysis.model||'')}</small></div><button type="button" class="cx-primary" id="cxSaveAnalyzed" ${signals.length?'':'disabled'}>Save selected</button></div>${analysis.source_summary?`<p class="cx-signal-source-summary">${esc(analysis.source_summary)}</p>`:''}<div class="cx-signal-proposals">${signals.length?signals.map((s,i)=>{
    const match=scoutMatch(s),resolved=!!s.scryfall_id,checked=s.signal_stage!=='noise';
    return `<label class="cx-signal-proposal"><input type="checkbox" data-proposal-index="${i}" ${checked?'checked':''}><div><div class="cx-signal-proposal-top"><strong>${esc(s.entity_name)}</strong><span class="cx-signal-stage ${stageClass(s.signal_stage)}">${esc(pretty(s.signal_stage))}</span><span class="cx-signal-direction ${esc(s.direction)}">${esc(pretty(s.direction))}</span></div><small>${esc(pretty(s.claim_type))} · confidence ${Math.round(Number(s.confidence||0)*100)}% · ${resolved?'Scryfall resolved':'unresolved'}${match?' · Scout match':''}</small><p>${esc(s.summary||'')}</p>${s.catalyst?`<em>Catalyst: ${esc(s.catalyst)}</em>`:''}</div></label>`;
  }).join(''):'<div class="cx-empty">No actionable MTG market signals were found in this source.</div>'}</div>`;
  document.getElementById('cxSaveAnalyzed')?.addEventListener('click',saveAnalyzed);
}

async function analyzeUrl(){
  const input=document.getElementById('cxSignalUrl'),url=normalizeUrl(input?.value),msg=document.getElementById('cxSignalMsg'),button=document.getElementById('cxAnalyzeSignal');
  if(!url){if(msg)msg.textContent='Enter a valid source URL.';return}
  if(button)button.disabled=true;if(msg)msg.textContent='Reading and analyzing source…';analysis=null;renderAnalysis();
  try{
    const session=await validSession();if(!session)throw new Error('Sign in required');
    const r=await fetch(`${collectishConfig.supabaseUrl}/functions/v1/market-intel-analyze`,{method:'POST',headers:{apikey:collectishConfig.publishableKey,Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},body:JSON.stringify({url})});
    const text=await r.text();let data;try{data=text?JSON.parse(text):{}}catch{data={error:text}}
    if(!r.ok)throw new Error(data?.error||`Analyzer HTTP ${r.status}`);
    analysis=data;store.update('intel',{analysis});renderAnalysis();if(msg)msg.textContent=`Found ${(data.signals||[]).length} proposed signal${(data.signals||[]).length===1?'':'s'}. Card mentions will be tagged separately when saved.`;
  }catch(error){if(msg)msg.textContent=error?.message||'Could not analyze source.'}
  finally{if(button)button.disabled=false}
}

async function saveAnalyzed(){
  if(!analysis)return;
  const url=normalizeUrl(analysis.url),msg=document.getElementById('cxSignalMsg'),button=document.getElementById('cxSaveAnalyzed');
  const selectedIndexes=[...document.querySelectorAll('[data-proposal-index]:checked')].map(x=>Number(x.dataset.proposalIndex)).filter(Number.isInteger);
  if(!selectedIndexes.length){if(msg)msg.textContent='Select at least one proposed signal.';return}
  if(button)button.disabled=true;if(msg)msg.textContent=`Saving ${selectedIndexes.length} signal${selectedIndexes.length===1?'':'s'} and tagging mentioned cards…`;
  try{
    const session=await validSession();if(!session)throw new Error('Sign in required');
    const r=await fetch(`${collectishConfig.supabaseUrl}/functions/v1/market-intel-ingest`,{method:'POST',headers:{apikey:collectishConfig.publishableKey,Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},body:JSON.stringify({url,analysis,selected_indexes:selectedIndexes,source_type:sourceTypeFromUrl(url),source_name:sourceFromUrl(url)})});
    const text=await r.text();let data;try{data=text?JSON.parse(text):{}}catch{data={error:text}}if(!r.ok)throw new Error(data?.error||`Ingest HTTP ${r.status}`);
    const mentionCount=Number(data?.card_mentions?.cards?.length||0);
    analysis=null;store.update('intel',{analysis:null});renderAnalysis();if(msg)msg.textContent=`Saved ${Number(data?.saved||0)} signal${Number(data?.saved||0)===1?'':'s'}${mentionCount?` and resolved ${mentionCount} mentioned card${mentionCount===1?'':'s'}`:''}.`;await load();
  }catch(error){if(msg)msg.textContent=error?.message||'Could not save analyzed signals.'}
  finally{if(button)button.disabled=false}
}

function render(){
  const h=host();if(!h)return;
  h.innerHTML=`<div class="cx-page-head"><div><h2>Signals</h2><p>External market intelligence attached to Scout opportunities.</p><small class="cx-sub">Signals are context only and do not change the Scout grade.</small></div><button class="cx-refresh" id="cxSignalsRefresh">Refresh</button></div><div class="cx-signals-layout"><section class="cx-card cx-signal-add"><div class="cx-section-title">Analyze a source</div><p class="cx-sub">Paste an article or public post. MarketplaceScout will propose individual MTG market signals for review.</p><div class="cx-signal-analyze"><input id="cxSignalUrl" type="url" required placeholder="https://…"><button class="cx-primary" type="button" id="cxAnalyzeSignal">Analyze URL</button></div><div id="cxSignalMsg" class="cx-sub"></div><div id="cxSignalAnalysis"></div><details class="cx-signal-manual"><summary>Manual entry</summary><form id="cxSignalForm"><div class="cx-signal-form-grid"><label>Title<input id="cxSignalTitle" placeholder="What is this about?"></label><label>Card / product<input id="cxSignalEntity" placeholder="Exact card name works best"></label></div><div class="cx-signal-form-grid three"><label>Type<select id="cxSignalSourceType"><option value="article">Article</option><option value="x">X</option><option value="discord">Discord</option><option value="reddit">Reddit</option><option value="youtube">YouTube</option><option value="official">Official</option><option value="manual">Manual</option><option value="other">Other</option></select></label><label>Signal<select id="cxSignalStage"><option value="unclassified">Unclassified</option><option value="leading">Leading</option><option value="confirming">Confirming</option><option value="lagging">Lagging</option><option value="neutral">Neutral</option><option value="noise">Noise</option></select></label><label>Direction<select id="cxSignalDirection"><option value="bullish">Bullish</option><option value="neutral">Neutral</option><option value="bearish">Bearish</option></select></label></div><div class="cx-signal-form-grid"><label>Claim<select id="cxSignalClaim"><option value="demand">Demand</option><option value="supply">Supply</option><option value="price">Price</option><option value="buylist">Buylist</option><option value="meta">Meta</option><option value="reprint">Reprint</option><option value="competitive">Competitive</option><option value="product">Product</option><option value="other">Other</option></select></label><label>Author / account<input id="cxSignalAuthor" placeholder="Optional"></label></div><label>Signal summary<textarea id="cxSignalSummary" rows="3" placeholder="The useful claim or thesis—not the full article text."></textarea></label><div class="cx-signal-submit"><button class="cx-primary" type="submit" id="cxSignalSubmit">Add manually</button></div></form></details></section><section><div class="cx-signal-tabs">${['all','leading','confirming','lagging','noise'].map(x=>`<button type="button" data-signal-stage="${x}" class="${x==='all'?'active':''}">${pretty(x)}</button>`).join('')}</div><div id="cxSignalsFeed" class="cx-signals-feed"><div class="cx-empty">Loading signals…</div></div></section></div>`;
  document.getElementById('cxSignalsRefresh').onclick=()=>load().catch(showError);
  document.getElementById('cxAnalyzeSignal').onclick=analyzeUrl;
  document.getElementById('cxSignalUrl').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();analyzeUrl()}});
  document.querySelector('.cx-signal-tabs')?.addEventListener('click',e=>{const b=e.target.closest('[data-signal-stage]');if(b){activeStage=b.dataset.signalStage;renderFeed()}});
  document.getElementById('cxSignalsFeed')?.addEventListener('click',async e=>{const b=e.target.closest('[data-delete-intel]');if(!b)return;try{b.disabled=true;await rest(`market_intel_items?intel_id=eq.${encodeURIComponent(b.dataset.deleteIntel)}`,{method:'DELETE'});await load()}catch(error){showError(error)}},true);
  document.getElementById('cxSignalForm').addEventListener('submit',submitSignal);
  load().catch(showError);
}

async function submitSignal(event){
  event.preventDefault();
  const form=event.target,url=normalizeUrl(document.getElementById('cxSignalUrl')?.value),msg=document.getElementById('cxSignalMsg'),button=document.getElementById('cxSignalSubmit');
  if(!url){if(msg)msg.textContent='Enter a valid source URL above.';return}
  if(button)button.disabled=true;if(msg)msg.textContent='Saving…';
  try{
    const entityName=document.getElementById('cxSignalEntity')?.value.trim()||'',match=scoutMatch(entityName);
    const payload={source_type:document.getElementById('cxSignalSourceType')?.value||sourceTypeFromUrl(url),source_name:sourceFromUrl(url),source_url:url,title:document.getElementById('cxSignalTitle')?.value.trim()||null,author:document.getElementById('cxSignalAuthor')?.value.trim()||null,summary:document.getElementById('cxSignalSummary')?.value.trim()||null,claim_type:document.getElementById('cxSignalClaim')?.value||'other',signal_stage:document.getElementById('cxSignalStage')?.value||'unclassified',direction:document.getElementById('cxSignalDirection')?.value||'neutral'};
    const inserted=await rest('market_intel_items',{method:'POST',prefer:'return=representation',body:payload}),item=Array.isArray(inserted)?inserted[0]:inserted;
    if(item?.intel_id&&entityName)await rest('market_intel_entities',{method:'POST',prefer:'return=minimal',body:{intel_id:item.intel_id,entity_type:'card',entity_name:match?.product_name||entityName,scryfall_id:match?.scryfall_id||null,product_id:match?.product_id||null,set_code:match?.set_code||null,confidence:match?0.99:0.60}});
    form.reset();if(msg)msg.textContent=entityName?(match?'Saved and linked to Scout.':'Saved; card link needs review.'):'Saved.';await load();
  }catch(error){if(msg)msg.textContent=error?.message||'Could not save signal.'}finally{if(button)button.disabled=false}
}
function showError(error){store.update('intel',{status:'error',error:String(error?.message||error)});const box=document.getElementById('cxSignalsFeed');if(box)box.innerHTML=`<div class="cx-empty">Could not load Signals: ${esc(error?.message||error)}</div>`}
export async function install(){if(installed)return;installed=true;render()}
