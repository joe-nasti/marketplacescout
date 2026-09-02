import store from '../../state/store.js';
import { parseScoutSearchQuery, removeScoutSearchToken } from './search-query.js';

let timer=null;
let activeQuery=null;
let installed=false;

const hasOperators=q=>q.tokens.some(t=>t.kind!=='unknown');
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const finishLabel=x=>x==='nonfoil'?'Normal':x==='foil'?'Foil':x==='etched'?'Etched':x;
const OPERATOR_OPTIONS=[
  {key:'s',label:'Set',hint:'s:CMR'},
  {key:'cn',label:'Collector #',hint:'cn:350'},
  {key:'f',label:'Finish',hint:'f:foil'}
];
const RANKED_FILTER_IDS=new Set(['cxParityGrade','cxParitySet','cxScoutMin','cxScoutMax','cxScoutSpread','cxScoutFoil','cxLiquidityFilter']);

function input(){return document.getElementById('cxParitySearch')}
function host(){
  const field=input();if(!field)return null;
  let h=document.getElementById('cxScoutPowerTokens');
  if(!h){h=document.createElement('div');h.id='cxScoutPowerTokens';h.className='cx-power-search-tokens';field.parentNode.insertBefore(h,field.nextSibling)}
  return h;
}
function suggestionHost(){
  const field=input();if(!field)return null;
  let h=document.getElementById('cxScoutPowerSuggest');
  if(!h){h=document.createElement('div');h.id='cxScoutPowerSuggest';h.className='cx-power-search-suggest';field.parentNode.insertBefore(h,host()?.nextSibling||field.nextSibling)}
  return h;
}
function clearSuggestions(){document.getElementById('cxScoutPowerSuggest')?.remove()}
function clearTokens(){document.getElementById('cxScoutPowerTokens')?.remove();clearSuggestions();activeQuery=null}
function renderTokens(query){
  const h=host();if(!h)return;
  const good=query.tokens.filter(t=>t.kind!=='unknown');
  const label=t=>t.kind==='set'?`Set: ${t.normalizedValue}`:t.kind==='collectorNumber'?`CN: ${t.normalizedValue}`:`Finish: ${finishLabel(t.normalizedValue)}`;
  h.innerHTML=`${good.map(t=>`<button type="button" class="cx-power-token" data-remove-token="${esc(t.raw)}">${esc(label(t))}<span aria-hidden="true">×</span></button>`).join('')}${query.unknownTokens.filter(t=>t.includes(':')&&t.split(':')[1]).map(t=>`<span class="cx-power-token cx-power-token-warn">Unknown: ${esc(t)}</span>`).join('')}`;
  h.querySelectorAll('[data-remove-token]').forEach(btn=>btn.addEventListener('click',()=>{
    const field=input();if(!field)return;
    field.value=removeScoutSearchToken(field.value,btn.dataset.removeToken);
    field.dispatchEvent(new Event('input',{bubbles:true}));
    field.focus();
  }));
}

