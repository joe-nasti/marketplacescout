import store from '../../state/store.js';
import { rest } from '../../core/rest.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const lower=s=>String(s||'').trim().toLowerCase();
const pretty=s=>String(s||'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
let installed=false,items=[],activeStage='all';

function host(){return document.getElementById('cxSignals')}
function sourceFromUrl(value){try{const u=new URL(value),name=u.hostname.replace(/^www\./,'');return name==='x.com'||name==='twitter.com'?'X':name.split('.').slice(0,-1).join('.')||name}catch{return''}}
function normalizeUrl(value){const v=String(value||'').trim();if(!v)return'';try{const u=new URL(/^https?:\/\//i.test(v)?v:`https://${v}`);return ['http:','https:'].includes(u.protocol)?u.toString():''}catch{return''}}
function scoutMatch(name){const q=lower(name);if(!q)return null;const rows=store.get().scout?.rows||[];return rows.find(r=>lower(r.product_name)===q)||rows.find(r=>lower(r.product_name).startsWith(`${q} (`))||rows.find(r=>lower(r.product_name).includes(q))}
function age(value){if(!value)return'';const ms=Date.now()-new Date(value).getTime();if(!Number.isFinite(ms))return'';const h=Math.max(0,Math.round(ms/3600000));if(h<1)return'just now';if(h<24)return`${h}h ago`;return`${Math.round(h/24)}d ago`}
function stageClass(stage){return ['leading','confirming','lagging','noise','neutral'].includes(stage)?stage:'unclassified'}

async function load(){
  const data=await rest('market_intel_items?select=*,market_intel_entities(*)&order=observed_at.desc&limit=200');
  items=Array.isArray(data)?data:[];
  store.update('intel',{status:'ready',items,error:null,loadedAt:Date.now()});
  renderFeed();
  document.dispatchEvent(new CustomEvent('collectish:intel-changed',{detail:{count:items.length}}));
  return items;
}
function feedItem(item){
  const entities=Array.isArray(item.market_intel_entities)?item.market_intel_entities:[];
  const source=item.source_name||sourceFromUrl(item.source_url)||pretty(item.source_type);
  return `<article class="cx-signal-card" data-intel-id="${esc(item.intel_id)}"><div class="cx-signal-card-head"><span class="cx-signal-stage ${stageClass(item.signal_stage)}">${esc(pretty(item.signal_stage))}</span><span class="cx-signal-direction ${esc(item.direction)}">${esc(pretty(item.direction))}</span><span class="cx-signal-age">${esc(age(item.observed_at))}</span></div><h3>${esc(item.title||source||'Market signal')}</h3><div class="cx-signal-meta">${esc(source)} · ${esc(pretty(item.claim_type))}${item.author?` · ${esc(item.author)}`:''}</div>${item.summary?`<p>${esc(item.summary)}</p>`:''}${entities.length?`<div class="cx-signal-entities">${entities.map(e=>`<span>${esc(e.entity_name)}</span>`).join('')}</div>`:''}<div class="cx-signal-actions"><a href="${esc(item.source_url)}" target="_blank" rel="noopener">Open source ↗</a><button type="button" data-delete-intel="${esc(item.intel_id)}">Remove</button></div></article>`;
}
function renderFeed(){const box=document.getElementById('cxSignalsFeed');if(!box)return;const filtered=activeStage==='all'?items:items.filter(x=>x.signal_stage===activeStage);box.innerHTML=filtered.length?filtered.map(feedItem).join(''):'<div class="cx-empty">No signals match this view yet.</div>';document.querySelectorAll('[data-signal-stage]').forEach(b=>b.classList.toggle('active',b.dataset.signalStage===activeStage))}

function render(){
  const h=host();if(!h)return;
  h.innerHTML=`<div class="cx-page-head"><div><h2>Signals</h2><p>External market intelligence attached to Scout opportunities.</p><small class="cx-sub">Signals are context only in v0.1 and do not change the Scout grade.</small></div><button class="cx-refresh" id="cxSignalsRefresh">Refresh</button></div><div class="cx-signals-layout"><section class="cx-card cx-signal-add"><div class="cx-section-title">Add market signal</div><p class="cx-sub">Capture an article, social post, Discord observation, or other source. Link it to a card when possible.</p><form id="cxSignalForm"><label>Source URL<input id="cxSignalUrl" type="url" required placeholder="https://…"></label><div class="cx-signal-form-grid"><label>Title<input id="cxSignalTitle" placeholder="What is this about?"></label><label>Card / product<input id="cxSignalEntity" placeholder="Exact card name works best"></label></div><div class="cx-signal-form-grid three"><label>Type<select id="cxSignalSourceType"><option value="article">Article</option><option value="x">X</option><option value="discord">Discord</option><option value="reddit">Reddit</option><option value="youtube">YouTube</option><option value="official">Official</option><option value="manual">Manual</option><option value="other">Other</option></select></label><label>Signal<select id="cxSignalStage"><option value="unclassified">Unclassified</option><option value="leading">Leading</option><option value="confirming">Confirming</option><option value="lagging">Lagging</option><option value="neutral">Neutral</option><option value="noise">Noise</option></select></label><label>Direction<select id="cxSignalDirection"><option value="bullish">Bullish</option><option value="neutral">Neutral</option><option value="bearish">Bearish</option></select></label></div><div class="cx-signal-form-grid"><label>Claim<select id="cxSignalClaim"><option value="demand">Demand</option><option value="supply">Supply</option><option value="price">Price</option><option value="buylist">Buylist</option><option value="meta">Meta</option><option value="reprint">Reprint</option><option value="competitive">Competitive</option><option value="product">Product</option><option value="other">Other</option></select></label><label>Author / account<input id="cxSignalAuthor" placeholder="Optional"></label></div><label>Signal summary<textarea id="cxSignalSummary" rows="3" placeholder="The useful claim or thesis—not the full article text."></textarea></label><div class="cx-signal-submit"><button class="cx-primary" type="submit" id="cxSignalSubmit">Add signal</button><span id="cxSignalMsg" class="cx-sub"></span></div></form></section><section><div class="cx-signal-tabs">${['all','leading','confirming','lagging','noise'].map(x=>`<button type="button" data-signal-stage="${x}" class="${x==='all'?'active':''}">${pretty(x)}</button>`).join('')}</div><div id="cxSignalsFeed" class="cx-signals-feed"><div class="cx-empty">Loading signals…</div></div></section></div>`;
  document.getElementById('cxSignalsRefresh').onclick=()=>load().catch(showError);
  document.querySelector('.cx-signal-tabs')?.addEventListener('click',e=>{const b=e.target.closest('[data-signal-stage]');if(b){activeStage=b.dataset.signalStage;renderFeed()}});
  document.getElementById('cxSignalsFeed')?.addEventListener('click',async e=>{const b=e.target.closest('[data-delete-intel]');if(!b)return;try{b.disabled=true;await rest(`market_intel_items?intel_id=eq.${encodeURIComponent(b.dataset.deleteIntel)}`,{method:'DELETE'});await load()}catch(error){showError(error)}},true);
  document.getElementById('cxSignalForm').addEventListener('submit',submitSignal);
  load().catch(showError);
}

async function submitSignal(event){
  event.preventDefault();
  const form=event.target,url=normalizeUrl(document.getElementById('cxSignalUrl')?.value),msg=document.getElementById('cxSignalMsg'),button=document.getElementById('cxSignalSubmit');
  if(!url){if(msg)msg.textContent='Enter a valid source URL.';return}
  if(button)button.disabled=true;if(msg)msg.textContent='Saving…';
  try{
    const entityName=document.getElementById('cxSignalEntity')?.value.trim()||'',match=scoutMatch(entityName);
    const payload={source_type:document.getElementById('cxSignalSourceType')?.value||'article',source_name:sourceFromUrl(url),source_url:url,title:document.getElementById('cxSignalTitle')?.value.trim()||null,author:document.getElementById('cxSignalAuthor')?.value.trim()||null,summary:document.getElementById('cxSignalSummary')?.value.trim()||null,claim_type:document.getElementById('cxSignalClaim')?.value||'other',signal_stage:document.getElementById('cxSignalStage')?.value||'unclassified',direction:document.getElementById('cxSignalDirection')?.value||'neutral'};
    const inserted=await rest('market_intel_items',{method:'POST',prefer:'return=representation',body:payload}),item=Array.isArray(inserted)?inserted[0]:inserted;
    if(item?.intel_id&&entityName)await rest('market_intel_entities',{method:'POST',prefer:'return=minimal',body:{intel_id:item.intel_id,entity_type:'card',entity_name:match?.product_name||entityName,scryfall_id:match?.scryfall_id||null,product_id:match?.product_id||null,set_code:match?.set_code||null,confidence:match?0.99:0.60}});
    form.reset();if(msg)msg.textContent=entityName?(match?'Saved and linked to Scout.':'Saved; card link needs review.'):'Saved.';await load();
  }catch(error){if(msg)msg.textContent=error?.message||'Could not save signal.'}finally{if(button)button.disabled=false}
}
function showError(error){store.update('intel',{status:'error',error:String(error?.message||error)});const box=document.getElementById('cxSignalsFeed');if(box)box.innerHTML=`<div class="cx-empty">Could not load Signals: ${esc(error?.message||error)}</div>`}
export async function install(){if(installed)return;installed=true;render()}
