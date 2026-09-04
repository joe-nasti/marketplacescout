import store from '../../state/store.js';
import { loadResource } from '../../state/resources.js';
import { rest } from '../../core/rest.js';
import { invokeFunction } from '../../core/functions.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
const pct=n=>n==null||!Number.isFinite(Number(n))?'—':`${Number(n).toFixed(1)}%`;
const human=s=>String(s||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
const age=d=>{if(!d)return'—';const ms=Math.max(0,Date.now()-new Date(d).getTime()),m=Math.round(ms/6e4);if(m<60)return m<=1?'just now':`${m}m ago`;const h=Math.round(m/60);return h<24?`${h}h ago`:`${Math.round(h/24)}d ago`};
const slug=s=>String(s||'').normalize('NFKD').replace(/[’']/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase();
const score=r=>{const f=familyEconomics(r);if(f?.practical_action==='MODEL PENDING')return null;const p=f?.practical_scout_score;return p==null?null:Number(p)};
const grade=r=>familyEconomics(r)?.practical_scout_grade||'—';
const acquisition=r=>r?.sealed_acquisition_price==null?null:Number(r.sealed_acquisition_price);
const marketSpread=r=>r?.market_spread==null?null:Number(r.market_spread);
const buylistBacked=r=>{const buy=Number(r?.cardkingdom_buylist_ev),acq=acquisition(r);return Number.isFinite(buy)&&buy>0&&Number.isFinite(acq)&&acq>0&&buy>acq};
const xval=(r,k)=>Number(r?.quantity||0)*Number(r?.[k]||0);
const setMap=()=>new Map(Object.entries(store.get().sealed?.setTypes||{}));
const setNames=()=>new Map(Object.entries(store.get().sealed?.setNames||{}));
let detailSeq=0;
let setTypesLoading=null;
const scrollByView=new Map();
const listEconomicsLoaded=new Set();
const listEconomicsPending=new Set();
const childPriceRefreshAttempted=new Set();

const familyEconomics=r=>store.get().sealed?.familyEconomics?.[String(r?.sealed_uuid)]||null;
const componentFloor=r=>{const f=familyEconomics(r),v=Number(f?.practical_liquidation_ev);return f?.practical_action==='MODEL PENDING'&&Number.isFinite(v)&&v>0&&String(f?.valuation_basis||'').includes('fixed')};
const modeledEv=r=>{const value=Number(familyEconomics(r)?.practical_liquidation_ev);return Number.isFinite(value)&&value>0?value:null};
const modeledSpread=r=>{if(componentFloor(r))return null;const ev=modeledEv(r),a=acquisition(r);return Number.isFinite(ev)&&Number.isFinite(a)?ev-a:null};
const sealedExitWins=f=>Number(f?.sealed_sale_child_count||0)>0&&Number(f?.child_exit_adjustment||0)>0;
const practicalLabel=(f,floor=false)=>floor?'Practical floor':sealedExitWins(f)?'Best Exit EV':'Practical EV';

function languageMeta(r){const s=r?.score_components||{};return{lang:s.sealed_language||'English',mode:s.language_pricing_mode||'',exact:Number(s.exact_language_coverage_pct||0),fallback:Number(s.english_fallback_coverage_pct||0),penalty:Number(s.language_confidence_penalty||0),raw:s.language_raw_score==null?null:Number(s.language_raw_score)}}
function languageClass(r){const m=languageMeta(r);if(m.mode==='english_equivalent_fallback'||m.fallback>0)return'fallback';if(m.lang.toLowerCase()!=='english'&&m.exact>0)return'nonenglish_exact';return'english_exact'}
function languageBadge(r){const m=languageMeta(r);if(m.lang==='English')return'';const short=m.lang==='Japanese'?'JP':m.lang.slice(0,2).toUpperCase();return `<span class="cx-sealed-badge cx-sealed-lang-badge risk">${short} · ${m.fallback>0?'fallback':'exact'}</span>`}
function languageNote(r){const m=languageMeta(r);if(m.lang==='English')return'';return `<div class="cx-sealed-language-note"><strong>${esc(m.lang)} sealed product</strong><span>${m.fallback>0?`Component EV uses English-equivalent pricing where exact ${esc(m.lang)} pricing is unavailable.`:`Component EV uses exact ${esc(m.lang)} pricing where available.`}</span><small>Exact ${esc(m.lang)} coverage ${m.exact.toFixed(0)}% · English fallback ${m.fallback.toFixed(0)}%${m.penalty?` · confidence −${m.penalty.toFixed(0)} pts`:''}${m.raw!=null?` · raw score ${m.raw.toFixed(1)}`:''}</small></div>`}
function badges(r){const out=[];if(r.lifecycle_status==='scout_sealed')out.push('<span class="cx-sealed-badge direct">SCOUT READY</span>');if(buylistBacked(r))out.push('<span class="cx-sealed-badge buylist">BUYLIST BACKED</span>');if(r.blocker)out.push(`<span class="cx-sealed-badge risk">${esc(human(r.blocker))}</span>`);else if(r.lifecycle_status==='ev_ready')out.push('<span class="cx-sealed-badge syp">EV READY</span>');out.push(languageBadge(r));return out.join('')}
function confidenceBadge(family){const label=family?.confidence_label;if(!label)return'';return `<span class="cx-sealed-badge ${label==='HIGH'?'buylist':label==='MEDIUM'?'direct':'risk'}">${esc(label)} CONFIDENCE</span>`}
function metric(label,value,sub='',cls=''){return `<div class="cx-sealed-metric ${cls}"><span>${esc(label)}</span><b>${value}</b>${sub?`<small>${esc(sub)}</small>`:''}</div>`}
function stat(label,value,sub='',url=''){const body=`<span>${esc(label)}</span><strong>${value}</strong>${sub?`<small>${esc(sub)}</small>`:''}`;return `<div class="cx-sealed-stat">${url?`<a class="cx-source-anchor" href="${esc(url)}" target="_blank" rel="noopener">${body}</a>`:body}</div>`}
function sortRows(a,b){const as=score(a),bs=score(b);if(as!=null&&bs!=null)return bs-as;if(as!=null)return-1;if(bs!=null)return 1;return Number(b.tcg_market_ev||0)-Number(a.tcg_market_ev||0)}
function selectedRow(){const s=store.get().sealed||{};return allProducts().find(r=>String(r.sealed_uuid)===String(s.selectedId))||null}

function setTypeOptions(){
  const s=store.get().sealed||{},rows=s.rows||[];
  return [...new Set(rows.map(r=>s.setTypes?.[String(r.set_code||'').toUpperCase()]).filter(Boolean))].sort();
}
function refreshSetTypeSurface(){
  const s=store.get().sealed||{},select=document.getElementById('cxSealedSetType');
  if(select){const value=s.filters?.setType||'';select.innerHTML=`<option value="">All Types</option>${setTypeOptions().map(x=>`<option value="${esc(x)}">${esc(human(x))}</option>`).join('')}`;select.value=value}
  renderRows();
  if(selectedRow())renderDetail(selectedRow()).catch(()=>{});
}
async function loadSetTypes(force=false){
  if(setTypesLoading&&!force)return setTypesLoading;
  setTypesLoading=loadResource('sealed.setTypes',()=>rest('magic_set_catalog?select=code,name,set_type,released_at&digital=eq.false'),{force,ttl:15*60*1000})
    .then(catalog=>{const types=Object.fromEntries((catalog||[]).map(x=>[String(x.code||'').toUpperCase(),x.set_type])),names=Object.fromEntries((catalog||[]).map(x=>[String(x.code||'').toUpperCase(),x.name]));store.update('sealed',{setTypes:types,setNames:names,setCatalog:catalog||[],setTypesLoadedAt:Date.now(),setTypesError:null});refreshSetTypeSurface();document.dispatchEvent(new CustomEvent('collectish:sealed-set-types-ready',{detail:{count:Object.keys(types).length}}));return types})
    .catch(error=>{store.update('sealed',{setTypesError:String(error?.message||error)});return store.get().sealed?.setTypes||{}})
    .finally(()=>{setTypesLoading=null});
  return setTypesLoading;
}
async function loadIndex(force=false){
  const [rows,products,practical,patterns]=await Promise.all([
    loadResource('sealed.rows',()=>rest('sealed_ev_current?select=*&order=scout_sealed_score.desc.nullslast,release_date.desc,product_name.asc&limit=5000'),{force,ttl:60000}),
    loadResource('sealed.catalogProducts',()=>rest('mtgjson_sealed_products?select=uuid,name,set_code,category,subtype,release_date,tcgplayer_product_id&order=release_date.desc.nullslast,name.asc&limit=5000'),{force,ttl:15*60*1000}),
    loadResource('sealed.practicalIndex',()=>rest('sealed_product_executable_ev_cache?select=sealed_uuid,tcg_low_ev,cash_floor_ev,optimistic_ev,ev_audit,practical_liquidation_ev,practical_scout_score,practical_scout_grade,practical_action,practical_model_version,valuation_basis,valuation_as_of,refreshed_at&order=practical_scout_score.desc.nullslast&limit=5000'),{force,ttl:60000}),
    loadResource('sealed.developingPatterns',()=>rest('sealed_product_developing_patterns_current?select=*&order=pattern_score.desc,observed_at.desc&limit=100'),{force,ttl:60000}).catch(()=>[])
  ]);
  const current=store.get().sealed||{},familyEconomics={...(current.familyEconomics||{})};
  (practical||[]).forEach(value=>{const id=String(value.sealed_uuid||'');if(id)familyEconomics[id]={...(familyEconomics[id]||{}),...value}});
  store.update('sealed',{familyEconomics});
  const sorted=(rows||[]).slice().sort(sortRows);
  store.update('sealed',{rows:sorted,catalogProducts:products||[],developingPatterns:patterns||[],selectedId:current.selectedId||null,loadedAt:Date.now()});
  await loadSetTypes(force);
  return sorted;
}

function allProducts(){
  const s=store.get().sealed||{},ev=new Map((s.rows||[]).map(r=>[String(r.sealed_uuid),r]));
  return (s.catalogProducts||[]).map(p=>({...p,...(ev.get(String(p.uuid))||{}),sealed_uuid:p.uuid,product_name:p.name,set_code:p.set_code,category:p.category,subtype:p.subtype,release_date:p.release_date,tcgplayer_product_id:p.tcgplayer_product_id}));
}
function familyFor(code,type,name){
  const hay=`${code||''} ${name||''}`.toLowerCase(),t=String(type||'').toLowerCase();
  if(hay.includes('secret lair')||String(code||'').toUpperCase()==='SLD')return'Secret Lair';
  if(t==='commander')return'Commander Decks';
  if(['expansion','core'].includes(t))return'Expansions';
  if(t==='masters'||/remaster|masters/.test(hay))return'Masters & Remastered';
  if(t==='starter')return'Starter Sets';
  if(['draft_innovation','funny','planechase','archenemy'].includes(t))return'Supplemental';
  return'Specialty & Other';
}
function setGroups(){
  const s=store.get().sealed||{},types=setMap(),names=setNames(),q=String(s.filters?.query||'').trim().toLowerCase(),bySet=new Map();
  for(const p of allProducts()){
    const code=String(p.set_code||'UNKNOWN').toUpperCase(),name=names.get(code)||code,hay=`${name} ${code} ${p.product_name||''} ${p.category||''} ${p.subtype||''}`.toLowerCase();
    if(q&&!hay.includes(q))continue;
    if(!bySet.has(code))bySet.set(code,[]);bySet.get(code).push(p);
  }
  const families=new Map();
  for(const [code,products] of bySet){const name=names.get(code)||code,type=types.get(code)||'',family=familyFor(code,type,name),best=products.map(score).filter(Number.isFinite).sort((a,b)=>b-a)[0]??null,opportunities=products.filter(r=>score(r)!=null&&score(r)>=70).length,release=products.map(x=>x.release_date).filter(Boolean).sort().at(-1)||'';if(!families.has(family))families.set(family,[]);families.get(family).push({code,name,type,products,best,opportunities,release})}
  const order=['Commander Decks','Expansions','Masters & Remastered','Supplemental','Starter Sets','Secret Lair','Specialty & Other'];
  return order.map(name=>[name,(families.get(name)||[]).sort((a,b)=>String(b.release).localeCompare(String(a.release))||a.name.localeCompare(b.name))]).filter(([,sets])=>sets.length);
}

function filteredRows(){
  const s=store.get().sealed||{},f=s.filters||{},types=setMap();
  return (s.rows||[]).filter(r=>{
    const st=types.get(String(r.set_code||'').toUpperCase())||'',hay=`${r.product_name||''} ${r.set_code||''} ${r.category||''} ${r.subtype||''} ${st}`.toLowerCase();
    if(f.query&&!hay.includes(String(f.query).toLowerCase()))return false;
    if(f.setType&&st!==f.setType)return false;
    if(f.buylistBacked&&!buylistBacked(r))return false;
    if(f.status==='graded'&&score(r)==null)return false;
    if(f.status==='scout'&&r.lifecycle_status!=='scout_sealed')return false;
    if(f.status==='evready'&&!['ev_ready','scout_sealed'].includes(r.lifecycle_status))return false;
    if(f.status==='blocked'&&!r.blocker)return false;
    const cls=languageClass(r),lang=f.language||'all';
    if(lang==='exclude_fallback'&&cls==='fallback')return false;
    if(['english_exact','nonenglish_exact','fallback'].includes(lang)&&cls!==lang)return false;
    return true;
  }).sort(sortRows);
}

function renderShell(){
  const h=document.getElementById('cxSealed');if(!h)return;
  const s=store.get().sealed||{},rows=s.rows||[],f=s.filters||{},types=setTypeOptions();
  const assessed=rows.length,graded=rows.filter(r=>score(r)!=null).length,sets=new Set(allProducts().map(r=>r.set_code).filter(Boolean)).size,last=rows.reduce((m,r)=>!m||new Date(r.refreshed_at)>new Date(m)?r.refreshed_at:m,null);
  h.innerHTML=`<div class="cx-page-head"><div><h2>Scout Sealed</h2><p>Browse every sealed family, then follow the value inside.</p><small class="cx-sub">${sets} sets · ${allProducts().length} products · ${graded} graded · refreshed ${esc(age(last))}</small></div><button class="cx-refresh" id="cxSealedRefresh">Refresh</button></div><nav class="cx-sealed-view-tabs" aria-label="Sealed views"><button type="button" data-sealed-view="sets">Sets</button><button type="button" data-sealed-view="patterns">Patterns</button><button type="button" data-sealed-view="opportunities">Opportunities</button></nav><div class="cx-sealed-toolbar cx-sealed-toolbar-compact"><input id="cxSealedSearch" value="${esc(f.query||'')}" placeholder="Search sets or sealed products…"><select id="cxSealedFilter" class="cx-sealed-filter-internal"><option value="">All assessed products</option><option value="graded">Graded only</option><option value="scout">Scout Sealed only</option><option value="evready">EV ready</option><option value="blocked">Blocked / pending</option></select><div class="cx-sealed-chip-bar"><select id="cxSealedSetType" class="cx-sealed-filter-chip"><option value="">All Types</option>${types.map(x=>`<option value="${esc(x)}">${esc(human(x))}</option>`).join('')}</select><select id="cxSealedLanguagePricing" class="cx-sealed-filter-chip"><option value="all">Language</option><option value="exclude_fallback">Exclude fallback pricing</option><option value="english_exact">English / exact-default only</option><option value="nonenglish_exact">Non-English exact-language only</option><option value="fallback">English fallback only</option></select><button type="button" id="cxSealedBuylistBacked" class="cx-sealed-filter-toggle ${f.buylistBacked?'active':''}" aria-pressed="${f.buylistBacked?'true':'false'}"><span aria-hidden="true">⚡</span><span>Buylist Backed</span></button></div><small id="cxSealedLanguageFilterCount" class="cx-sealed-filter-internal"></small></div><div class="cx-sealed-layout"><section><div id="cxSealedRows" class="cx-sealed-list"></div></section><aside id="cxSealedDetail" class="cx-card cx-sealed-detail"></aside></div>`;
  h.querySelector('#cxSealedFilter').value=f.status||'';h.querySelector('#cxSealedSetType').value=f.setType||'';h.querySelector('#cxSealedLanguagePricing').value=f.language||'all';
  h.querySelector('#cxSealedSearch').addEventListener('input',e=>updateFilters({query:e.target.value}));
  h.querySelector('#cxSealedFilter').addEventListener('change',e=>updateFilters({status:e.target.value}));
  h.querySelector('#cxSealedSetType').addEventListener('change',e=>updateFilters({setType:e.target.value}));
  h.querySelector('#cxSealedLanguagePricing').addEventListener('change',e=>updateFilters({language:e.target.value}));
  h.querySelector('#cxSealedBuylistBacked').addEventListener('click',()=>updateFilters({buylistBacked:!Boolean(store.get().sealed?.filters?.buylistBacked)}));
  h.querySelector('#cxSealedRefresh').addEventListener('click',()=>load(true));
  h.querySelector('.cx-sealed-view-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-sealed-view]');if(b)setView(b.dataset.sealedView)});
  h.querySelector('#cxSealedRows').addEventListener('click',e=>{const back=e.target.closest('[data-sealed-back]'),set=e.target.closest('[data-sealed-set]'),b=e.target.closest('[data-deck]');if(back)setView('sets');else if(set)openSet(set.dataset.sealedSet);else if(b)selectProduct(b.dataset.deck)});
  renderRows();
}

function updateFilters(patch){
  const s=store.get().sealed||{},filters={...(s.filters||{}),...patch};store.update('sealed',{filters});
  const buylist=document.getElementById('cxSealedBuylistBacked');if(buylist){buylist.setAttribute('aria-pressed',filters.buylistBacked?'true':'false');buylist.classList.toggle('active',Boolean(filters.buylistBacked))}
  renderRows();
}
function restoreScroll(key){const y=scrollByView.get(key);if(y==null)return;requestAnimationFrame(()=>requestAnimationFrame(()=>scrollTo({top:y,behavior:'auto'})))}
function viewKey(s=store.get().sealed||{}){return s.view==='set'?`set:${s.selectedSetCode||''}`:s.view||'sets'}
function setView(view){const s=store.get().sealed||{};scrollByView.set(viewKey(s),scrollY);store.update('sealed',{view,selectedSetCode:view==='set'?s.selectedSetCode:null,selectedId:null});renderRows();restoreScroll(viewKey())}
function openSet(code){const s=store.get().sealed||{};scrollByView.set(viewKey(s),scrollY);store.update('sealed',{view:'set',selectedSetCode:String(code||'').toUpperCase(),selectedId:null});renderRows();scrollTo({top:0,behavior:'auto'})}
function selectProduct(id){store.update('sealed',{selectedId:id});renderRows();renderDetail(selectedRow()).catch(()=>{})}

function renderSetDirectory(h){
  const groups=setGroups();
  if(!groups.length){h.innerHTML='<div class="cx-empty">No sealed sets match this search.</div>';return}
  h.className='cx-sealed-set-directory';
  h.innerHTML=groups.map(([family,sets])=>`<section class="cx-sealed-family-group"><header><h3>${esc(family)}</h3><span>${sets.length} set${sets.length===1?'':'s'}</span></header><div class="cx-sealed-set-list">${sets.map(set=>`<button type="button" class="cx-sealed-set-row" data-sealed-set="${esc(set.code)}"><span class="cx-sealed-set-symbol">${esc(set.code.slice(0,3))}</span><span class="cx-sealed-set-copy"><strong>${esc(set.name)}</strong><small>${esc(set.code)} · ${set.products.length} product${set.products.length===1?'':'s'}${set.release?` · ${esc(String(set.release).slice(0,4))}`:''}</small></span><span class="cx-sealed-set-signal">${set.best==null?'<small>Model pending</small>':`<b>${Math.round(set.best)}</b><small>${set.opportunities?`${set.opportunities} opportunit${set.opportunities===1?'y':'ies'}`:'best score'}</small>`}</span><span class="cx-sealed-chevron">›</span></button>`).join('')}</div></section>`).join('');
}
function renderSetProducts(h,code){
  const s=store.get().sealed||{},name=setNames().get(code)||code,products=allProducts().filter(r=>String(r.set_code||'').toUpperCase()===code).sort(sortRows);
  h.className='cx-sealed-list cx-sealed-set-products';
  h.innerHTML=`<div class="cx-sealed-set-head"><button type="button" data-sealed-back>‹ All sets</button><div><span>SEALED SET</span><h3>${esc(name)}</h3><small>${esc(code)} · ${products.length} products · sorted by opportunity</small></div></div><div class="cx-sealed-product-groups">${renderProductRows(products,s.selectedId)}</div>`;
  void loadListEconomics(products);
}
function renderProductRows(visible,selected){
  const types=setMap();
  return visible.map(r=>{const a=acquisition(r),sc=score(r),type=types.get(String(r.set_code||'').toUpperCase()),family=familyEconomics(r),floor=componentFloor(r),ev=modeledEv(r),spread=modeledSpread(r),roi=spread!=null&&a>0?100*spread/a:null,cash=Number(family?.cash_floor_ev),opt=Number(family?.optimistic_ev),range=Number.isFinite(cash)&&Number.isFinite(opt)?`${money(cash)}–${money(opt)} sensitivity`:family?.practical_action?human(family.practical_action):'liquidity + labor adjusted',evSub=floor?'known cards only · sample pack excluded':sealedExitWins(family)?`sell included packs sealed · crack practical ${money(family.base_practical_liquidation_ev)}`:range;return `<button type="button" class="cx-sealed-row ${String(r.sealed_uuid)===String(selected)?'selected':''}" data-deck="${esc(r.sealed_uuid)}"><div class="cx-sealed-name"><strong>${esc(r.product_name)}</strong><small>${esc(human(r.subtype||r.category||type||''))} · ${esc(r.release_date||'')}</small><div class="cx-sealed-badges">${sc==null?`<span class="cx-sealed-badge risk">${floor?'COMPONENT FLOOR':'MODEL PENDING'}</span>`:`<span class="cx-sealed-badge direct">${esc(grade(r))} · ${sc.toFixed(1)}</span>`}${confidenceBadge(family)}${badges(r)}</div></div>${metric('Sealed buy',money(a),human(r.lifecycle_status||'catalog only'))}${metric(practicalLabel(family,floor),money(ev),evSub)}${metric('TCG Low EV',money(family?.tcg_low_ev),'gross pull value','cx-sealed-hide-mobile')}${metric('Practical spread',spread==null?'—':money(spread),floor?'not scored until pack is modeled':roi==null?'':`${roi>=0?'+':''}${roi.toFixed(1)}%`,spread==null?'cx-sealed-pending':spread>=0?'cx-sealed-positive':'cx-sealed-negative')}</button>`}).join('');
}
function renderDevelopingPatterns(h){const rows=store.get().sealed?.developingPatterns||[];h.className='cx-sealed-list';if(!rows.length){h.innerHTML='<div class="cx-empty">Pattern baselines are being established. No developing collector-box patterns yet.</div>';renderDetail(null);return}h.innerHTML=`<div class="cx-sealed-set-head"><div><span>OBSERVATIONAL</span><h3>Developing patterns</h3><small>Ranked by price shape, listing compression, and demonstrated sales—not liquidation EV.</small></div></div>${rows.map(x=>{const e=x.evidence||{},transition=x.recently_transitioned?`${human(x.recent_from_state)} → ${human(x.recent_to_state)}`:x.previous_state?`Previously ${human(x.previous_state)}`:'Baseline established',compression=e.supply_compression_7d_pct==null?'—':`${Number(e.supply_compression_7d_pct)>=0?'+':''}${Number(e.supply_compression_7d_pct).toFixed(1)}%`;return `<button type="button" class="cx-sealed-row" data-deck="${esc(x.sealed_uuid)}"><div class="cx-sealed-name"><strong>${esc(x.product_name)}</strong><small>${esc(x.set_code||'')} · ${esc(x.release_date||'')}</small><div class="cx-sealed-badges"><span class="cx-sealed-badge direct">${esc(x.lifecycle_state)}</span><span class="cx-sealed-badge risk">${esc(x.trajectory_action)}</span></div></div>${metric('Pattern score',Number(x.pattern_score||0).toFixed(1),transition)}${metric('Listings',e.total_listings==null?'—':Number(e.total_listings).toLocaleString(),`${compression} compression / 7d`)}${metric('Sales',Number(e.units_30d||0).toLocaleString(),`units / 30d`)}${metric('30d move',e.change_30d_pct==null?'—':`${Number(e.change_30d_pct)>=0?'+':''}${Number(e.change_30d_pct).toFixed(1)}%`,'TCG Market trajectory','cx-sealed-hide-mobile')}</button>`}).join('')}`;renderDetail(selectedRow()).catch(()=>{})}

async function executableEconomics(ids){
  const out=[];
  for(let i=0;i<ids.length;i+=75){
    const part=ids.slice(i,i+75).join(',');
    const [cache,support,resale,optimized]=await Promise.all([rest(`sealed_product_executable_ev_cache?select=sealed_uuid,tcg_low_ev,direct_first_net_ev,collectish_live_out_ev,cash_floor_ev,optimistic_ev,ev_audit,practical_liquidation_ev,practical_median_estimate,practical_p10_estimate,top10_practical_ev_share_pct,top1_practical_ev_share_pct,practical_scout_score,practical_scout_grade,practical_action,practical_model_version,distribution_estimate_basis,fixed_tcg_low_ev,fixed_collectish_live_out_ev,modeled_child_units,price_coverage_pct,valuation_basis,model_key,model_version,valuation_as_of,refreshed_at&sealed_uuid=in.(${part})`),rest(`sealed_product_decision_support_current?select=*&sealed_uuid=in.(${part})`),rest(`sealed_child_resale_fallback_current?select=sealed_uuid,tcg_low_ev,practical_liquidation_ev,valuation_basis,total_listings,valuation_as_of,valuation_policy&sealed_uuid=in.(${part})`),rest(`sealed_product_exit_optimized_current?select=sealed_uuid,base_practical_liquidation_ev,exit_optimized_practical_ev,child_exit_adjustment,selected_child_exit_ev,crack_child_count,sealed_sale_child_count,fixed_child_count,unresolved_child_count,optimization_policy&sealed_uuid=in.(${part})`)]),supportById=new Map((support||[]).map(x=>[String(x.sealed_uuid),x])),cacheById=new Map((cache||[]).map(x=>[String(x.sealed_uuid),x])),resaleById=new Map((resale||[]).map(x=>[String(x.sealed_uuid),x])),optimizedById=new Map((optimized||[]).map(x=>[String(x.sealed_uuid),x]));
    for(const id of ids.slice(i,i+75)){const value=cacheById.get(String(id))||resaleById.get(String(id)),opt=optimizedById.get(String(id));if(value)out.push({...value,...supportById.get(String(id)),...opt,...(opt?.exit_optimized_practical_ev!=null?{practical_liquidation_ev:opt.exit_optimized_practical_ev}: {})})}
  }
  return out;
}

async function loadListEconomics(products){
  const ids=[...new Set((products||[]).map(r=>String(r.sealed_uuid||'')).filter(Boolean))].filter(id=>!listEconomicsLoaded.has(id)&&!listEconomicsPending.has(id));
  if(!ids.length)return;
  ids.forEach(id=>listEconomicsPending.add(id));
  try{
    const [legacy,executable]=await Promise.all([(async()=>{const values=[];for(let i=0;i<ids.length;i+=75)values.push(...await rest('rpc/get_sealed_family_economics_fast',{method:'POST',body:{p_sealed_uuids:ids.slice(i,i+75)}}));return values})(),executableEconomics(ids)]),execById=new Map(executable.map(x=>[String(x.sealed_uuid),x]));
    const values=legacy.map(value=>({...value,...execById.get(String(value.sealed_uuid))}));
    const current=store.get().sealed||{},next={...(current.familyEconomics||{})};
    values.forEach(value=>{next[String(value.sealed_uuid)]=value});
    ids.forEach(id=>listEconomicsLoaded.add(id));
    store.update('sealed',{familyEconomics:next});
    const h=document.getElementById('cxSealedRows'),s=store.get().sealed||{};
    if(h&&s.view==='set')renderSetProducts(h,String(s.selectedSetCode||'').toUpperCase());
    else if(h&&s.view==='opportunities')h.innerHTML=renderProductRows(filteredRows(),String(s.selectedId||''));
  }catch(error){console.warn('[sealed list economics]',error)}
  finally{ids.forEach(id=>listEconomicsPending.delete(id))}
}

function renderRows(){
  const h=document.getElementById('cxSealedRows');if(!h)return;
  const s=store.get().sealed||{},view=s.view||'sets';
  document.querySelectorAll('[data-sealed-view]').forEach(b=>b.classList.toggle('active',b.dataset.sealedView===(view==='set'?'sets':view)));
  document.querySelector('.cx-sealed-chip-bar')?.toggleAttribute('hidden',view!=='opportunities');
  if(view==='sets'){renderSetDirectory(h);renderDetail(null);return}
  if(view==='set'){renderSetProducts(h,String(s.selectedSetCode||'').toUpperCase());renderDetail(selectedRow()).catch(()=>{});return}
  if(view==='patterns'){renderDevelopingPatterns(h);return}
  const visible=filteredRows();h.className='cx-sealed-list';
  if(!visible.some(r=>String(r.sealed_uuid)===String(s.selectedId)))store.update('sealed',{selectedId:null});
  const selected=String(store.get().sealed?.selectedId||'');
  const count=document.getElementById('cxSealedLanguageFilterCount');if(count){const hidden=(s.rows||[]).length-visible.length;count.textContent=(s.filters?.language||'all')==='all'?'':`${visible.length} shown · ${hidden} hidden`}
  if(!visible.length){h.innerHTML='<div class="cx-empty">No sealed products match these filters.</div>';renderDetail(null);return}
  h.innerHTML=renderProductRows(visible,selected);
  void loadListEconomics(visible);
  renderDetail(selectedRow()).catch(()=>{});
  document.dispatchEvent(new CustomEvent('collectish:sealed-rendered',{detail:{visible:visible.length,selectedId:selected}}));
}

function scoutUrl(c){const u=new URL(location.href);for(const k of ['sealed','sealedView','q','status','settype','set','lang','buylist_backed'])u.searchParams.delete(k);u.searchParams.set('tab','scout');if(c?.sku_id)u.searchParams.set('sku',c.sku_id);else{u.searchParams.set('card',c?.card_name||'');u.searchParams.set('set',c?.set_code||'');u.searchParams.set('finish',c?.finish||'')}return `${u.pathname}?${u.searchParams.toString()}${u.hash}`}
function sourceUrls(c){const n=slug(c?.card_name),set=String(c?.set_code||'').toLowerCase(),cn=encodeURIComponent(c?.collector_number||'');return{scout:scoutUrl(c),tcg:c?.product_id?`https://www.tcgplayer.com/product/${encodeURIComponent(c.product_id)}?Printing=${String(c.finish||'').toLowerCase()==='foil'?'Foil':'Normal'}&Condition=Near+Mint&Language=English&page=1`:'',direct:c?.product_id?`https://www.tcgplayer.com/product/${encodeURIComponent(c.product_id)}?Printing=${String(c.finish||'').toLowerCase()==='foil'?'Foil':'Normal'}&Condition=Near+Mint&Language=English&direct=true&page=1`:'',scry:set&&cn?`https://scryfall.com/card/${encodeURIComponent(set)}/${cn}`:'',ck:c?.card_name?`https://www.cardkingdom.com/catalog/search?search=header&filter%5Bname%5D=${encodeURIComponent(c.card_name)}&filter%5Btab%5D=mtg_card`:'',ckBuy:c?.card_name?`https://www.cardkingdom.com/purchasing/mtg_singles?search=header&filter%5Bname%5D=${encodeURIComponent(c.card_name)}`:'',mana:n?(set&&cn?`https://manapool.com/card/${encodeURIComponent(set)}/${cn}/${n}`:`https://manapool.com/card/${n}`):'',mkm:c?.card_name?`https://www.cardmarket.com/en/Magic/Cards/${n}`:''}}
function anchor(value,url){return url&&value!=='—'?`<a class="cx-source-anchor" href="${esc(url)}" target="_blank" rel="noopener">${value}</a>`:value}
function scoutAnchor(value,url){return url?`<a class="cx-source-anchor cx-scout-internal-link" href="${esc(url)}">${value}</a>`:value}
function totals(cards){const ks=['tcg_low','tcg_low_with_shipping','tcg_market','cardkingdom_retail','manapool_retail','cardmarket_retail','cardkingdom_buylist','tcg_direct_net'];return Object.fromEntries(ks.map(k=>[k,cards.reduce((n,c)=>n+xval(c,k),0)]))}
function bestClasses(c){const retail=[c.tcg_low,c.tcg_low_with_shipping,c.cardkingdom_retail,c.manapool_retail,c.cardmarket_retail].map(Number).filter(x=>x>0),exit=[c.cardkingdom_buylist,c.tcg_direct_net].map(Number).filter(x=>x>0);return{retail:retail.length?Math.min(...retail):null,exit:exit.length?Math.max(...exit):null}}
function cell(value,url,cls=''){return `<td class="${cls}">${anchor(money(value),url)}</td>`}
function econTable(cards){
  if(!cards.length)return'<div class="cx-empty">No deterministic card components for this product.</div>';
  const t=totals(cards);
  return `<div class="cx-econ-legend"><span class="retail">RETAIL / ACQUIRE</span><span class="reference">TCGM = MARKET REF</span><span class="exit">EXIT / SELL</span></div><div class="cx-sealed-econ-wrap" data-no-detail-swipe><table class="cx-sealed-econ"><thead><tr><th class="sticky-name">Card</th><th>Qty</th><th>Finish</th><th>TCGL</th><th>L+S</th><th>TCGM</th><th>CKR</th><th>MP</th><th>MKM</th><th>CKBL</th><th>TCGD</th></tr></thead><tbody>${cards.map(c=>{const u=sourceUrls(c),b=bestClasses(c),rc=v=>Number(v)>0&&Math.abs(Number(v)-b.retail)<.005?'cx-econ-best-retail':'',xc=v=>Number(v)>0&&Math.abs(Number(v)-b.exit)<.005?'exit cx-econ-best-exit':'exit';return `<tr><td class="sticky-name">${scoutAnchor(`<strong>${esc(c.card_name)}</strong><small>${esc(c.set_code||'')} #${esc(c.collector_number||'—')}<span class="cx-econ-mobile-meta"> · ×${Number(c.quantity||0).toLocaleString()} · ${esc(human(c.finish||''))}</span></small>`,u.scout)}</td><td>${Number(c.quantity||0).toLocaleString()}</td><td>${esc(human(c.finish||''))}</td>${cell(c.tcg_low,u.tcg,rc(c.tcg_low))}${cell(c.tcg_low_with_shipping,u.tcg,rc(c.tcg_low_with_shipping))}${cell(c.tcg_market,u.tcg)}${cell(c.cardkingdom_retail,u.ck,rc(c.cardkingdom_retail))}${cell(c.manapool_retail,u.mana,rc(c.manapool_retail))}${cell(c.cardmarket_retail,u.mkm,rc(c.cardmarket_retail))}${cell(c.cardkingdom_buylist,u.ckBuy,xc(c.cardkingdom_buylist))}${cell(c.tcg_direct_net,u.direct,xc(c.tcg_direct_net))}</tr>`}).join('')}</tbody><tfoot><tr><th class="sticky-name">Fixed-card totals</th><th></th><th></th><th>${money(t.tcg_low)}</th><th>${money(t.tcg_low_with_shipping)}</th><th>${money(t.tcg_market)}</th><th>${money(t.cardkingdom_retail)}</th><th>${money(t.manapool_retail)}</th><th>${money(t.cardmarket_retail)}</th><th class="exit">${money(t.cardkingdom_buylist)}</th><th class="exit">${money(t.tcg_direct_net)}</th></tr></tfoot></table></div><div class="cx-sealed-econ-note">Prices are per card; fixed-card totals multiply each price by quantity. TCGD is modeled Direct net from exact-SKU Direct Low × 80%.</div>`}

function componentSummary(children,family){if(!children.length)return'';const floor=family?.practical_action==='MODEL PENDING'&&Number(family?.practical_liquidation_ev)>0,total=Number(family?.practical_liquidation_ev||0),lowTotal=Number(family?.tcg_low_ev||0),fixed=Number(family?.fixed_collectish_live_out_ev||0),boosterLow=children.reduce((n,c)=>n+Number(c.quantity||0)*Number(c.tcg_low_ev||0),0),boosterNet=children.reduce((n,c)=>n+Number(c.quantity||0)*Number(c.practical_liquidation_ev||0),0);return `<section class="cx-sealed-component-summary"><div class="cx-section-title">Included sealed products</div><div class="cx-sealed-child-econ-head"><span>Product</span><span>Qty</span><span>TCG Low / unit</span><span>TCG Low EV</span><span>Selected exit net</span></div>${children.map(c=>{const qty=Number(c.quantity||0),low=Number(c.tcg_low_ev||0),childNet=Number(c.practical_liquidation_ev||0),route=c.selected_exit_route==='sell_sealed'?'Sell sealed':c.selected_exit_route==='crack'?'Crack':String(c.valuation_basis||'').includes('fixed')?'Cards already routed':'Unresolved';return `<div class="cx-sealed-component-row"><strong>${esc(c.child_product_name)}</strong><span data-mobile-label="Qty">${qty.toLocaleString()}</span><span>${money(low)}</span><span>${money(qty*low)}</span><span data-mobile-label="Selected exit net">${esc(route)} · ${money(qty*childNet)}</span></div>`}).join('')}<div class="cx-sealed-component-rollup"><span><small>Included packs · TCG Low</small><b>${money(boosterLow)}</b></span><span><small>Fixed-card live-out EV</small><b>${money(fixed)}</b></span><span class="total"><small>${floor?'Known-card practical floor':sealedExitWins(family)?'Best product exit EV':'Total practical EV'}</small><b>${money(total)}</b></span><span><small>Included products · selected exit</small><b>${floor?'Excluded':money(boosterNet)}</b></span><span><small>Total TCG Low EV</small><b>${money(lowTotal)}</b></span></div><div class="cx-sealed-econ-note">${floor?'The practical floor values only the known deck cards. The unmodeled sample pack is excluded and this product is not scored.':'Practical EV means crack/open net after fees, liquidity, and labor. Best Exit EV may instead sell an included sealed product when that produces more net; only one route is counted.'}</div></section>`}

function evAuditSummary(family){const a=family?.ev_audit;if(!a)return'';const routes=Object.entries(a.practical_route_units||{}).filter(([,v])=>Number(v)>0).sort((x,y)=>Number(y[1])-Number(x[1])).map(([k,v])=>`${k}: ${Number(v).toLocaleString(undefined,{maximumFractionDigits:2})}`).join(' · ');return `<section class="cx-sealed-component-summary"><div class="cx-section-title">EV audit</div><div class="cx-sealed-grid">${stat('TCG priced coverage',pct(a.tcg_price_coverage_pct),`${Number(a.tcg_priced_units||0).toLocaleString()} of ${Number(a.expected_card_units||0).toLocaleString()} expected card units`)}${stat('Excluded at $0',Number(a.excluded_zero_value_units||0).toLocaleString(),'units below executable thresholds or without an exit')}${stat('Marketplace fees',money(a.marketplace_fee_deduction),'deducted before practical EV')}${stat('Liquidity + labor',money(a.liquidity_labor_deduction),'additional practical haircut')}${stat('Stale route units',Number(a.stale_route_units||0).toLocaleString(),`older than ${Number(a.stale_after_days||3)} days`)}</div><div class="cx-sealed-econ-note"><strong>Practical route mix:</strong> ${esc(routes||'No executable routes')}. TCG Market, SYP, and last-known Direct prices are excluded.</div></section>`}
function distributionSummary(family){if(!family?.confidence_label)return'';const e=family.confidence_evidence||{},chance=family.gross_break_even_probability==null?'—':pct(Number(family.gross_break_even_probability)*100);return `<section class="cx-sealed-component-summary"><div class="cx-section-title">Risk & confidence</div><div class="cx-sealed-grid">${stat('EV confidence',`${esc(family.confidence_label)} · ${Number(family.confidence_score||0).toFixed(0)}/100`,`${e.collation||'model'} · ${e.distribution||'distribution unavailable'}`)}${stat('Practical P10',money(family.practical_p10_estimate),'downside opening')}${stat('Practical median',money(family.practical_median_estimate),'typical modeled opening')}${stat('Practical P90',money(family.practical_p90_estimate),'upside opening')}${stat('Gross break-even chance',chance,'simulation reference price; before executable-route haircuts')}${stat('15% ROI max buy',money(family.max_buy_for_15pct_roi),'based on mean Practical EV')}${stat('Downside buy ceiling',money(family.downside_break_even_buy),'price covered by modeled P10')}</div><div class="cx-sealed-econ-note">${esc(family.distribution_caveat||'Confidence reflects model, price, freshness, and simulation evidence.')}</div></section>`}
function calibrationFactor(rows,day,field='median_change_pct'){
  const points=[{day:0,factor:1},...rows.map(x=>({day:Number(x.horizon_days),factor:Math.max(.05,1+Number(x[field]||0)/100)})).filter(x=>x.day>0).sort((a,b)=>a.day-b.day)];
  if(day<=0)return 1;if(day>=points.at(-1).day)return points.at(-1).factor;
  const hi=points.findIndex(x=>x.day>=day),a=points[hi-1],b=points[hi],t=(day-a.day)/(b.day-a.day);
  return Math.exp(Math.log(a.factor)+(Math.log(b.factor)-Math.log(a.factor))*t);
}
function calibratedReleaseSummary(ageDays,ev,rows,similarity=[]){
  const primary=similarity.filter(x=>x.forecast_status==='READY'&&x.promotion_status==='PRIMARY'&&Number(x.analog_count)>=3).sort((a,b)=>Number(a.horizon_days)-Number(b.horizon_days));
  const pooled=rows.filter(x=>x.calibration_status==='READY'&&Number(x.cohort_count)>=3).sort((a,b)=>Number(a.horizon_days)-Number(b.horizon_days));
  const ready=primary.length?primary:pooled;
  if(!ready.length)return'';
  const currentMedian=calibrationFactor(ready,ageDays),cards=ready.filter(x=>Number(x.horizon_days)>ageDays).map(x=>{
    const day=Number(x.horizon_days),median=ev*calibrationFactor(ready,day)/currentMedian;
    const down=ev*calibrationFactor(ready,day,'downside_change_pct')/currentMedian;
    const up=ev*calibrationFactor(ready,day,'upside_change_pct')/currentMedian;
    const lo=Math.min(down,median,up),hi=Math.max(down,median,up),change=Number(x.median_change_pct),confidence=String(x.confidence_label||'LOW'),count=Number(primary.length?x.analog_count:x.cohort_count),basis=primary.length?'similar products':'cohorts';
    return stat(`${day}d calibrated EV`,money(median),`${money(lo)}–${money(hi)} historical range · ${money(median/1.15)} max buy · ${change>=0?'+':''}${change.toFixed(1)}% since release · ${count} ${basis} / ${confidence}`);
  }).join('');
  if(!cards)return'';
  return `<section class="cx-sealed-component-summary"><div class="cx-section-title">Calibrated release trajectory</div><div class="cx-sealed-grid">${cards}</div><div class="cx-sealed-econ-note">Projection applies the remaining portion of the ${primary.length?'validated similarity-weighted':'pooled'} Play Booster curve to current Practical EV. TCGCSV Market baskets supply historical shape only; executable value remains Direct-first / TCG Low fallback after fees, liquidity, and labor. The trajectory does not change the Scout grade.</div></section>`;
}
function similarityReleaseSummary(ageDays,ev,rows=[]){
  const ready=rows.filter(x=>x.forecast_status==='READY'&&Number(x.analog_count)>=3).sort((a,b)=>Number(a.horizon_days)-Number(b.horizon_days));
  if(!ready.length)return'';
  const current=calibrationFactor(ready,ageDays),cards=ready.filter(x=>Number(x.horizon_days)>ageDays).map(x=>{
    const day=Number(x.horizon_days),median=ev*calibrationFactor(ready,day)/current,down=ev*calibrationFactor(ready,day,'downside_change_pct')/current,up=ev*calibrationFactor(ready,day,'upside_change_pct')/current,lo=Math.min(down,median,up),hi=Math.max(down,median,up),pooled=Number(x.pooled_change_pct),analogs=(Array.isArray(x.analogs)?x.analogs:[]).slice(0,3).map(a=>`${a.set_code} ${Number(a.similarity_score||0).toFixed(0)}% / ${Number(a.change_pct)>=0?'+':''}${Number(a.change_pct||0).toFixed(1)}%`).join(' · ');
    return stat(`${day}d similarity forecast`,money(median),`${money(lo)}–${money(hi)} weighted range · pooled ${Number.isFinite(pooled)?`${pooled>=0?'+':''}${pooled.toFixed(1)}%`:'—'} · ${analogs||'analogs unavailable'}`);
  }).join(''),sample=Math.min(...ready.map(x=>Number(x.backtest_samples||0))),mae=ready.find(x=>Number.isFinite(Number(x.median_absolute_error_pct)))?.median_absolute_error_pct,pooledMae=ready.find(x=>Number.isFinite(Number(x.pooled_median_absolute_error_pct)))?.pooled_median_absolute_error_pct,primary=ready.every(x=>x.promotion_status==='PRIMARY');
  if(!cards)return'';
  const gate=primary?'Similarity weighting passed its promotion gate and supplies the primary calibrated curve.':`Shadow model: pooled trajectory remains primary until at least five leakage-safe backtests show no worse median error. Current minimum ${sample} tests${mae==null?'':` · weighted ${Number(mae).toFixed(1)}pp vs pooled ${Number(pooledMae).toFixed(1)}pp`}.`;
  return `<section class="cx-sealed-component-summary"><div class="cx-section-title">Closest Play Booster analogs</div><div class="cx-sealed-grid">${cards}</div><div class="cx-sealed-econ-note">${esc(gate)} Similarity uses release-time basket tier, priced-card count, chase concentration, variant density, price-point mix, set type, and release cadence. No future outcome is available to an earlier backtest.</div></section>`;
}
function releaseStressSummary(row,family,calibration=[],similarity=[]){
  const released=new Date(`${row?.release_date||''}T00:00:00Z`),ageDays=Number.isFinite(released.getTime())?Math.max(0,Math.floor((Date.now()-released.getTime())/86400000)):null,randomized=String(family?.valuation_basis||'').includes('randomized'),ev=Number(family?.practical_liquidation_ev);
  if(!randomized||!Number.isFinite(ev)||ev<=0||ageDays==null||ageDays>90)return'';
  const calibrated=calibratedReleaseSummary(ageDays,ev,calibration,similarity);if(calibrated)return `${calibrated}${similarityReleaseSummary(ageDays,ev,similarity)}`;
  const stress=p=>money(ev*(1-p)),maxBuy=p=>money(ev*(1-p)/1.15),phase=ageDays<30?'EARLY SUPPLY':ageDays<60?'PRICE DISCOVERY':'MATURING';
  return `<section class="cx-sealed-component-summary"><div class="cx-section-title">Release-price stress</div><div class="cx-sealed-grid">${stat('Release phase',phase,`${ageDays} days since release`)}${stat('20% compression',stress(.20),`${maxBuy(.20)} max buy for 15% ROI`)}${stat('35% compression',stress(.35),`${maxBuy(.35)} max buy for 15% ROI`)}${stat('50% compression',stress(.50),`${maxBuy(.50)} max buy for 15% ROI`)}</div><div class="cx-sealed-econ-note">Stress scenarios reduce current Practical EV to show supply-expansion risk. They are not forecasts and do not change the Scout grade. A calibrated stabilized EV remains gated until card-level history contains enough 30/60/90-day release cohorts.</div></section>`;
}
function lifecycleSummary(x){if(!x)return'';const e=x.lifecycle_evidence||{},move=n=>n==null?'—':`${Number(n)>=0?'+':''}${Number(n).toFixed(1)}%`,supply=[e.supply_compression_7d_pct==null?'—':`${move(e.supply_compression_7d_pct)} / 7d`,e.supply_compression_30d_pct==null?'—':`${move(e.supply_compression_30d_pct)} / 30d`].join(' · ');return `<section class="cx-sealed-component-summary"><div class="cx-section-title">Collector-box lifecycle</div><div class="cx-sealed-grid">${stat('Pattern',esc(x.lifecycle_state||'MIXED'),`${Number(x.history_days||0)} price-history days · ${Number(x.observation_count||0)} observations`)}${stat('Trajectory action',esc(x.trajectory_action||'OBSERVE'),`${esc(x.calibration_confidence||'LOW')} calibration · ${Number(x.calibration_samples||0)} tests`)}${stat('30d / 90d move',`${move(e.change_30d_pct)} / ${move(e.change_90d_pct)}`,'TCG Market trajectory only')}${stat('Sales demand',`${Number(e.units_30d||0).toLocaleString()} / 30d`,`${Number(e.units_90d||0).toLocaleString()} units / 90d`)}${stat('Listing compression',supply,`${esc(e.supply_trend_confidence||'LOW')} supply confidence · ${Number(e.supply_observation_days||0)} observed days`)}${stat('Current supply',e.total_listings==null?'—':Number(e.total_listings).toLocaleString(),`${e.listings_7d_prior==null?'—':Number(e.listings_7d_prior).toLocaleString()} 7d prior · ${e.listings_30d_prior==null?'—':Number(e.listings_30d_prior).toLocaleString()} 30d prior`)}${stat('Range position',`${move(e.above_history_low_pct)} above low`,`${move(e.below_history_high_pct)} below high`)}</div><div class="cx-sealed-econ-note">${esc(x.action_caveat||'Observed pattern only.')} Supply squeeze requires declining listings plus demonstrated sales. TCG Market is never used as liquidation EV.</div></section>`}
function transitionSummary(rows){if(!rows?.length)return'<section class="cx-sealed-component-summary"><div class="cx-section-title">Lifecycle history</div><div class="cx-sealed-econ-note">Baseline established. Future state changes will appear here and mature into measured 30/90-day outcomes; no synthetic transitions are backfilled.</div></section>';return `<section class="cx-sealed-component-summary"><div class="cx-section-title">Lifecycle history</div>${rows.map(x=>{const move=n=>n==null?'—':`${Number(n)>=0?'+':''}${Number(n).toFixed(1)}%`,result=x.direction_correct_90d==null?(x.direction_correct_30d==null?'maturing':`${x.direction_correct_30d?'matched':'missed'} at 30d`):`${x.direction_correct_90d?'matched':'missed'} at 90d`;return `<div class="cx-sealed-component-row"><strong>${esc(human(x.from_state))} → ${esc(human(x.to_state))}</strong><span>${esc(String(x.observed_at||'').slice(0,10))}</span><span>${esc(x.outcome_status)}</span><span>${move(x.return_30d_pct)} / 30d</span><span>${move(x.return_90d_pct)} / 90d · ${esc(result)}</span></div>`}).join('')}<div class="cx-sealed-econ-note">Real observed transitions only. Outcome prices use TCG Market for trajectory measurement—not liquidation EV—and never alter Scout action until separately calibrated.</div></section>`}
function analogSummary(rows,backtest){if(!rows?.length)return'';const n=Number(backtest?.sample_count||0),calibration=n>0?`Walk-forward calibration: ${n.toLocaleString()} checkpoints · ${Number(backtest.direction_accuracy_pct||0).toFixed(1)}% direction hit · ${Number(backtest.median_absolute_error_pct||0).toFixed(1)}pp median error.`:'Walk-forward calibration is waiting for enough historical checkpoints and 90-day outcomes.';return `<section class="cx-sealed-component-summary"><div class="cx-section-title">Demand-pattern analogs</div>${rows.map(x=>`<div class="cx-sealed-component-row"><strong>${esc(x.analog_product_name)}</strong><span>${esc(x.analog_set_code||'')}</span><span>${Number(x.similarity_score||0).toFixed(0)}% match</span><span>${money(x.analog_market_price)}</span><span>${x.analog_change_90d_pct==null?'—':`${Number(x.analog_change_90d_pct)>=0?'+':''}${Number(x.analog_change_90d_pct).toFixed(1)}% / 90d`}</span></div>`).join('')}<div class="cx-sealed-econ-note">${esc(calibration)} Matches use only information available at each checkpoint. TCG Market is trajectory evidence—not liquidation EV—and analogs remain descriptive until calibration earns confidence.</div></section>`}
function collectorForecastSummary(rows=[]){
  const ready=rows.filter(x=>x.forecast_status==='READY').sort((a,b)=>Number(a.horizon_days)-Number(b.horizon_days));if(!ready.length)return'';
  const first=ready[0],stage=human(first.lifecycle_stage||'MIXED'),ageDays=Number(first.lifecycle_age_days),features=first.target_features||{},move=n=>n==null?'—':`${Number(n)>=0?'+':''}${Number(n).toFixed(1)}%`;
  const cards=ready.map(x=>{const primary=x.promotion_status==='PRIMARY',pooled=Number(x.pooled_return_pct),weighted=Number(x.median_return_pct),selected=primary||!Number.isFinite(pooled)?weighted:pooled,current=Number(x.current_market_price),projected=Number.isFinite(current)&&Number.isFinite(selected)?current*(1+selected/100):null,lo=Math.min(Number(x.downside_return_pct),Number(x.upside_return_pct)),hi=Math.max(Number(x.downside_return_pct),Number(x.upside_return_pct)),analogs=(Array.isArray(x.analogs)?x.analogs:[]).slice(0,3).map(a=>`${a.set_code} age ${Number(a.age_days)}d · ${Number(a.similarity_score).toFixed(0)}% · ${move(a.return_pct)}`).join(' · '),tests=Number(x.backtest_samples||0),products=Number(x.backtest_products||0),mae=x.median_absolute_error_pct==null?'—':`${Number(x.median_absolute_error_pct).toFixed(1)}pp`,pooledMae=x.pooled_median_absolute_error_pct==null?'—':`${Number(x.pooled_median_absolute_error_pct).toFixed(1)}pp`;
    return stat(`${Number(x.horizon_days)}d Market reference`,money(projected),`${primary?'similarity PRIMARY':'pooled PRIMARY'} ${move(selected)} · similarity ${move(weighted)} (${move(lo)} to ${move(hi)}) · ${Number(x.analog_count||0)} analogs · ${tests} tests / ${products} products · ${x.direction_accuracy_pct==null?'—':`${Number(x.direction_accuracy_pct).toFixed(1)}%`} direction · similarity ${mae} vs pooled ${pooledMae}${analogs?` · ${analogs}`:''}`);
  }).join('');
  const primary=ready.every(x=>x.promotion_status==='PRIMARY'),demand=features.units_sold_30d==null?'Demand history unavailable':`${Number(features.units_sold_30d).toLocaleString()} items / 30d`;
  const gate=primary?'Similarity cleared the leakage-safe promotion gate.':`Pooled cohort remains primary; similarity is shadow because it has not beaten the pooled error benchmark at every horizon.`;
  return `<section class="cx-sealed-component-summary"><div class="cx-section-title">Lifecycle-normalized Collector Box outlook</div><div class="cx-sealed-grid">${stat('Current lifecycle',stage,`${Number.isFinite(ageDays)?`${ageDays} days from release`:'age unavailable'} · ${demand}`)}${stat('Current Market reference',money(first.current_market_price),`${esc(first.baseline_date||'')} checkpoint · trajectory anchor only`)}${cards}</div><div class="cx-sealed-econ-note">${esc(gate)} Same-age analogs combine structural, card-basket, price-path, release-cadence, and available items-sold evidence; every analog outcome predates the target checkpoint. Market trajectory evidence only—not acquisition or liquidation EV. Executable EV stays Direct-first / TCG Low fallback after fees, liquidity, and labor, and the Scout grade is unchanged.</div></section>`;
}

async function loadDetailData(r,force=false){
  // Version the persisted detail contract whenever its payload grows. Never
  // cache a partial economics payload: permission/query errors must surface
  // instead of being converted into authoritative-looking zeroes.
  return loadResource(`sealed.detail:v12:${r.sealed_uuid}`,async()=>{
    const [cards,price,contents,children,analogs,backtests,lifecycles,transitions,calibration,similarity,collectorForecast]=await Promise.all([
      rest('rpc/get_sealed_component_economics',{method:'POST',body:{p_sealed_uuid:r.sealed_uuid}}).catch(()=>[]),
      rest(`sealed_product_price_current?select=product_id,market_price,low_price,low_with_shipping,total_listings,captured_at&source=eq.tcgplayer_public&sealed_uuid=eq.${encodeURIComponent(r.sealed_uuid)}&limit=1`).catch(()=>[]),
      rest(`mtgjson_sealed_products?select=source_updated_at&uuid=eq.${encodeURIComponent(r.sealed_uuid)}&limit=1`).catch(()=>[]),
      rest(`sealed_product_child_components?select=child_sealed_uuid,child_product_name,quantity,component_type&parent_sealed_uuid=eq.${encodeURIComponent(r.sealed_uuid)}&order=child_product_name.asc`),
      rest(`sealed_product_trajectory_analogs_current?select=*&target_sealed_uuid=eq.${encodeURIComponent(r.sealed_uuid)}&order=analog_rank.asc`).catch(()=>[]),
      rest('sealed_product_trajectory_backtest_summary_current?select=*&category=eq.booster_box&subtype=eq.collector&limit=1').catch(()=>[]),
      rest(`sealed_product_lifecycle_signal_current?select=*&sealed_uuid=eq.${encodeURIComponent(r.sealed_uuid)}&limit=1`).catch(()=>[]),
      rest(`sealed_lifecycle_transition_outcomes_current?select=*&sealed_uuid=eq.${encodeURIComponent(r.sealed_uuid)}&order=observed_at.desc&limit=12`).catch(()=>[]),
      rest('modeled_booster_ev_calibration_current?select=horizon_days,cohort_count,median_change_pct,downside_change_pct,upside_change_pct,median_matched_prices,calibration_status,confidence_label,model_version,refreshed_at&order=horizon_days.asc').catch(()=>[]),
      rest(`modeled_play_booster_similarity_forecast_current?select=horizon_days,analog_count,median_change_pct,downside_change_pct,upside_change_pct,pooled_change_pct,average_similarity_score,confidence_label,forecast_status,promotion_status,backtest_samples,direction_accuracy_pct,median_absolute_error_pct,pooled_median_absolute_error_pct,model_version,target_features,analogs,refreshed_at&set_code=eq.${encodeURIComponent(String(r.set_code||'').toUpperCase())}&order=horizon_days.asc`).catch(()=>[]),
      rest(`collector_booster_trajectory_forecast_current?select=*&sealed_uuid=eq.${encodeURIComponent(r.sealed_uuid)}&order=horizon_days.asc`).catch(()=>[])
    ]);
    const childIds=(children||[]).map(c=>c.child_sealed_uuid).filter(Boolean),ids=[r.sealed_uuid,...childIds],[legacy,executable,exitDecisions]=await Promise.all([rest('rpc/get_sealed_family_economics_fast',{method:'POST',body:{p_sealed_uuids:ids}}),executableEconomics(ids),rest(`sealed_child_exit_decision_current?select=child_sealed_uuid,crack_unit_net,sealed_unit_net,selected_exit_route,selected_unit_net,selected_contribution,parent_adjustment,decision_policy,sealed_price_source,sealed_total_listings,sealed_price_age_hours,sealed_depth_status,sealed_route_confidence,sealed_route_eligible&parent_sealed_uuid=eq.${encodeURIComponent(r.sealed_uuid)}`).catch(()=>[])]),execById=new Map((executable||[]).map(x=>[String(x.sealed_uuid),x])),exitById=new Map((exitDecisions||[]).map(x=>[String(x.child_sealed_uuid),x])),legacyIds=new Set((legacy||[]).map(x=>String(x.sealed_uuid))),familyValues=[...(legacy||[]).map(x=>({...x,...execById.get(String(x.sealed_uuid))})),...(executable||[]).filter(x=>!legacyIds.has(String(x.sealed_uuid)))],byId=new Map(familyValues.map(x=>[String(x.sealed_uuid),x]));
    return{cards:cards||[],price:(price||[])[0]||null,contents:(contents||[])[0]||null,family:byId.get(String(r.sealed_uuid))||null,children:(children||[]).map(c=>{const exit=exitById.get(String(c.child_sealed_uuid)),chosen=['crack','sell_sealed'].includes(exit?.selected_exit_route);return{...c,...byId.get(String(c.child_sealed_uuid)),...exit,...(chosen?{practical_liquidation_ev:exit.selected_unit_net}: {})}}),analogs:analogs||[],backtest:(backtests||[])[0]||null,lifecycle:(lifecycles||[])[0]||null,transitions:transitions||[],calibration:calibration||[],similarity:similarity||[],collectorForecast:collectorForecast||[]};
  },{ttl:5*60*1000,force});
}

async function refreshMissingChildPrices(r,data){
  const parent=String(r?.sealed_uuid||'');
  if(!parent||childPriceRefreshAttempted.has(parent)||!(data?.children||[]).some(c=>!Number(c?.practical_liquidation_ev)))return;
  childPriceRefreshAttempted.add(parent);
  try{
    const result=await invokeFunction('sealed-child-price-refresh',{parent_sealed_uuid:parent});
    if(Number(result?.written)>0&&String(store.get().sealed?.selectedId||'')===parent){
      await loadDetailData(r,true);
      if(String(store.get().sealed?.selectedId||'')===parent)await renderDetail(r);
    }
  }catch(error){console.warn('[sealed child price refresh]',error)}
}

async function renderDetail(r){
  const h=document.getElementById('cxSealedDetail');if(!h)return;const seq=++detailSeq;
  if(!r){h.innerHTML='<div class="cx-empty">Select a sealed product.</div>';return}
  h.innerHTML=`<div class="cx-sealed-detail-skeleton" aria-hidden="true"><div class="cx-skeleton-line wide"></div><div class="cx-skeleton-line"></div><div class="cx-skeleton-grid">${'<span></span>'.repeat(4)}</div><div class="cx-skeleton-table"></div></div>`;
  try{
    const d=await loadDetailData(r);if(seq!==detailSeq)return;
    const s=store.get().sealed||{},type=s.setTypes?.[String(r.set_code||'').toUpperCase()],detailFloor=d.family?.practical_action==='MODEL PENDING'&&Number(d.family?.practical_liquidation_ev)>0&&String(d.family?.valuation_basis||'').includes('fixed'),sc=detailFloor?null:d.family?.practical_scout_score==null?score(r):Number(d.family.practical_scout_score),detailGrade=d.family?.practical_scout_grade||grade(r),a=acquisition(r),sealedUrl=d.price?.product_id?`https://www.tcgplayer.com/product/${encodeURIComponent(d.price.product_id)}?page=1`:'';
    const priceDates=[d.price?.captured_at,...d.cards.flatMap(c=>[c.direct_observed_at,c.vendor_observed_on?`${c.vendor_observed_on}T12:00:00Z`:null])].filter(Boolean).map(x=>new Date(x).getTime()).filter(Number.isFinite),pricesAt=priceDates.length?new Date(Math.max(...priceDates)).toISOString():null;
    const totalEv=d.family?.practical_liquidation_ev==null?null:Number(d.family.practical_liquidation_ev),cashFloor=d.family?.cash_floor_ev==null?null:Number(d.family.cash_floor_ev),optimisticEv=d.family?.optimistic_ev==null?null:Number(d.family.optimistic_ev),lowEv=Number(d.family?.tcg_low_ev||0),median=d.family?.practical_median_estimate==null?null:Number(d.family.practical_median_estimate),p10=d.family?.practical_p10_estimate==null?null:Number(d.family.practical_p10_estimate),concentration=Number(d.family?.top10_practical_ev_share_pct),composite=d.children.length>0,totalSpread=!detailFloor&&totalEv&&a!=null?totalEv-a:null,totalRoi=totalSpread!=null&&a>0?100*totalSpread/a:null;
    const exitSub=detailFloor?'sample pack excluded · not scored':sealedExitWins(d.family)?`sell included packs sealed; crack practical ${money(d.family.base_practical_liquidation_ev)}`:'crack/open net after fees + liquidity + labor';
    h.innerHTML=`<h3>${sealedUrl?`<a class="cx-source-anchor" href="${esc(sealedUrl)}" target="_blank" rel="noopener">${esc(r.product_name)}</a>`:esc(r.product_name)}</h3><span class="cx-sub">${esc(r.set_code||'')} · ${esc(type?human(type):human(r.subtype||r.category||''))} · ${esc(r.release_date||'')}</span><div class="cx-sealed-badges">${detailFloor?'<span class="cx-sealed-badge risk">COMPONENT FLOOR</span>':sc==null?'':`<span class="cx-sealed-badge direct">Scout ${esc(detailGrade)} · ${sc.toFixed(1)}/100</span>`}${confidenceBadge(d.family)}${badges(r)}</div>${languageNote(r)}<div class="cx-sealed-freshness"><span><b>Prices synced</b> ${age(pricesAt)}</span><span><b>Contents synced</b> ${age(d.contents?.source_updated_at)}</span></div><div class="cx-section-title">EV sensitivity</div><div class="cx-sealed-grid">${stat('Cash floor',money(cashFloor),'Card Kingdom cash buylist; missing cards $0')}${stat(detailFloor?'Known-card practical floor':practicalLabel(d.family),money(totalEv),exitSub)}${stat('Optimistic EV',money(optimisticEv),composite?`${Number(d.family?.modeled_child_units||0)} packs + fixed cards`:'best current route after marketplace fees')}${stat('Sealed acquisition',money(a),d.price?.captured_at?`TCG observed ${age(d.price.captured_at)}`:'current pipeline value',sealedUrl)}${stat('TCG Low EV',money(lowEv),'gross reference · Market excluded')}${stat('Top-10 concentration',Number.isFinite(concentration)?pct(concentration):'—','share of practical EV')}${stat('Practical spread',money(totalSpread),detailFloor?'not scored until pack is modeled':totalRoi==null?'':`${totalRoi>=0?'+':''}${totalRoi.toFixed(1)}%`)}</div>${r.blocker?`<div class="cx-sealed-summary"><strong>Current blocker:</strong> ${esc(human(r.blocker))}.</div>`:''}${releaseStressSummary(r,d.family,d.calibration,d.similarity)}${distributionSummary(d.family)}${lifecycleSummary(d.lifecycle)}${transitionSummary(d.transitions)}${collectorForecastSummary(d.collectorForecast)}${d.collectorForecast?.length?'':analogSummary(d.analogs,d.backtest)}${evAuditSummary(d.family)}${componentSummary(d.children,d.family)}<div class="cx-section-title cx-sealed-econ-title">Component economics</div>${econTable(d.cards)}`;
    store.update('sealed',{detail:{id:r.sealed_uuid,cards:d.cards,price:d.price,contents:d.contents}});
    document.dispatchEvent(new CustomEvent('collectish:sealed-detail-rendered',{detail:{id:r.sealed_uuid,row:r,data:d}}));
    void refreshMissingChildPrices(r,d);
  }catch(error){if(seq===detailSeq)h.innerHTML=`<div class="cx-empty">${esc(error.message||error)}</div>`}
}

export async function load(force=false){
  const h=document.getElementById('cxSealed');if(!h)return;
  h.innerHTML='<div class="cx-page-head"><div><h2>Scout Sealed</h2><p>Loading sealed opportunities…</p></div></div><div class="cx-sealed-page-skeleton" aria-hidden="true"><div class="cx-skeleton-toolbar"></div><div class="cx-skeleton-layout"><div class="cx-skeleton-list">'+Array.from({length:6},()=>'<div class="cx-skeleton-card"><span class="cx-skeleton-art"></span><span class="cx-skeleton-copy"></span></div>').join('')+'</div><div class="cx-skeleton-table"></div></div></div>';
  try{await loadIndex(force);renderShell();document.dispatchEvent(new CustomEvent('collectish:sealed-core-ready',{detail:{count:store.get().sealed?.rows?.length||0}}))}
  catch(error){h.innerHTML=`<div class="cx-page-head"><div><h2>Scout Sealed</h2><p>Could not load the sealed model.</p></div><button class="cx-refresh" id="cxSealedRetry">Retry</button></div><div class="cx-card"><div class="cx-empty">${esc(error.message||error)}</div></div>`;h.querySelector('#cxSealedRetry')?.addEventListener('click',()=>load(true))}
}

let installed=false;
export async function install(){
  if(installed)return;
  installed=true;
  await load(false);
}

window.CollectishSealed={install,load,select:selectProduct,render:renderRows};
