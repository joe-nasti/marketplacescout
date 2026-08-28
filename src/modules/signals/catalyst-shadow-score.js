const n=v=>Number.isFinite(Number(v))?Number(v):0;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,n(v)));
const lower=s=>String(s||'').trim().toLowerCase();

const STAGE_WEIGHT={leading:2.25,confirming:3.25,lagging:.75,neutral:0,unclassified:.25,noise:0};
const DIRECTION={bullish:1,bearish:-1,neutral:0};
const SOURCE_WEIGHT={official:1.25,article:1,youtube:1,x:.8,twitter:.8,reddit:.65,discord:.55,manual:.5,other:.5};
const SCORER_VERSION='catalyst-shadow-v1';

function hostname(value){try{return new URL(value).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}}
function sourceKey(item){return lower(hostname(item?.source_url)||item?.source_name||item?.author||item?.source_type||'unknown')}
function eventKey(item){const url=String(item?.source_url||'').replace(/[?#].*$/,'').toLowerCase();if(url)return url;return `${sourceKey(item)}|${lower(item?.title||item?.summary).slice(0,120)}`}
function ageDays(value,now=Date.now()){const t=new Date(value||0).getTime();return Number.isFinite(t)&&t>0?Math.max(0,(now-t)/86400000):30}
function recencyFactor(days){if(days<=2)return 1;if(days<=7)return .9;if(days<=21)return .7;if(days<=45)return .45;if(days<=90)return .25;return .1}
function confidenceFactor(item){const raw=item?.confidence??item?.confidence_score??null;if(raw==null)return 1;const x=n(raw);return clamp(x>1?x/100:x,.35,1)}
function signalPoints(item,now){const stage=STAGE_WEIGHT[lower(item?.signal_stage)]??.25,direction=DIRECTION[lower(item?.direction)]??0;if(!stage||!direction)return 0;const source=SOURCE_WEIGHT[lower(item?.source_type)]??.75;return stage*direction*source*recencyFactor(ageDays(item?.observed_at,now))*confidenceFactor(item)}
function gradeFor(score){const s=n(score);if(s>=80)return'A';if(s>=70)return'B';if(s>=60)return'C';if(s>=50)return'D';return'F'}
function futureRelease(row,now=Date.now()){const raw=row?.release_date||row?.released_at||row?.set_release_date;if(!raw)return false;const t=new Date(raw).getTime();return Number.isFinite(t)&&t>now}

function uniqueSignals(items=[]){const seen=new Set(),out=[];for(const item of items){const key=eventKey(item);if(!key||seen.has(key))continue;seen.add(key);out.push(item)}return out}

function scoreCatalystShadow({row,signals=[],crossSource=[],competitive=[],commander=[],cedhCards=[],now=Date.now()}={}){
  const deduped=uniqueSignals(signals),reasons=[];
  let raw=deduped.reduce((sum,item)=>sum+signalPoints(item,now),0);
  const sources=new Set(deduped.filter(x=>signalPoints(x,now)!==0).map(sourceKey).filter(Boolean));
  if(sources.size>=2){const bonus=Math.min(3,(sources.size-1)*1.25);raw+=Math.sign(raw||1)*bonus;reasons.push(`${sources.size} independent signal sources`)}
  const multi=crossSource?.[0];if(multi&&Number(multi.evidence_sources||0)>=2){const bonus=Math.min(2,Math.max(.75,(Number(multi.evidence_sources)-1)*.65));raw+=bonus;reasons.push(`${multi.evidence_sources} evidence families corroborate`)}
  const comp=competitive?.[0];if(comp&&Number(comp.deck_count_30d||0)>0){const bonus=Number(comp.top8_decks_30d||0)>0?1.5:.75;raw+=bonus;reasons.push(`${comp.deck_count_30d} competitive decks${Number(comp.top8_decks_30d||0)>0?` · ${comp.top8_decks_30d} Top 8`:''}`)}
  const edh=commander?.[0];if(edh?.watch_class==='edh_breakout'){raw+=1.25;reasons.push('EDHREC breakout confirmation')}
  const cedh=cedhCards?.[0];if(cedh?.watch_class==='cedh_breakout'){raw+=1;reasons.push('cEDH breakout confirmation')}
  const bounded=clamp(Math.round(raw),-8,12),base=n(row?.promoted_score??row?.v5_shadow_score??row?.opportunity_score),isFuture=futureRelease(row,now),applied=isFuture?0:bounded,shadow=clamp(base+applied,0,100);
  if(deduped.length){const bullish=deduped.filter(x=>lower(x.direction)==='bullish').length,bearish=deduped.filter(x=>lower(x.direction)==='bearish').length;reasons.unshift(`${deduped.length} unique catalyst${deduped.length===1?'':'s'} · ${bullish} bullish${bearish?` · ${bearish} bearish`:''}`)}
  if(isFuture)reasons.unshift('Future release · thesis tracked, no live Scout adjustment');
  const sourceKeys=[...sources].sort(),intelIds=deduped.map(x=>String(x?.intel_id||'')).filter(Boolean).sort();
  const signalTimes=deduped.map(x=>new Date(x?.observed_at||0).getTime()).filter(Number.isFinite).filter(x=>x>0),signalMaxAt=signalTimes.length?new Date(Math.max(...signalTimes)).toISOString():null;
  const catalystKey=[...deduped.map(eventKey).sort(),...sourceKeys.map(x=>`source:${x}`),multi?`multi:${Number(multi.evidence_sources||0)}`:''].filter(Boolean).join('|').slice(0,4000);
  return {baseScore:base,baseGrade:row?.promoted_grade||row?.v5_shadow_grade||gradeFor(base),rawModifier:raw,modifier:bounded,appliedModifier:applied,shadowScore:shadow,shadowGrade:gradeFor(shadow),future:isFuture,futureThesisModifier:isFuture?bounded:null,sourceCount:sources.size,signalCount:deduped.length,sourceKeys,intelIds,signalMaxAt,catalystKey,scorerVersion:SCORER_VERSION,reasons:reasons.slice(0,5)};
}

export {scoreCatalystShadow,gradeFor,uniqueSignals,sourceKey,eventKey,SCORER_VERSION};
