import { rest } from '../../core/rest.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const num=v=>Number.isFinite(Number(v))?Number(v):null;
const lower=s=>String(s||'').trim().toLowerCase();
let rows=[],loading=null,filter='all',query='';

function scoreOf(row){return num(row?.payload_json?.scout_best?.score)??num(row?.metadata_json?.scout_score)}
function gradeOf(row){return String(row?.payload_json?.scout_best?.grade||row?.metadata_json?.scout_grade||'').toUpperCase()}
function candidateName(row){return String(row?.payload_json?.card_name||'Unknown card')}
function setLabel(row){return row?.payload_json?.set_code||row?.payload_json?.set_name||'—'}
function moveOf(row){return num(row?.payload_json?.pct_change)}
function identityKey(row){const p=row?.payload_json||{},best=p.scout_best||{};if(best.scryfall_id)return `sf:${best.scryfall_id}`;if(best.product_id)return `product:${best.product_id}`;return `name:${lower(candidateName(row))}|set:${lower(p.set_code||p.set_name||'')}`}
function latestCandidates(data){
  const sourceSeen=new Set(),grouped=new Map();
  for(const row of data||[]){
    const sourceKey=String(row.source_key||row.capture_id||'');if(!sourceKey||sourceSeen.has(sourceKey))continue;sourceSeen.add(sourceKey);
    const key=identityKey(row),existing=grouped.get(key);
    if(!existing){grouped.set(key,{...row,_discovery_occurrences:1,_discovery_max_abs_move:Math.abs(moveOf(row)||0)});continue}
    existing._discovery_occurrences=(existing._discovery_occurrences||1)+1;
    existing._discovery_max_abs_move=Math.max(existing._discovery_max_abs_move||0,Math.abs(moveOf(row)||0));
  }
  return [...grouped.values()];
}
function matchesFilter(row){const grade=gradeOf(row),score=scoreOf(row),move=moveOf(row);if(filter==='rated')return !!grade;if(filter==='top')return grade==='A'||grade==='B'||(score!=null&&score>=70);if(filter==='unrated')return !grade;if(filter==='up')return move!=null&&move>0;if(filter==='down')return move!=null&&move<0;return true}
function matchesQuery(row){if(!query)return true;const p=row.payload_json||{},hay=`${candidateName(row)} ${p.set_code||''} ${p.set_name||''} ${gradeOf(row)} ${p.discovery_source||''}`.toLowerCase();return hay.includes(query.toLowerCase())}
function relativeAge(value){const t=new Date(value).getTime();if(!Number.isFinite(t))return'';const h=Math.max(0,Math.floor((Date.now()-t)/3600000));if(h<1)return'now';if(h<24)return`${h}h`;return`${Math.floor(h/24)}d`}
function moveText(row){const v=moveOf(row);return v==null?'—':`${v>0?'+':''}${v.toFixed(Math.abs(v)>=100?0:1)}%`}
function gradeClass(g){return ['A','B','C','D','F'].includes(g)?`grade-${g.toLowerCase()}`:'grade-none'}
function reason(row){const g=gradeOf(row),s=scoreOf(row),move=moveOf(row);if(g==='A'||g==='B'||(s!=null&&s>=70))return'Worth opening in Scout';if(!g)return'No current Scout match — prefetch / investigate';if(move!=null&&Math.abs(move)>=100)return'Sharp external move, weak Scout support';return'Scout does not currently confirm the move'}
function rowMarkup(row){const p=row.payload_json||{},best=p.scout_best||{},g=gradeOf(row),s=scoreOf(row),move=moveOf(row),occ=Number(row._discovery_occurrences||1),canOpen=!!(best.sku_id||best.product_id||best.scryfall_id||candidateName(row)),seen=occ>1?` · seen ${occ}×`:'';return `<button class="cx-discovery-row" type="button" ${canOpen?'data-discovery-open':''} data-sku="${esc(best.sku_id||'')}" data-product="${esc(best.product_id||'')}" data-scryfall="${esc(best.scryfall_id||'')}" data-card="${esc(candidateName(row))}"><div class="cx-discovery-card"><strong>${esc(candidateName(row))}</strong><small>${esc(setLabel(row))}${p.finish&&p.finish!=='unknown'?` · ${esc(p.finish)}`:''} · ${esc(relativeAge(row.captured_at))}${seen}</small></div><div class="cx-discovery-move ${move!=null&&move<0?'down':'up'}"><strong>${esc(moveText(row))}</strong><small>latest MTGStocks interest</small></div><div class="cx-discovery-scout"><span class="cx-discovery-grade ${gradeClass(g)}">${esc(g||'—')}</span><div><strong>${s==null?'Unrated':`Scout ${Math.round(s)}`}</strong><small>${esc(reason(row))}</small></div></div></button>`}
function summaryMarkup(filtered){const rated=rows.filter(r=>gradeOf(r)).length,top=rows.filter(r=>['A','B'].includes(gradeOf(r))||(scoreOf(r)!=null&&scoreOf(r)>=70)).length,unrated=rows.length-rated;return `<div class="cx-discovery-intro"><div><span class="cx-discovery-kicker">Discovery queue</span><h3>Cards worth a second look</h3><p>MTGStocks Interests is used here as a candidate generator, not as evidence that changes Scout scoring. The useful question is whether our own Scout data agrees.</p></div><div class="cx-discovery-metrics"><div><strong>${rows.length}</strong><small>unique cards</small></div><div><strong>${top}</strong><small>Scout A/B</small></div><div><strong>${rated}</strong><small>rated</small></div><div><strong>${unrated}</strong><small>needs lookup</small></div></div></div><div class="cx-discovery-toolbar"><div class="cx-discovery-filters">${[['all','All'],['top','A/B first'],['rated','Rated'],['unrated','Needs lookup'],['up','Up'],['down','Down']].map(([k,l])=>`<button type="button" data-discovery-filter="${k}" class="${filter===k?'active':''}">${l}</button>`).join('')}</div><input id="cxDiscoverySearch" type="search" value="${esc(query)}" placeholder="Find card or set…" aria-label="Search discovery candidates"></div><div class="cx-discovery-list">${filtered.length?filtered.map(rowMarkup).join(''):'<div class="cx-empty">No discovery candidates match this view.</div>'}</div>`}

export async function loadDiscovery(force=false){if(loading&&!force)return loading;loading=rest('source_captures?select=capture_id,source_key,captured_at,payload_json,metadata_json&source=eq.MTGStocks&capture_type=eq.discovery_candidate&order=captured_at.desc&limit=250').then(data=>{rows=latestCandidates(Array.isArray(data)?data:[]);return rows}).finally(()=>{loading=null});return loading}
export function renderDiscovery(host){if(!host)return;const filtered=rows.filter(matchesFilter).filter(matchesQuery);host.innerHTML=summaryMarkup(filtered)}
export function setDiscoveryFilter(next){filter=next||'all'}
export function setDiscoveryQuery(next){query=String(next||'')}
export function getDiscoveryState(){return{rows,filter,query}}
