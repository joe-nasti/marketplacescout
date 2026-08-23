import store from '../../state/store.js';
import { validSession } from '../../core/session.js';
import { collectishConfig } from '../../core/config.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const lower=s=>String(s||'').trim().toLowerCase();
const pretty=s=>String(s||'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
let result=null;

function normalizeUrl(value){const v=String(value||'').trim();if(!v)return'';try{const u=new URL(/^https?:\/\//i.test(v)?v:`https://${v}`);return ['http:','https:'].includes(u.protocol)?u.toString():''}catch{return''}}
function scoutMatch(entity){const rows=store.get().scout?.rows||[];if(entity?.scryfall_id){const x=rows.find(r=>String(r.scryfall_id||'')===String(entity.scryfall_id));if(x)return x}const q=lower(entity?.entity_name||entity);return q?(rows.find(r=>lower(r.product_name)===q)||rows.find(r=>lower(r.product_name).startsWith(`${q} (`))||rows.find(r=>lower(r.product_name).includes(q))):null}
function stageClass(x){return ['leading','confirming','lagging','noise','neutral'].includes(x)?x:'unclassified'}

function mount(){
  const page=document.getElementById('cxSignals');
  const anchor=page?.querySelector('.cx-signal-analyze');
  if(!anchor||document.getElementById('cxRenderedIntel'))return;
  const wrap=document.createElement('details');
  wrap.id='cxRenderedIntel';wrap.className='cx-rendered-intel';
  wrap.innerHTML=`<summary>JS-heavy page? Analyze rendered text</summary><div class="cx-rendered-intel-body"><p class="cx-sub">Copy the visible article, X post, Discord message/thread, or other source text from your browser. MarketplaceScout analyzes it transiently; the raw text is not saved with Signals.</p><input id="cxRenderedTitle" placeholder="Source title (optional)"><textarea id="cxRenderedText" rows="8" placeholder="Paste the rendered source text here…"></textarea><div class="cx-signal-submit"><button type="button" class="cx-primary" id="cxAnalyzeRendered">Analyze rendered text</button><span id="cxRenderedMsg" class="cx-sub"></span></div><div id="cxRenderedResults"></div></div>`;
  anchor.insertAdjacentElement('afterend',wrap);
  document.getElementById('cxAnalyzeRendered')?.addEventListener('click',analyze);
}

async function callFunction(name,body){
  const session=await validSession();if(!session)throw new Error('Sign in required');
  const r=await fetch(`${collectishConfig.supabaseUrl}/functions/v1/${name}`,{method:'POST',headers:{apikey:collectishConfig.publishableKey,Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const text=await r.text();let data;try{data=text?JSON.parse(text):{}}catch{data={error:text}};if(!r.ok)throw new Error(data?.error||`${name} HTTP ${r.status}`);return data;
}

async function analyze(){
  const url=normalizeUrl(document.getElementById('cxSignalUrl')?.value);
  const renderedText=document.getElementById('cxRenderedText')?.value.trim()||'';
  const renderedTitle=document.getElementById('cxRenderedTitle')?.value.trim()||'';
  const msg=document.getElementById('cxRenderedMsg'),btn=document.getElementById('cxAnalyzeRendered');
  if(!url){if(msg)msg.textContent='Enter the source URL above first.';return}
  if(renderedText.length<120){if(msg)msg.textContent='Paste at least 120 characters of visible source text.';return}
  btn.disabled=true;if(msg)msg.textContent='Analyzing rendered source text…';result=null;renderResult();
  try{
    result=await callFunction('market-intel-analyze',{url,rendered_text:renderedText,rendered_title:renderedTitle});
    renderResult();if(msg)msg.textContent=`Found ${(result.signals||[]).length} proposed signal${(result.signals||[]).length===1?'':'s'}.`;
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
  const selectedIndexes=[...document.querySelectorAll('[data-rendered-proposal]:checked')].map(x=>Number(x.dataset.renderedProposal)).filter(Number.isInteger);
  if(!selectedIndexes.length){if(msg)msg.textContent='Select at least one signal.';return}
  btn.disabled=true;if(msg)msg.textContent=`Saving ${selectedIndexes.length} signal${selectedIndexes.length===1?'':'s'}…`;
  try{
    const saved=await callFunction('market-intel-ingest',{url:normalizeUrl(result.url),analysis:result,selected_indexes:selectedIndexes});
    result=null;renderResult();document.getElementById('cxRenderedText').value='';document.getElementById('cxRenderedTitle').value='';
    if(msg)msg.textContent=`Saved ${saved.saved||0} signal${saved.saved===1?'':'s'}${saved.duplicates?` · skipped ${saved.duplicates} duplicate${saved.duplicates===1?'':'s'}`:''}.`;
    document.dispatchEvent(new CustomEvent('collectish:intel-changed',{detail:{source:'market-intel-ingest',saved:saved.saved||0,duplicates:saved.duplicates||0}}));document.getElementById('cxSignalsRefresh')?.click();
  }catch(e){if(msg)msg.textContent=e?.message||'Could not save signals.'}finally{btn.disabled=false}
}

document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='signals')mount()});
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals')queueMicrotask(mount)});
queueMicrotask(mount);
