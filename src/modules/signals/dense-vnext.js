import store from '../../state/store.js';
import { uiEvidenceMarker } from '../../core/ui-primitives.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=v=>v==null||v===''?'—':`$${Number(v).toFixed(2)}`;
const pct=v=>v==null||v===''?'—':`${Number(v).toFixed(1)}%`;
const age=value=>{if(!value)return'—';const ms=Date.now()-new Date(value).getTime();if(!Number.isFinite(ms))return'—';const h=Math.max(0,Math.round(ms/3600000));if(h<1)return'now';if(h<24)return`${h}h`;return`${Math.round(h/24)}d`};
const host=()=>document.getElementById('cxSignals');
let mode='scan',filter='all',query='';

function actionableRows(){return Array.isArray(store.get().actionableEmerging?.rows)?store.get().actionableEmerging.rows:[]}
function intelItems(){return Array.isArray(store.get().intel?.items)?store.get().intel.items:[]}
function keyFor({sku_id,product_id,scryfall_id,card_name}){return String(sku_id||product_id||scryfall_id||card_name||'').toLowerCase()}
function signalLabel(r){return r.action_class==='action_now'?'Action now':r.action_class==='emerging_quick_turn'?'Emerging':'Watch'}
function actionKind(r){return r.action_class==='action_now'?'action':r.action_class==='emerging_quick_turn'?'emerging':'watch'}

function buildRows(){
  const map=new Map();
  for(const r of actionableRows()){
    const row={key:keyFor(r),sku_id:r.sku_id||null,product_id:r.product_id||null,scryfall_id:r.scryfall_id||null,card_name:r.card_name||r.product_name||'Unknown card',set_name:r.set_name||'',printing:r.printing||'',kind:actionKind(r),signal:signalLabel(r),primary_signal:r.primary_signal||'Changing market signal',evidence:Number(r.signal_families||0),confidence:Math.max(0,Math.min(100,Number(r.actionability_score||0))),scout:Number(r.adjusted_scout_score??r.base_scout_score??0),roi:r.direct_roi_pct==null?null:Number(r.direct_roi_pct),buy:r.cheapest_buy==null?null:Number(r.cheapest_buy),direct_net:r.direct_net_est==null?null:Number(r.direct_net_est),liquidity:r.liquidity_label||'',updated_at:null,direction:'bullish',stage:r.action_class==='action_now'?'leading':'confirming'};
    map.set(row.key,row);
  }
  for(const item of intelItems()){
    const entities=Array.isArray(item.market_intel_entities)?item.market_intel_entities:[];
    for(const e of entities){
      if(e.entity_type!=='card'||!(e.scryfall_id||e.product_id))continue;
      const key=keyFor({product_id:e.product_id,scryfall_id:e.scryfall_id,card_name:e.entity_name}),existing=map.get(key);
      if(existing){existing.evidence=Math.max(existing.evidence,1);existing.intel_count=(existing.intel_count||0)+1;if(item.observed_at&&(!existing.updated_at||new Date(item.observed_at)>new Date(existing.updated_at)))existing.updated_at=item.observed_at;continue}
      map.set(key,{key,sku_id:null,product_id:e.product_id||null,scryfall_id:e.scryfall_id||null,card_name:e.entity_name||'Unknown card',set_name:e.set_code||'',printing:'',kind:'watch',signal:item.signal_stage==='leading'?'Leading':item.signal_stage==='confirming'?'Confirming':'Watch',primary_signal:item.summary||item.title||'External market intelligence',evidence:1,confidence:Math.round(Math.max(0,Math.min(1,Number(item.confidence??e.confidence??0.5)))*100),scout:null,roi:null,buy:null,direct_net:null,liquidity:'',updated_at:item.observed_at||item.published_at||item.created_at||null,direction:item.direction||'neutral',stage:item.signal_stage||'unclassified',intel_count:1});
    }
  }
  const rows=[...map.values()],counts=new Map();
  for(const item of intelItems())for(const e of Array.isArray(item.market_intel_entities)?item.market_intel_entities:[]){if(e.entity_type==='card'&&(e.scryfall_id||e.product_id)){const k=keyFor({product_id:e.product_id,scryfall_id:e.scryfall_id,card_name:e.entity_name});counts.set(k,(counts.get(k)||0)+1)}}
  for(const r of rows)r.evidence=Math.max(r.evidence||0,counts.get(r.key)||0);
  return rows.sort((a,b)=>{const rank={action:3,emerging:2,watch:1};return(rank[b.kind]-rank[a.kind])||(b.confidence-a.confidence)||((b.scout||0)-(a.scout||0))});
}