function operatorDraft(raw){
  const trimmed=String(raw||'').replace(/\s+$/,'');
  const parts=trimmed.split(/\s+/).filter(Boolean);if(!parts.length)return null;
  const last=parts[parts.length-1],match=last.match(/^([a-zA-Z]*)(?::(.*))?$/);if(!match)return null;
  const key=String(match[1]||'').toLowerCase(),hasColon=last.includes(':');
  if(!key)return null;
  const options=OPERATOR_OPTIONS.filter(o=>o.key.startsWith(key)||o.label.toLowerCase().startsWith(key));
  if(!options.length)return null;
  if(!hasColon&&key.length>2&&!options.some(o=>o.key===key))return null;
  return {raw:last,key,hasColon,value:match[2]??'',options};
}
function nameTextForRaw(raw,query=parseScoutSearchQuery(raw)){
  const draft=operatorDraft(raw);
  if(!draft)return query.nameText;
  const parts=String(raw||'').trim().split(/\s+/);parts.pop();
  return parseScoutSearchQuery(parts.join(' ')).nameText;
}
function renderOperatorSuggestions(raw,query){
  const draft=operatorDraft(raw),name=nameTextForRaw(raw,query);
  const showStarter=Boolean(name||hasOperators(query))&&(String(raw).endsWith(' ')||draft);
  if(!showStarter){clearSuggestions();return}
  const options=draft?.options||OPERATOR_OPTIONS;
  const h=suggestionHost();if(!h)return;
  h.innerHTML=options.map(o=>`<button type="button" data-power-prefix="${o.key}:"><strong>${esc(o.label)}</strong><small>${esc(o.hint)}</small></button>`).join('');
  h.querySelectorAll('[data-power-prefix]').forEach(btn=>btn.addEventListener('click',()=>{
    const field=input();if(!field)return;
    const current=field.value.replace(/\s+$/,'');
    const d=operatorDraft(current);
    const parts=current.split(/\s+/).filter(Boolean);
    if(d)parts.pop();
    field.value=`${parts.join(' ')}${parts.length?' ':''}${btn.dataset.powerPrefix}`;
    clearSuggestions();
    field.dispatchEvent(new Event('input',{bubbles:true}));
    field.focus();
    field.setSelectionRange(field.value.length,field.value.length);
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
    const show=articleMatches(article,query);article.hidden=!show;article.style.display=show?'':'none';if(!show)continue;visible++;
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
  document.dispatchEvent(new CustomEvent('collectish:scout-power-search-rendered',{detail:{raw:query.raw,name:query.resolvedName||query.nameText,visible,total:articles.length,filters:query.filters}}));
}

function rankedListQuery(query){
  const {setCodes=[],collectorNumbers=[],finishes=[]}=query?.filters||{};
  if(query?.nameText||collectorNumbers.length||setCodes.length>1||finishes.length>1)return false;
  if(finishes.some(f=>f==='etched'))return false;
  return Boolean(setCodes.length||finishes.length);
}
function rankedSetName(code){
  const rows=store.get().scout?.rows||[];
  const found=rows.find(r=>String(r?.set_code||'').trim().toUpperCase()===String(code||'').trim().toUpperCase());
  return found?.set_name||'';
}
function restoreUrlPowerQuery(raw,{setValue='',foilValue=''}={}){
  const p=new URL(location.href).searchParams;
  p.set('tab','scout');
  if(String(raw||'').trim())p.set('q',raw);else p.delete('q');
  if(setValue)p.set('set',setValue);else p.delete('set');
  if(foilValue)p.set('foil',foilValue);else p.delete('foil');
  history.replaceState({collectish:true},'',`${location.pathname}?${p.toString()}${location.hash}`);
}
function runRankedList(raw,query=parseScoutSearchQuery(raw)){
  if(!rankedListQuery(query))return false;
  const renderer=window.CollectishScoutRenderer,field=input();
  if(!renderer?.applyFilters||!field)return false;
  window.CollectishScoutGlobalSearch?.clear?.();
  const setEl=document.getElementById('cxParitySet'),foilEl=document.getElementById('cxScoutFoil');
  const setValue=setEl?.value||'',foilValue=foilEl?.value||'',setCode=query.filters.setCodes[0]||'',finish=query.filters.finishes[0]||'';
  const setName=setCode?rankedSetName(setCode):'',noSetMatch=Boolean(setCode&&!setName);
  field.value=noSetMatch?'__collectish_power_query_no_match__':'';
  if(setEl&&setCode&&!noSetMatch)setEl.value=setName;
  if(foilEl&&finish)foilEl.value=finish==='foil'?'true':'false';
  renderer.applyFilters();
  field.value=raw;
  if(setEl)setEl.value=setValue;
  if(foilEl)foilEl.value=foilValue;
  restoreUrlPowerQuery(raw,{setValue,foilValue});
  activeQuery=query;renderTokens(query);renderOperatorSuggestions(raw,query);
  document.dispatchEvent(new CustomEvent('collectish:scout-power-list-rendered',{detail:{raw,filters:query.filters}}));
  return true;
}

async function run(raw,{force=false}={}){
  const query=parseScoutSearchQuery(raw);activeQuery=query;renderTokens(query);renderOperatorSuggestions(raw,query);
  if(!hasOperators(query))return false;
  if(rankedListQuery(query))return runRankedList(raw,query);
  const api=window.CollectishScoutGlobalSearch;if(!api?.loadCard)return false;
  let name=nameTextForRaw(raw,query);
  if(name)name=await exactName(name);else name=await nameFromSetCollector(query);
  if(!name){
    const p=document.getElementById('cxGlobalScoutSearch');
    if(force&&p){p.hidden=false;p.innerHTML='<div class="cx-empty">Add a card name, or use a set filter such as <b>s:HOB</b>, or set + collector number (for example <b>s:SLD cn:2812</b>).</div>'}
    return false;
  }
  query.resolvedName=name;activeQuery=query;
  await api.loadCard(name);
  const field=input();if(field)field.value=raw;
  renderTokens(query);renderOperatorSuggestions(raw,query);
  applyToRenderedResults(query);
  return true;
}

function ownsInput(raw,query){return hasOperators(query)||Boolean(operatorDraft(raw))}
function onInputCapture(e){
  if(e.target?.id!=='cxParitySearch')return;
  const raw=e.target.value,query=parseScoutSearchQuery(raw);
  if(!ownsInput(raw,query)){clearTokens();return}
  e.stopImmediatePropagation();activeQuery=query;renderTokens(query);renderOperatorSuggestions(raw,query);clearTimeout(timer);
  if(!hasOperators(query))return;
  const trimmed=raw.trim();if(trimmed.length<2)return;
  if(rankedListQuery(query)){timer=setTimeout(()=>{if(input()?.value===raw)runRankedList(raw,query)},80);return}
  timer=setTimeout(()=>{if(input()?.value===raw)run(raw)},260);
}
function onKeyCapture(e){
  if(e.target?.id!=='cxParitySearch')return;
  const raw=e.target.value,query=parseScoutSearchQuery(raw);if(!ownsInput(raw,query))return;
  if(e.key==='Escape'){clearSuggestions();return}
  if(e.key!=='Enter')return;e.preventDefault();e.stopImmediatePropagation();clearTimeout(timer);
  if(rankedListQuery(query))runRankedList(raw,query);else if(hasOperators(query))run(raw,{force:true});
}
function onRankedFilterCapture(e){
  if(!RANKED_FILTER_IDS.has(e.target?.id))return;
  const field=input();if(!field)return;
  const raw=field.value,query=parseScoutSearchQuery(raw);if(!rankedListQuery(query))return;
  e.stopImmediatePropagation();clearTimeout(timer);timer=setTimeout(()=>runRankedList(raw,query),0);
}
function onRendered(){if(activeQuery&&hasOperators(activeQuery)&&!rankedListQuery(activeQuery))applyToRenderedResults(activeQuery)}
function syncCurrentField(){
  const field=input();if(!field)return;
  const raw=field.value,query=parseScoutSearchQuery(raw);if(!hasOperators(query))return;
  activeQuery=query;renderTokens(query);renderOperatorSuggestions(raw,query);
  clearTimeout(timer);timer=setTimeout(()=>{if(input()?.value!==raw)return;if(rankedListQuery(query))runRankedList(raw,query);else run(raw)},0);
}

const style=document.createElement('style');
style.textContent=`.cx-power-search-tokens{display:flex;gap:6px;flex-wrap:wrap;margin:7px 0 0}.cx-power-token{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--cx-line);background:var(--cx-bg);color:var(--cx-text);border-radius:999px;padding:5px 8px;font-size:11px;font-weight:750}.cx-power-token span{font-size:14px;line-height:1}.cx-power-token-warn{border-color:#e0a11a;color:#8b5a00;background:#fff3d9}.cx-power-search-empty{margin-bottom:10px}.cx-global-print[hidden]{display:none!important}.cx-power-search-suggest{display:grid;position:absolute;z-index:45;left:0;right:0;margin-top:4px;background:var(--cx-card);border:1px solid var(--cx-line);border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.16);overflow:hidden}.cx-power-search-suggest button{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 11px;border:0;border-bottom:1px solid var(--cx-line);background:transparent;color:var(--cx-text);text-align:left}.cx-power-search-suggest button:last-child{border-bottom:0}.cx-power-search-suggest small{color:var(--cx-muted)}.cx-scout-toolbar{position:relative}`;
document.head.appendChild(style);

export function installScoutPowerSearch(){
  if(installed)return;installed=true;
  document.addEventListener('input',onInputCapture,true);
  document.addEventListener('keydown',onKeyCapture,true);
  document.addEventListener('input',onRankedFilterCapture,true);
  document.addEventListener('change',onRankedFilterCapture,true);
  document.addEventListener('collectish:scout-global-rendered',onRendered);
  document.addEventListener('collectish:scout-v5-ready',syncCurrentField);
  document.addEventListener('click',e=>{if(!e.target.closest?.('#cxScoutPowerSuggest,#cxParitySearch'))clearSuggestions()},true);
  const field=input();if(field)field.placeholder='Search cards · s:SLD cn:2812 f:foil';
  syncCurrentField();
}
installScoutPowerSearch();

window.CollectishScoutPowerSearch={parse:parseScoutSearchQuery,run,apply:()=>activeQuery&&(rankedListQuery(activeQuery)?runRankedList(activeQuery.raw,activeQuery):applyToRenderedResults(activeQuery))};
