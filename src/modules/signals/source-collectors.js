import { rest } from '../../core/rest.js';
import { validSession } from '../../core/session.js';
import { collectishConfig } from '../../core/config.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const normalizeUrl=value=>{const v=String(value||'').trim();if(!v)return'';try{const u=new URL(/^https?:\/\//i.test(v)?v:`https://${v}`);return ['http:','https:'].includes(u.protocol)?u.toString():''}catch{return''}};
const PRESETS=[
  {id:'mtgstocks',name:'MTGStocks',url:'https://api.mtgstocks.com/news/feed',note:'MTG finance/news Atom feed'}
];
let feeds=[];

function host(){return document.getElementById('cxSignals')}
function message(text){const el=document.getElementById('cxCollectorMsg');if(el)el.textContent=text||''}
function isConfigured(url){return feeds.some(f=>String(f.source_key||'')===url)}

async function loadFeeds(){
  try{feeds=await rest('source_captures?select=capture_id,source,source_key,payload_json,captured_at&capture_type=eq.feed_subscription&order=captured_at.asc&limit=50')||[]}catch{feeds=[]}
  renderPresets();renderFeeds();
}

function renderPresets(){
  const box=document.getElementById('cxCollectorPresets');if(!box)return;
  box.innerHTML=PRESETS.map(p=>`<button type="button" data-feed-preset="${esc(p.id)}" ${isConfigured(p.url)?'disabled':''}><strong>${esc(p.name)}</strong><span>${esc(isConfigured(p.url)?'Added':p.note)}</span></button>`).join('');
  box.querySelectorAll('[data-feed-preset]').forEach(btn=>btn.addEventListener('click',()=>addPreset(btn.dataset.feedPreset)));
}

function renderFeeds(){
  const box=document.getElementById('cxCollectorFeeds');if(!box)return;
  if(!feeds.length){box.innerHTML='<div class="cx-empty">No automated feeds configured yet.</div>';return}
  box.innerHTML=feeds.map(f=>`<button type="button" data-feed-remove="${esc(f.capture_id)}"><strong>${esc(f.source||'Feed')}</strong><span>${esc(f.source_key||'')} · ${f?.payload_json?.enabled===false?'paused':'active'} · remove</span></button>`).join('');
  box.querySelectorAll('[data-feed-remove]').forEach(btn=>btn.addEventListener('click',()=>removeFeed(btn.dataset.feedRemove)));
}

async function registerFeed(source,url,maxItems=5){
  const session=await validSession();if(!session?.user?.id)throw new Error('Sign in required');
  await rest('source_captures?on_conflict=user_id,source,capture_type,source_key',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:{user_id:session.user.id,source,capture_type:'feed_subscription',source_key:url,content_type:'application/feed+subscription',payload_json:{feed_url:url,enabled:true,max_items:maxItems},metadata_json:{kind:'market_intel_feed'}}});
}

async function addPreset(id){
  const preset=PRESETS.find(p=>p.id===id);if(!preset||isConfigured(preset.url))return;
  message(`Adding ${preset.name}…`);
  try{await registerFeed(preset.name,preset.url,5);message(`Added ${preset.name}.`);await loadFeeds()}catch(e){message(e?.message||`Could not add ${preset.name}.`)}
}

async function addFeed(){
  const name=document.getElementById('cxCollectorName')?.value.trim()||'';
  const url=normalizeUrl(document.getElementById('cxCollectorUrl')?.value);
  if(!url){message('Enter a valid RSS or Atom feed URL.');return}
  const source=name||new URL(url).hostname.replace(/^www\./,'');
  const btn=document.getElementById('cxCollectorAdd');btn.disabled=true;message('Adding feed…');
  try{
    await registerFeed(source,url,5);
    document.getElementById('cxCollectorName').value='';document.getElementById('cxCollectorUrl').value='';
    message(`Added ${source}.`);await loadFeeds();
  }catch(e){message(e?.message||'Could not add feed.')}finally{btn.disabled=false}
}

async function removeFeed(id){
  if(!id)return;message('Removing feed…');
  try{await rest(`source_captures?capture_id=eq.${encodeURIComponent(id)}`,{method:'DELETE',prefer:'return=minimal'});message('Feed removed.');await loadFeeds()}catch(e){message(e?.message||'Could not remove feed.')}
}

async function syncFeeds(){
  const btn=document.getElementById('cxCollectorSync');btn.disabled=true;message('Checking feeds and ingesting new items…');
  try{
    const session=await validSession();if(!session)throw new Error('Sign in required');
    const r=await fetch(`${collectishConfig.supabaseUrl}/functions/v1/market-intel-feed-sync`,{method:'POST',headers:{apikey:collectishConfig.publishableKey,Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},body:JSON.stringify({max_total:12})});
    const raw=await r.text();let data;try{data=raw?JSON.parse(raw):{}}catch{data={error:raw}};if(!r.ok)throw new Error(data?.error||`Feed sync HTTP ${r.status}`);
    message(`Checked ${data.feeds||0} feed${data.feeds===1?'':'s'} · ${data.saved||0} new signal${data.saved===1?'':'s'} · ${data.duplicates||0} duplicate${data.duplicates===1?'':'s'}${data.failed?` · ${data.failed} failed`:''}.`);
    if(data.saved)document.dispatchEvent(new CustomEvent('collectish:intel-changed',{detail:{source:'feed-sync',saved:data.saved}}));
    document.getElementById('cxSignalsRefresh')?.click();
  }catch(e){message(e?.message||'Could not sync feeds.')}finally{btn.disabled=false}
}

function mount(){
  const page=host(),anchor=document.getElementById('cxRenderedIntel')||page?.querySelector('.cx-signal-analyze');
  if(!page||!anchor||document.getElementById('cxSourceCollectors'))return;
  const wrap=document.createElement('details');wrap.id='cxSourceCollectors';wrap.className='cx-rendered-intel';
  wrap.innerHTML=`<summary>Source collectors</summary><div class="cx-rendered-intel-body"><p class="cx-sub">Add a curated source or subscribe to any public RSS/Atom feed. Discord/X content you can access but cannot automate still uses the rendered-text handoff above and enters the same canonical intake pipeline.</p><div id="cxCollectorPresets" class="cx-ai-result-list"></div><input id="cxCollectorName" placeholder="Source name (optional)"><input id="cxCollectorUrl" placeholder="RSS / Atom feed URL"><div class="cx-signal-submit"><button type="button" class="cx-primary" id="cxCollectorAdd">Add feed</button><button type="button" id="cxCollectorSync">Sync now</button><span id="cxCollectorMsg" class="cx-sub"></span></div><div id="cxCollectorFeeds" class="cx-ai-result-list"></div></div>`;
  anchor.insertAdjacentElement('afterend',wrap);
  document.getElementById('cxCollectorAdd')?.addEventListener('click',addFeed);
  document.getElementById('cxCollectorSync')?.addEventListener('click',syncFeeds);
  loadFeeds();
}

document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='signals')queueMicrotask(mount)});
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals')queueMicrotask(mount)});
queueMicrotask(mount);
