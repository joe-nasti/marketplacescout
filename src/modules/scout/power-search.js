import { parseScoutSearchQuery, removeScoutSearchToken } from './search-query.js';

let timer=null;
let activeQuery=null;
let installed=false;

const hasOperators=q=>q.tokens.length>0;
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const finishLabel=x=>x==='nonfoil'?'Normal':x==='foil'?'Foil':x==='etched'?'Etched':x;

function input(){return document.getElementById('cxParitySearch')}
function host(){
  const field=input();if(!field)return null;
  let h=document.getElementById('cxScoutPowerTokens');
  if(!h){h=document.createElement('div');h.id='cxScoutPowerTokens';h.className='cx-power-search-tokens';field.parentNode.insertBefore(h,field.nextSibling)}
  return h;
}
function clearTokens(){document.getElementById('cxScoutPowerTokens')?.remove();activeQuery=null}
function renderTokens(query){
  const h=host();if(!h)return;
  const good=query.tokens.filter(t=>t.kind!=='unknown');
  const label=t=>t.kind==='set'?`Set: ${t.normalizedValue}`:t.kind==='collectorNumber'?`CN: ${t.normalizedValue}`:`Finish: ${finishLabel(t.normalizedValue)}`;
  h.innerHTML=`${good.map(t=>`<button type="button" class="cx-power-token" data-remove-token="${esc(t.raw)}">${esc(label(t))}<span aria-hidden="true">×</span></button>`).join('')}${query.unknownTokens.map(t=>`<span class="cx-power-token cx-power-token-warn">Unknown: ${esc(t)}</span>`).join('')}`;
  h.querySelectorAll('[data-remove-token]').forEach(btn=>btn.addEventListener('click',()=>{
    const field=input();if(!field)return;
    field.value=removeScoutSearchToken(field.value,btn.dataset.removeToken);
    field.dispatchEvent(new Event('input',{bubbles:true}));
    field.focus();
  }));
}

async function exactName(name){
  const r=await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`);
  if(r.ok){const card=await r.json();return card?.name||''}
  const a=await fetch(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(name)}&include_extras=true`);
  if(!a.ok)return'';const j=await a.json();return j?.data?.[0]||'';
}
async function nameFromSetCollector(query){
  const set=query.filters.setCodes[0],cn=query.filters.collectorNumbers[0];
  if(!set||!cn)return'';
  const r=await fetch(`https://api.scryfall.com/cards/${encodeURIComponent(set.toLowerCase())}/${encodeURIComponent(cn)}`);
  if(!r.ok)return'';const card=await r.json();return card?.name||'';
}

