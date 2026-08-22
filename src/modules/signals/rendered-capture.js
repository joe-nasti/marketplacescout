import store from '../../state/store.js';
import { rest } from '../../core/rest.js';
import { validSession } from '../../core/session.js';
import { collectishConfig } from '../../core/config.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const lower=s=>String(s||'').trim().toLowerCase();
const pretty=s=>String(s||'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
let result=null;

function normalizeUrl(value){const v=String(value||'').trim();if(!v)return'';try{const u=new URL(/^https?:\/\//i.test(v)?v:`https://${v}`);return ['http:','https:'].includes(u.protocol)?u.toString():''}catch{return''}}
function sourceFromUrl(value){try{const n=new URL(value).hostname.replace(/^www\./,'');return n==='x.com'||n==='twitter.com'?'X':n.split('.').slice(0,-1).join('.')||n}catch{return''}}
function sourceTypeFromUrl(value){try{const h=new URL(value).hostname.toLowerCase();if(h==='x.com'||h==='twitter.com')return'x';if(h.includes('reddit.com'))return'reddit';if(h.includes('youtube.com')||h==='youtu.be')return'youtube';return'article'}catch{return'article'}}
function scoutMatch(entity){const rows=store.get().scout?.rows||[];if(entity?.scryfall_id){const x=rows.find(r=>String(r.scryfall_id||'')===String(entity.scryfall_id));if(x)return x}const q=lower(entity?.entity_name||entity);return q?(rows.find(r=>lower(r.product_name)===q)||rows.find(r=>lower(r.product_name).startsWith(`${q} (`))||rows.find(r=>lower(r.product_name).includes(q))):null}
function stageClass(x){return ['leading','confirming','lagging','noise','neutral'].includes(x)?x:'unclassified'}

function mount(){
  const page=document.getElementById('cxSignals');
  const anchor=page?.querySelector('.cx-signal-analyze');
  if(!anchor||document.getElementById('cxRenderedIntel'))return;
  const wrap=document.createElement('details');
  wrap.id='cxRenderedIntel';wrap.className='cx-rendered-intel';
  wrap.innerHTML=`<summary>JS-heavy page? Analyze rendered text</summary><div class="cx-rendered-intel-body"><p class="cx-sub">Copy the visible article text from your browser. MarketplaceScout analyzes it transiently; the raw text is not saved with Signals.</p><input id="cxRenderedTitle" placeholder="Page title (optional)"><textarea id="cxRenderedText" rows="8" placeholder="Paste the rendered article text here…"></textarea><div class="cx-signal-submit"><button type="button" class="cx-primary" id="cxAnalyzeRendered">Analyze rendered text</button><span id="cxRenderedMsg" class="cx-sub"></span></div><div id="cxRenderedResults"></div></div>`;
  anchor.insertAdjacentElement('afterend',wrap);
  document.getElementById('cxAnalyzeRendered')?.addEventListener('click',analyze);
}

async function analyze(){
  const url=normalizeUrl(document.getElementById('cxSignalUrl')?.value);
  const renderedText=document.getElementById('cxRenderedText')?.value.trim()||'';
  const renderedTitle=document.getElementById('cxRenderedTitle')?.value.trim()||'';
  const msg=document.getElementById('cxRenderedMsg'),btn=document.getElementById('cxAnalyzeRendered');
  if(!url){if(msg)msg.textContent='Enter the source URL above first.';return}
  if(renderedText.length<120){if(msg)msg.textContent='Paste at least 120 characters of visible page text.';return}
  btn.disabled=true;if(msg)msg.textContent='Analyzing rendered page text…';result=null;renderResult();
  try{
    const session=await validSession();if(!session)throw new Error('Sign in required');
    const r=await fetch(`${collectishConfig.supabaseUrl}/functions/v1/market-intel-analyze`,{method:'POST',headers:{apikey:collectishConfig.publishableKey,Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},body:JSON.stringify({url,rendered_text:renderedText,rendered_title:renderedTitle})});
    const text=await r.text();let data;try{data=text?JSON.parse(text):{}}catch{data={error:text}};if(!r.ok)throw new Error(data?.error||`Analyzer HTTP ${r.status}`);
    result=data;renderResult();if(msg)msg.textContent=`Found ${(data.signals||[]).length} proposed signal${(data.signals||[]).length===1?'':'s'}.`;
  }catch(e){if(msg)msg.textContent=e?.message||'Could not analyze rendered text.'}
  finally{btn.disabled=false}
}

function renderResult(){
  const box=document.getElementById('cxRenderedResults');if(!box)return;if(!result){box.innerHTML='';return}
  const signals=Array.isArray(result.signals)?result.signals:[];
  box.innerHTML=`<div class="cx-rendered-result-head"><div><strong>${esc(result.title||'Rendered source')}</strong><small>${esc(result.author||'Unknown author')} · full rendered-text analysis</small></div><button type="button" class="cx-primary" id="cxSaveRendered" ${signals.length?'':'disabled'}>Save selected</button></div>${result.source_summary?`<p>${esc(result.source_summary)}</p>`:''}<div class="cx-signal-proposals">${signals.length?signals.map((s,i)=>`<label class="cx-signal-proposal"><input type="checkbox" data-rendered-proposal="${i}" ${s.signal_stage==='noise'?'':'checked'}><div><div class="cx-signal-proposal-top"><strong>${esc(s.entity_name)}</strong><span class="cx-signal-stage ${stageClass(s.signal_stage)}">${esc(pretty(s.signal_stage))}</span><span class="cx-signal-direction ${esc(s.direction)}">${esc(pretty(s.direction))}</span></div><small>${esc(pretty(s.claim_type))} · confidence ${Math.round(Number(s.confidence||0)*100)}%${s.scryfall_id?' · Scryfall resolved':''}${scoutMatch(s)?' · Scout match':''}</small><p>${esc(s.summary||'')}</p>${s.catalyst?`<em>Catalyst: ${esc(s.catalyst)}</em>`:''}</div></label>`).join(''):'<div class="cx-empty">No actionable MTG signals found.</div>'}</div>`;
  document.getElementById('cxSaveRendered')?.addEventListener('click',save);
}

async function save(){
  if(!result)return;const msg=document.getElementById('cxRenderedMsg'),btn=document.getElementById('cxSaveRendered');
  const selected=[...document.querySelectorAll('[data-rendered-proposal]:checked')].map(x=>result.signals[Number(x.dataset.renderedProposal)]).filter(Boolean);
  if(!selected.length){if(msg)msg.textContent='Select at least one signal.';return}
  btn.disabled=true;if(msg)msg.textContent=`Saving ${selected.length} signal${selected.length===1?'':'s'}…`;
  try{
    const url=normalizeUrl(result.url);
    for(const s of selected){const match=scoutMatch(s);const inserted=await rest('market_intel_items',{method:'POST',prefer:'return=representation',body:{source_type:sourceTypeFromUrl(url),source_name:sourceFromUrl(url),source_url:url,title:result.title||s.entity_name||null,author:result.author||null,summary:s.summary||null,claim_type:s.claim_type||'other',signal_stage:s.signal_stage||'unclassified',direction:s.direction||'neutral',confidence:Number(s.confidence||0.5),published_at:result.published_at||null}});const item=Array.isArray(inserted)?inserted[0]:inserted;if(item?.intel_id)await rest('market_intel_entities',{method:'POST',prefer:'return=minimal',body:{intel_id:item.intel_id,entity_type:s.entity_type||'other',entity_name:match?.product_name||s.entity_name,scryfall_id:s.scryfall_id||match?.scryfall_id||null,product_id:match?.product_id||null,set_code:s.set_code||match?.set_code||null,confidence:s.scryfall_id||match?0.99:Number(s.confidence||0.6)}})}
    result=null;renderResult();document.getElementById('cxRenderedText').value='';document.getElementById('cxRenderedTitle').value='';if(msg)msg.textContent=`Saved ${selected.length} rendered-text signal${selected.length===1?'':'s'}.`;document.dispatchEvent(new CustomEvent('collectish:intel-changed',{detail:{source:'rendered-capture'}}));document.getElementById('cxSignalsRefresh')?.click();
  }catch(e){if(msg)msg.textContent=e?.message||'Could not save signals.'}finally{btn.disabled=false}
}

document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='signals')mount()});
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals')queueMicrotask(mount)});
queueMicrotask(mount);
