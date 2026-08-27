import { rest } from '../../core/rest.js';

const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const num=v=>Number.isFinite(Number(v))?Number(v):null;
const lower=s=>String(s||'').trim().toLowerCase();
const money=v=>num(v)==null?'':`$${Number(v).toFixed(2)}`;
const baseName=s=>String(s||'').replace(/^\(RL\)\s*/i,'').replace(/\s+#\d+(?:\s+.*)?$/,'').replace(/\s*\(\d{3,4}\)\s*$/,'').trim();
let rows=[],loading=null,filter='all',query='';

function payload(row){return row?.payload_json||{}}
function scoutBest(row){return payload(row).scout_best||{}}
function identityBest(row){return payload(row).identity_best||{}}
function evaluation(row){return payload(row).discovery_evaluation||{}}
function scoreOf(row){return num(scoutBest(row).score)??num(row?.metadata_json?.scout_score)}
function gradeOf(row){return String(scoutBest(row).grade||row?.metadata_json?.scout_grade||'').toUpperCase()}
function candidateName(row){return String(payload(row).card_name||'Unknown card')}
function setLabel(row){return payload(row).set_code||payload(row).set_name||identityBest(row).set_code||'—'}
function moveOf(row){return num(payload(row).pct_change)}
function sourceLabel(row){return payload(row).source_label||row.source||'Discovery'}
function resolvedIdentity(row){const b=scoutBest(row),i=identityBest(row);return !!(b.product_id||b.scryfall_id||i.tcgplayer_product_id||i.scryfall_id)}
function openIdentity(row){const b=scoutBest(row),i=identityBest(row);return{sku_id:b.sku_id||'',product_id:b.product_id||i.tcgplayer_product_id||'',scryfall_id:b.scryfall_id||i.scryfall_id||'',card_name:baseName(candidateName(row))||candidateName(row)}}
function identityKey(row){const o=openIdentity(row);if(o.scryfall_id)return `sf:${o.scryfall_id}`;if(o.product_id)return `product:${o.product_id}`;return `name:${lower(baseName(candidateName(row)))}|set:${lower(setLabel(row))}`}
function sourceNames(row){return Array.isArray(row._sources)?row._sources:[sourceLabel(row)]}
function mergeCandidates(data){
  const grouped=new Map();
  for(const row of data||[]){
    const key=identityKey(row),existing=grouped.get(key);
    if(!existing){grouped.set(key,{...row,_discovery_occurrences:Number(row._discovery_occurrences||1),_sources:[sourceLabel(row)]});continue}
    existing._discovery_occurrences=Number(existing._discovery_occurrences||1)+Number(row._discovery_occurrences||1);
    existing._sources=[...new Set([...sourceNames(existing),sourceLabel(row)])];
    const existingScore=scoreOf(existing)??-1,rowScore=scoreOf(row)??-1;
    if(rowScore>existingScore||(rowScore===existingScore&&new Date(row.captured_at||0)>new Date(existing.captured_at||0))){
      const occ=existing._discovery_occurrences,sources=existing._sources;Object.assign(existing,row);existing._discovery_occurrences=occ;existing._sources=sources;
    }
  }
  return [...grouped.values()];
}
function latestMtgStocks(data){const seen=new Set(),out=[];for(const row of data||[]){const k=String(row.source_key||row.capture_id||'');if(!k||seen.has(k))continue;seen.add(k);out.push({...row,source:'MTGStocks',payload_json:{...payload(row),source_label:'MTGStocks'}})}return out}
function parseMoverPct(summary,direction){const s=String(summary||''),m=s.match(/([+-]?\d+(?:\.\d+)?)%/);if(!m)return null;const v=Math.abs(Number(m[1]));return direction==='bearish'?-v:v}
function mtgGoldfishRows(items){const out=[];for(const item of items||[]){if(!String(item.source_url||'').includes('/movers/paper/'))continue;for(const entity of item.market_intel_entities||[]){if(!entity?.entity_name)continue;out.push({capture_id:`goldfish:${item.intel_id}:${entity.entity_name}`,source_key:`goldfish:${item.intel_id}:${entity.entity_name}`,captured_at:item.observed_at,source:'MTGGoldfish',metadata_json:{signal_weight:'discovery_only'},payload_json:{card_name:entity.entity_name,set_code:entity.set_code||null,pct_change:parseMoverPct(item.summary,item.direction),url:item.source_url,discovery_source:'mtggoldfish_paper_mover',source_label:'MTGGoldfish',identity_best:{scryfall_id:entity.scryfall_id||null,tcgplayer_product_id:entity.product_id||null,set_code:entity.set_code||null}}})}}
  return out;
}
function useScout(row,s){if(!s)return false;row.payload_json={...payload(row),scout_best:{sku_id:s.sku_id||'',product_id:s.product_id||openIdentity(row).product_id,product_name:s.product_name||baseName(candidateName(row)),set_name:s.set_name||'',set_code:s.set_code||setLabel(row),printing:s.printing||'',condition:s.condition||'',grade:s.promoted_grade||s.v5_grade||s.grade||'',score:s.promoted_score??s.v5_score??s.opportunity_score,direct_low:s.direct_low,market_price:s.sku_market_price,avg_daily_qty_sold:s.avg_daily_qty_sold,sales_rank:s.sales_rank,scryfall_id:s.scryfall_id||openIdentity(row).scryfall_id}};return !!gradeOf(row)}
async function resolveRow(row){if(resolvedIdentity(row))return row;const p=payload(row),name=baseName(candidateName(row)),set=String(p.set_code||'').trim();if(!name)return row;
  const q=`mtgjson_cards?select=uuid,name,set_code,collector_number,scryfall_id,tcgplayer_product_id,finishes&name=eq.${encodeURIComponent(name)}${set?`&set_code=eq.${encodeURIComponent(set)}`:''}&language=eq.English&order=collector_number.asc&limit=12`;
  const identities=await rest(q).catch(()=>[]);if(!identities?.length)return row;
  const wantedCollector=(candidateName(row).match(/\((\d{3,4})\)\s*$/)||[])[1]||'';
  const id=identities.find(x=>wantedCollector&&String(x.collector_number||'').padStart(4,'0')===wantedCollector)||identities[0];
  row.payload_json={...p,identity_best:id,identity_resolution:'mtgjson'};
  const product=String(id.tcgplayer_product_id||'');if(product){const scout=await rest(`scout_opportunities_v5_cache?select=sku_id,product_id,product_name,set_name,set_code,printing,condition,language,promoted_score,promoted_grade,opportunity_score,grade,direct_low,sku_market_price,avg_daily_qty_sold,sales_rank,scryfall_id&product_id=eq.${encodeURIComponent(product)}&order=promoted_score.desc.nullslast,opportunity_score.desc.nullslast&limit=1`).catch(()=>[]);useScout(row,scout?.[0])}
  return row;
}
async function prefetchEvaluation(row){if(gradeOf(row)||!resolvedIdentity(row))return row;const p=payload(row),id=identityBest(row),o=openIdentity(row),product=String(o.product_id||'');if(!product)return row;
  const [shadow,h24,prices,vendor,sales]=await Promise.all([
    rest(`scout_v5_shadow?select=sku_id,product_id,product_name,set_name,set_code,printing,v5_score,v5_grade,cheapest_buy,cheapest_source,direct_net_est,direct_net_profit,ck_buylist,confidence_label,score_components&product_id=eq.${encodeURIComponent(product)}&order=computed_at.desc&limit=1`).catch(()=>[]),
    rest(`scout_opportunities_24h?select=sku_id,product_id,product_name,set_name,set_code,printing,condition,grade,opportunity_score,direct_low,sku_market_price,avg_daily_qty_sold,sales_rank,scryfall_id&product_id=eq.${encodeURIComponent(product)}&order=opportunity_score.desc.nullslast&limit=1`).catch(()=>[]),
    rest(`tcgplayer_preferred_price_current_cache?select=product_id,finish,low_price,market_price,direct_low_price,observed_on,refreshed_at&product_id=eq.${encodeURIComponent(product)}&order=refreshed_at.desc&limit=3`).catch(()=>[]),
    id.uuid?rest(`scout_vendor_price_current_cache?select=finish,cardkingdom_retail,cardkingdom_buylist,manapool_retail,cardmarket_retail,tcgplayer_retail,refreshed_at&mtgjson_uuid=eq.${encodeURIComponent(id.uuid)}&order=refreshed_at.desc&limit=3`).catch(()=>[]):Promise.resolve([]),
    rest(`scout_product_sales_cache?select=fetched_at,source,sku_count&product_id=eq.${encodeURIComponent(product)}&order=fetched_at.desc&limit=1`).catch(()=>[])
  ]);
  if(useScout(row,shadow?.[0]))return row;
  if(useScout(row,h24?.[0]))return row;
  const price=prices?.find(x=>String(x.finish||'').toLowerCase()==='normal')||prices?.[0]||null;
  const vend=vendor?.find(x=>String(x.finish||'').toLowerCase()==='normal')||vendor?.[0]||null;
  const ev={product_id:product,pricing_ready:!!price,vendor_ready:!!vend,sales_ready:!!sales?.[0],market_price:num(price?.market_price),direct_low:num(price?.direct_low_price),tcg_low:num(price?.low_price),ck_retail:num(vend?.cardkingdom_retail),ck_buylist:num(vend?.cardkingdom_buylist),manapool_retail:num(vend?.manapool_retail),sales_cached_at:sales?.[0]?.fetched_at||null,sales_sku_count:num(sales?.[0]?.sku_count),prefetched_at:new Date().toISOString()};
  row.payload_json={...payload(row),discovery_evaluation:ev};return row;
}
async function autoResolve(data){const unresolved=data.filter(r=>!resolvedIdentity(r)).slice(0,20);await Promise.all(unresolved.map(resolveRow));const pending=data.filter(r=>resolvedIdentity(r)&&!gradeOf(r)).slice(0,24);await Promise.all(pending.map(prefetchEvaluation));return data}
function matchesFilter(row){const grade=gradeOf(row),score=scoreOf(row),move=moveOf(row);if(filter==='rated')return !!grade;if(filter==='top')return grade==='A'||grade==='B'||(score!=null&&score>=70);if(filter==='unrated')return !grade;if(filter==='ready')return !grade&&Object.keys(evaluation(row)).length>0;if(filter==='unresolved')return !resolvedIdentity(row);if(filter==='up')return move!=null&&move>0;if(filter==='down')return move!=null&&move<0;return true}
function matchesQuery(row){if(!query)return true;const hay=`${candidateName(row)} ${setLabel(row)} ${gradeOf(row)} ${sourceNames(row).join(' ')}`.toLowerCase();return hay.includes(query.toLowerCase())}
function relativeAge(value){const t=new Date(value).getTime();if(!Number.isFinite(t))return'';const h=Math.max(0,Math.floor((Date.now()-t)/3600000));if(h<1)return'now';if(h<24)return`${h}h`;return`${Math.floor(h/24)}d`}
function moveText(row){const v=moveOf(row);return v==null?'—':`${v>0?'+':''}${v.toFixed(Math.abs(v)>=100?0:1)}%`}
function gradeClass(g){return ['A','B','C','D','F'].includes(g)?`grade-${g.toLowerCase()}`:'grade-none'}
function evaluationText(row){const e=evaluation(row),parts=[];if(e.market_price!=null)parts.push(`Market ${money(e.market_price)}`);if(e.direct_low!=null)parts.push(`Direct ${money(e.direct_low)}`);if(e.ck_buylist!=null)parts.push(`CK BL ${money(e.ck_buylist)}`);if(e.sales_ready)parts.push('sales cached');return parts.slice(0,3).join(' · ')}
function reason(row){const g=gradeOf(row),s=scoreOf(row),move=moveOf(row),e=evaluation(row);if(g==='A'||g==='B'||(s!=null&&s>=70))return'Worth opening in Scout';if(!g&&Object.keys(e).length)return evaluationText(row)||'Scout inputs prefetched · grade awaits scan coverage';if(!g&&resolvedIdentity(row))return'Printing resolved · prefetch pending';if(!g)return'Identity still unresolved · investigate';if(move!=null&&Math.abs(move)>=100)return'Sharp external move, weak Scout support';return'Scout does not currently confirm the move'}
function rowMarkup(row){const o=openIdentity(row),g=gradeOf(row),s=scoreOf(row),move=moveOf(row),e=evaluation(row),occ=Number(row._discovery_occurrences||1),sources=sourceNames(row),seen=occ>1?` · seen ${occ}×`:'';const state=s!=null?`Scout ${Math.round(s)}`:Object.keys(e).length?'Scout data ready':resolvedIdentity(row)?'Prefetching Scout':'Needs lookup';return `<button class="cx-discovery-row" type="button" data-discovery-open data-sku="${esc(o.sku_id)}" data-product="${esc(o.product_id)}" data-scryfall="${esc(o.scryfall_id)}" data-card="${esc(o.card_name)}"><div class="cx-discovery-card"><strong>${esc(candidateName(row))}</strong><small>${esc(setLabel(row))} · ${esc(relativeAge(row.captured_at))}${seen} · ${esc(sources.join(' + '))}</small></div><div class="cx-discovery-move ${move!=null&&move<0?'down':'up'}"><strong>${esc(moveText(row))}</strong><small>${esc(sources.length>1?'cross-source discovery':sourceLabel(row))}</small></div><div class="cx-discovery-scout"><span class="cx-discovery-grade ${gradeClass(g)}">${esc(g||'—')}</span><div><strong>${esc(state)}</strong><small>${esc(reason(row))}</small></div></div></button>`}
function sorted(data){return [...data].sort((a,b)=>(scoreOf(b)??-1)-(scoreOf(a)??-1)||sourceNames(b).length-sourceNames(a).length||Number(Object.keys(evaluation(b)).length>0)-Number(Object.keys(evaluation(a)).length>0)||Math.abs(moveOf(b)||0)-Math.abs(moveOf(a)||0)||new Date(b.captured_at||0)-new Date(a.captured_at||0))}
function summaryMarkup(filtered){const rated=rows.filter(r=>gradeOf(r)).length,top=rows.filter(r=>['A','B'].includes(gradeOf(r))||(scoreOf(r)!=null&&scoreOf(r)>=70)).length,unresolved=rows.filter(r=>!resolvedIdentity(r)).length,ready=rows.filter(r=>!gradeOf(r)&&Object.keys(evaluation(r)).length>0).length;return `<div class="cx-discovery-intro"><div><span class="cx-discovery-kicker">Discovery queue</span><h3>Cards worth a second look</h3><p>External movers nominate cards for investigation. Collectish resolves the printing, reuses any canonical Scout grade, and prefetches pricing, vendor, and sales context when a card is outside current Scout scan coverage. External movement never changes the grade.</p></div><div class="cx-discovery-metrics"><div><strong>${rows.length}</strong><small>unique cards</small></div><div><strong>${top}</strong><small>Scout A/B</small></div><div><strong>${rated}</strong><small>rated</small></div><div><strong>${ready}</strong><small>data ready</small></div></div></div><div class="cx-discovery-toolbar"><div class="cx-discovery-filters">${[['all','All'],['top','A/B first'],['rated','Rated'],['ready','Data ready'],['unrated','No grade'],['unresolved','Needs lookup'],['up','Up'],['down','Down']].map(([k,l])=>`<button type="button" data-discovery-filter="${k}" class="${filter===k?'active':''}">${l}</button>`).join('')}</div><input id="cxDiscoverySearch" type="search" value="${esc(query)}" placeholder="Find card, set, or source…" aria-label="Search discovery candidates"></div>${unresolved?`<div class="cx-discovery-note">${unresolved} candidate${unresolved===1?'':'s'} could not yet be resolved to a printing. “Data ready” means Scout inputs were prefetched, but Collectish will not invent a grade without canonical scan coverage.</div>`:''}<div class="cx-discovery-list">${filtered.length?sorted(filtered).map(rowMarkup).join(''):'<div class="cx-empty">No discovery candidates match this view.</div>'}</div>`}

export async function loadDiscovery(force=false){if(loading&&!force)return loading;loading=Promise.all([
  rest('source_captures?select=capture_id,source_key,captured_at,payload_json,metadata_json&source=eq.MTGStocks&capture_type=eq.discovery_candidate&order=captured_at.desc&limit=250'),
  rest('market_intel_items?select=intel_id,source_name,source_url,title,summary,direction,observed_at,market_intel_entities(entity_name,scryfall_id,product_id,set_code)&source_name=eq.MTGGoldfish&order=observed_at.desc&limit=160').catch(()=>[])
]).then(async([stocks,goldfish])=>{const combined=[...latestMtgStocks(Array.isArray(stocks)?stocks:[]),...mtgGoldfishRows(Array.isArray(goldfish)?goldfish:[])];await autoResolve(combined);rows=mergeCandidates(combined);return rows}).finally(()=>{loading=null});return loading}
export function renderDiscovery(host){if(!host)return;const filtered=rows.filter(matchesFilter).filter(matchesQuery);host.innerHTML=summaryMarkup(filtered)}
export function setDiscoveryFilter(next){filter=next||'all'}
export function setDiscoveryQuery(next){query=String(next||'')}
export function getDiscoveryState(){return{rows,filter,query}}