function articleMeta(article){
  const small=article.querySelector('.cx-global-print-title small')?.textContent||'';
  const parts=small.split('·').map(x=>x.trim());
  return {set:(parts[0]||'').toUpperCase(),collector:(parts[1]||'').replace(/^#/,'').trim(),finishes:(parts.slice(2).join(' · ')||'').toLowerCase()};
}
function articleMatches(article,query){
  const meta=articleMeta(article),{setCodes,collectorNumbers,finishes}=query.filters;
  if(setCodes.length&&!setCodes.includes(meta.set))return false;
  if(collectorNumbers.length&&!collectorNumbers.includes(meta.collector))return false;
  if(finishes.length&&!finishes.some(f=>f==='nonfoil'?meta.finishes.includes('normal'):f==='foil'?meta.finishes.includes('foil'):meta.finishes.includes('etched')))return false;
  return true;
}
function applyToRenderedResults(query){
  const panel=document.getElementById('cxGlobalScoutSearch');if(!panel)return;
  const articles=[...panel.querySelectorAll('.cx-global-print')];if(!articles.length)return;
  let visible=0,fresh=0,stale=0,unscanned=0;
  for(const article of articles){
    const show=articleMatches(article,query);article.hidden=!show;if(!show)continue;visible++;
    const state=article.querySelector('.cx-global-state');
    if(state?.classList.contains('fresh'))fresh++;else if(state?.classList.contains('stale'))stale++;else unscanned++;
  }
  const summary=panel.querySelector('.cx-global-head p');if(summary)summary.textContent=`Filtered paper-printing search • ${visible} matching · ${articles.length} total`;
  const counts=panel.querySelector('.cx-global-counts');if(counts)counts.innerHTML=`<span class="fresh">${fresh} fresh</span><span class="stale">${stale} stale</span><span class="unscanned">${unscanned} unscanned</span>`;
  const scan=panel.querySelector('#cxScanGlobalVariants');if(scan){scan.disabled=true;scan.textContent='Filtered search · clear filters to scan all variants'}
  if(!visible){
    let empty=panel.querySelector('.cx-power-search-empty');if(!empty){empty=document.createElement('div');empty.className='cx-empty cx-power-search-empty';panel.querySelector('.cx-global-printings')?.prepend(empty)}
    empty.textContent='No printings match the active set, collector number, and finish filters.';
  }else panel.querySelector('.cx-power-search-empty')?.remove();
  document.dispatchEvent(new CustomEvent('collectish:scout-power-search-rendered',{detail:{raw:query.raw,name:query.nameText,visible,total:articles.length,filters:query.filters}}));
}

async function run(raw,{force=false}={}){
  const query=parseScoutSearchQuery(raw);activeQuery=query;renderTokens(query);
  if(!hasOperators(query)){clearTokens();return false}
  const api=window.CollectishScoutGlobalSearch;if(!api?.loadCard)return false;
  let name=query.nameText;
  if(name)name=await exactName(name);else name=await nameFromSetCollector(query);
  if(!name){
    const p=document.getElementById('cxGlobalScoutSearch');
    if(force&&p){p.hidden=false;p.innerHTML='<div class="cx-empty">Add a card name, or use set + collector number (for example <b>s:SLD cn:2812</b>).</div>'}
    return false;
  }
  query.resolvedName=name;activeQuery=query;
  await api.loadCard(name);
  const field=input();if(field)field.value=raw;
  renderTokens(query);
  applyToRenderedResults(query);
  return true;
}

function onInputCapture(e){
  if(e.target?.id!=='cxParitySearch')return;
  const raw=e.target.value.trim(),query=parseScoutSearchQuery(raw);
  if(!hasOperators(query)){clearTokens();return}
  e.stopImmediatePropagation();activeQuery=query;renderTokens(query);clearTimeout(timer);
  if(raw.length<2)return;
  timer=setTimeout(()=>{if(input()?.value.trim()===raw)run(raw)},260);
}
function onKeyCapture(e){
  if(e.target?.id!=='cxParitySearch')return;
  const raw=e.target.value.trim(),query=parseScoutSearchQuery(raw);if(!hasOperators(query))return;
  if(e.key==='Escape'){clearTokens();return}
  if(e.key!=='Enter')return;e.preventDefault();e.stopImmediatePropagation();clearTimeout(timer);run(raw,{force:true});
}
function onRendered(){if(activeQuery&&hasOperators(activeQuery))applyToRenderedResults(activeQuery)}

const style=document.createElement('style');
style.textContent=`.cx-power-search-tokens{display:flex;gap:6px;flex-wrap:wrap;margin:7px 0 0}.cx-power-token{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--cx-line);background:var(--cx-bg);color:var(--cx-text);border-radius:999px;padding:5px 8px;font-size:11px;font-weight:750}.cx-power-token span{font-size:14px;line-height:1}.cx-power-token-warn{border-color:#e0a11a;color:#8b5a00;background:#fff3d9}.cx-power-search-empty{margin-bottom:10px}`;
document.head.appendChild(style);

export function installScoutPowerSearch(){
  if(installed)return;installed=true;
  document.addEventListener('input',onInputCapture,true);
  document.addEventListener('keydown',onKeyCapture,true);
  document.addEventListener('collectish:scout-global-rendered',onRendered);
  const field=input();if(field)field.placeholder='Search cards · s:SLD cn:2812 f:foil';
}
installScoutPowerSearch();

window.CollectishScoutPowerSearch={parse:parseScoutSearchQuery,run,apply:()=>activeQuery&&applyToRenderedResults(activeQuery)};