function filteredRows(){const q=query.trim().toLowerCase();return buildRows().filter(r=>(filter==='all'||r.kind===filter)&&(!q||`${r.card_name} ${r.set_name} ${r.primary_signal}`.toLowerCase().includes(q)))}
function metric(label,value,sub=''){return `<div class="cx-sv-metric cx-ui-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`}
function stageChip(r){const cls=r.kind==='action'?'cx-sv-action':r.kind==='emerging'?'cx-sv-emerging':'cx-sv-watch',semantic=r.kind==='action'?'success':r.kind==='emerging'?'accent':'muted';return `<span class="cx-sv-chip cx-ui-status ${semantic} ${cls}">${esc(r.signal)}</span>`}
function direction(r){return r.direction==='bearish'?'↓':r.direction==='bullish'?'↑':'→'}
function rowHtml(r){const edge=r.roi==null?'—':pct(r.roi),price=r.buy==null?'—':money(r.buy),evidenceText=r.evidence?String(r.evidence):'1',scout=r.scout==null?'—':Math.round(r.scout),confMarker=uiEvidenceMarker('inferred','Confidence is modeled/inferred, not a directly observed market fact.');return `<button type="button" class="cx-sv-row" data-sv-open data-sku="${esc(r.sku_id||'')}" data-product="${esc(r.product_id||'')}" data-scryfall="${esc(r.scryfall_id||'')}" data-card="${esc(r.card_name)}"><span class="cx-sv-card"><strong>${esc(r.card_name)}</strong><small>${esc([r.set_name,r.printing].filter(Boolean).join(' · '))}</small></span><span class="cx-sv-signal">${stageChip(r)}<small>${esc(r.primary_signal)}</small></span><span class="cx-sv-num"><strong>${esc(evidenceText)}</strong><small>evd</small></span><span class="cx-sv-num"><strong>${esc(String(r.confidence))}${confMarker}</strong><small>conf</small></span><span class="cx-sv-num"><strong>${esc(String(scout))}</strong><small>Scout</small></span><span class="cx-sv-price"><strong>${esc(price)}</strong><small>${esc(edge)} edge</small></span><span class="cx-sv-move ${r.direction}"><strong>${esc(direction(r))}</strong><small>${esc(age(r.updated_at))}</small></span></button>`}
function renderScan(){const rows=filteredRows(),all=buildRows(),action=all.filter(r=>r.kind==='action').length,emerging=all.filter(r=>r.kind==='emerging').length,watch=all.filter(r=>r.kind==='watch').length,sources=new Set(intelItems().map(x=>x.source_url).filter(Boolean)).size;return `<div class="cx-sv-scan"><div class="cx-sv-metrics cx-ui-metrics">${metric('Action now',action,'trade-ready')}${metric('Emerging',emerging,'changing')}${metric('Watch',watch,'verified cards')}${metric('Sources',sources,'current intel')}</div><div class="cx-sv-toolbar"><div class="cx-sv-filters cx-ui-tabs">${[['all','All'],['action','Action'],['emerging','Emerging'],['watch','Watch']].map(([v,l])=>`<button type="button" data-sv-filter="${v}" class="${filter===v?'active':''}">${l}</button>`).join('')}</div><input id="cxSvSearch" type="search" value="${esc(query)}" placeholder="Search cards or signals"></div><div class="cx-sv-head"><span>Card</span><span>Signal</span><span>Evd</span><span>Conf</span><span>Scout</span><span>Buy / edge</span><span>Move</span></div><div class="cx-sv-list cx-ui-list">${rows.length?rows.slice(0,80).map(rowHtml).join(''):'<div class="cx-empty">No signals match this view.</div>'}</div></div>`}
function renderShell(){const h=host();if(!h)return;let shell=document.getElementById('cxSignalsVnext');if(!shell){shell=document.createElement('section');shell.id='cxSignalsVnext';shell.className='cx-signals-vnext';const head=h.querySelector('.cx-page-head');if(head)head.insertAdjacentElement('afterend',shell);else h.prepend(shell)}shell.innerHTML=`<div class="cx-sv-nav cx-ui-tabs"><button type="button" data-sv-mode="scan" class="${mode==='scan'?'active':''}">Scan</button><button type="button" data-sv-mode="feed" class="${mode==='feed'?'active':''}">Feed</button><button type="button" data-sv-mode="sources" class="${mode==='sources'?'active':''}">Sources</button><span>Dense market intelligence</span></div><div id="cxSvBody">${mode==='scan'?renderScan():''}</div>`;applyMode()}
function legacyPanels(){const h=host();if(!h)return[];return[...h.children].filter(el=>el.id!=='cxSignalsVnext'&&!el.classList.contains('cx-page-head'))}
function applyMode(){const h=host();if(!h)return;const scan=mode==='scan';h.classList.toggle('cx-sv-scan-mode',scan);for(const el of legacyPanels())el.hidden=scan;if(mode==='feed'){for(const el of legacyPanels())el.hidden=false;document.getElementById('cxSourceCollectors')?.removeAttribute('open')}if(mode==='sources'){for(const el of legacyPanels())el.hidden=false;const collectors=document.getElementById('cxSourceCollectors');if(collectors){collectors.open=true;setTimeout(()=>collectors.scrollIntoView({block:'start',behavior:'smooth'}),40)}const feed=document.getElementById('cxSignalsFeed');if(feed)feed.closest('section')?.classList.add('cx-sv-source-muted')}else document.querySelector('.cx-sv-source-muted')?.classList.remove('cx-sv-source-muted')}
function openScout(el){document.dispatchEvent(new CustomEvent('collectish:open-scout-card',{detail:{sku_id:el.dataset.sku||null,product_id:el.dataset.product||null,scryfall_id:el.dataset.scryfall||null,card_name:el.dataset.card||null}}))}
function setMode(next){mode=next;renderShell()}

document.addEventListener('click',e=>{const m=e.target.closest?.('[data-sv-mode]');if(m){e.preventDefault();setMode(m.dataset.svMode);return}const f=e.target.closest?.('[data-sv-filter]');if(f){e.preventDefault();filter=f.dataset.svFilter;renderShell();return}const row=e.target.closest?.('[data-sv-open]');if(row){e.preventDefault();openScout(row)}},true);
document.addEventListener('input',e=>{if(e.target?.id==='cxSvSearch'){query=e.target.value;const pos=e.target.selectionStart;renderShell();const input=document.getElementById('cxSvSearch');if(input){input.focus();try{input.setSelectionRange(pos,pos)}catch{}}}},true);
const schedule=()=>setTimeout(renderShell,0);
document.addEventListener('collectish:lazy-page-loaded',e=>{if(e.detail?.page==='signals')setTimeout(renderShell,100)});document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='signals')setTimeout(renderShell,80)});document.addEventListener('collectish:intel-changed',schedule);document.addEventListener('collectish:actionable-emerging-changed',schedule);document.addEventListener('collectish:competitive-changed',schedule);document.addEventListener('collectish:commander-intel-changed',schedule);queueMicrotask(renderShell);
