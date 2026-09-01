import { rest as baseRest } from '../../core/rest.js';
import store from '../../state/store.js';
import { readPersistentResource, writePersistentResource } from '../../state/persistent-cache.js';

export const SCOUT_LIST_FIELDS=[
  'sku_id','product_id','product_name','set_name','set_code','collector_number','scryfall_id',
  'printing','condition','language','promoted_score','promoted_grade','ranking_score','ranking_grade','actionability_status','actionability_shadow_grade',
  'v5_shadow_score','v5_shadow_grade','opportunity_score','tcg_low','sku_market_price','direct_low','ck_buylist','direct_backed','near_direct_backed',
  'buylist_backed','source_verify','observation_count','v5_computed_at','computed_at','sales_rank','avg_daily_qty_sold'
].join(',');
export const SCOUT_LIST_CACHE_PATH=`scout_opportunities_actionability_ranked?select=${SCOUT_LIST_FIELDS}&order=ranking_score.desc,observation_count.desc&limit=500`;
export const SCOUT_LIST_LIVE_PATH=`scout_opportunities_v5?select=${SCOUT_LIST_FIELDS.replace(',ranking_score,ranking_grade,actionability_status,actionability_shadow_grade','')}&order=promoted_score.desc,observation_count.desc&limit=500`;
export const SCOUT_LIVE_PATH='scout_opportunities_v5?select=*&order=promoted_score.desc,observation_count.desc&limit=500';
export const SCOUT_CACHE_PATH='scout_opportunities_v5_cache?select=*&order=promoted_score.desc,observation_count.desc&limit=500';

const KEY='collectishRuntimeHealth';
const REUSE_MS=4000;
const PERSISTED_FRESH_MS=5*60*1000;
let inFlight=null,lastRows=null,lastAt=0,persistedChecked=false;
const detailCache=new Map();
const detailInflight=new Map();
const oracleName=s=>String(s||'').replace(/\s*\([^)]*(foil|showcase|borderless|extended art|serialized|retro frame|etched|alternate art|halo foil|rainbow foil|surge foil|galaxy foil|fracture foil)[^)]*\)\s*/ig,' ').replace(/\s+/g,' ').trim();

function health(patch){
  window.COLLECTISH_RUNTIME_HEALTH={...(window.COLLECTISH_RUNTIME_HEALTH||{}),...patch};
  try{
    const old=JSON.parse(sessionStorage.getItem(KEY)||'{}');
    sessionStorage.setItem(KEY,JSON.stringify({...old,...patch}));
  }catch{}
  document.dispatchEvent(new CustomEvent('collectish:runtime-health',{detail:patch}));
}

function persistentKey(){
  const userId=store.get()?.session?.user?.id||'anonymous';
  return `user:${userId}:scout.rows.actionability-v1`;
}

function freshRows(record){
  const age=record?Date.now()-Number(record.fetchedAt||0):Infinity;
  return Array.isArray(record?.data)&&record.data.length&&age<=PERSISTED_FRESH_MS?{rows:record.data,age}:null;
}

async function readRecentPersisted(){
  if(persistedChecked)return null;
  persistedChecked=true;
  const started=performance.now();

  const primed=freshRows(store.get()?.resources?.['scout.rows.actionability-v1']);
  if(primed){
    health({scout_persisted_used:true,scout_persisted_source:'primed-store',scout_persisted_age_ms:Math.round(primed.age),scout_persisted_read_ms:Math.round(performance.now()-started)});
    return primed.rows;
  }

  try{
    const record=await readPersistentResource(persistentKey());
    const cached=freshRows(record);
    if(cached){
      health({scout_persisted_used:true,scout_persisted_source:'indexeddb',scout_persisted_age_ms:Math.round(cached.age),scout_persisted_read_ms:Math.round(performance.now()-started)});
      return cached.rows;
    }
  }catch{}
  health({scout_persisted_used:false,scout_persisted_read_ms:Math.round(performance.now()-started)});
  return null;
}

function persistRows(rows){
  if(!Array.isArray(rows)||!rows.length)return;
  void writePersistentResource(persistentKey(),rows,{fetchedAt:Date.now()}).catch(()=>{});
}

export async function readScoutRankings(options={}){
  const now=performance.now();
  if(lastRows&&now-lastAt<REUSE_MS){
    health({scout_read_reused:Number(window.COLLECTISH_RUNTIME_HEALTH?.scout_read_reused||0)+1});
    return lastRows;
  }
  if(inFlight){
    health({scout_read_coalesced:Number(window.COLLECTISH_RUNTIME_HEALTH?.scout_read_coalesced||0)+1});
    return inFlight;
  }

  const persisted=await readRecentPersisted();
  if(persisted){lastRows=persisted;lastAt=performance.now();return persisted}

  inFlight=(async()=>{
    const t0=performance.now();
    try{
      const rows=await baseRest(SCOUT_LIST_CACHE_PATH,options);
      if(Array.isArray(rows)&&rows.length){
        health({scout_cache_used:true,scout_cache_fallback:false,scout_actionability_ranked:true,scout_cache_read_ms:Math.round(performance.now()-t0),scout_list_rows:rows.length});
        persistRows(rows);return rows;
      }
    }catch{}
    const rows=await baseRest(SCOUT_LIST_LIVE_PATH,options);
    health({scout_cache_used:false,scout_cache_fallback:true,scout_actionability_ranked:false,scout_cache_read_ms:Math.round(performance.now()-t0),scout_list_rows:Array.isArray(rows)?rows.length:0});
    persistRows(rows);return rows;
  })().then(rows=>{lastRows=rows;lastAt=performance.now();return rows}).finally(()=>{inFlight=null});
  return inFlight;
}

function detailKey(row){return String(row?.sku_id||row?.product_id||'')}
function detailPath(table,row){
  const sku=String(row?.sku_id||'');
  if(sku)return `${table}?select=*&sku_id=eq.${encodeURIComponent(sku)}&limit=1`;
  return `${table}?select=*&product_id=eq.${encodeURIComponent(row?.product_id||'')}&limit=1`;
}

async function enrichCanonicalEdhrec(detail){
  if(Number(detail?.edhrec_rank||0)>0)return detail;
  const cardName=oracleName(detail?.product_name);if(!cardName)return detail;
  try{
    const rows=await baseRest('rpc/scout_canonical_edhrec_rank',{method:'POST',body:{p_card_name:cardName}});
    const rank=Number(rows?.[0]?.edhrec_rank||0);
    if(rank>0){
      health({scout_edhrec_canonical_hit:true});
      return {...detail,edhrec_rank:rank,edhrec_observed_at:rows[0]?.observed_at||detail.edhrec_observed_at||null};
    }
  }catch{}
  health({scout_edhrec_canonical_hit:false});
  return detail;
}

export async function readScoutDetail(row){
  const key=detailKey(row);if(!key)return row||null;
  if(detailCache.has(key))return detailCache.get(key);
  if(detailInflight.has(key))return detailInflight.get(key);
  const started=performance.now();
  const job=(async()=>{
    let detail=null;
    try{const x=await baseRest(detailPath('scout_opportunities_v5_cache',row));detail=Array.isArray(x)?x[0]||null:null}catch{}
    if(!detail){const x=await baseRest(detailPath('scout_opportunities_v5',row));detail=Array.isArray(x)?x[0]||null:null}
    const merged=await enrichCanonicalEdhrec({...(row||{}),...(detail||{})});
    detailCache.set(key,merged);
    health({scout_detail_read_ms:Math.round(performance.now()-started),scout_detail_reads:Number(window.COLLECTISH_RUNTIME_HEALTH?.scout_detail_reads||0)+1});
    return merged;
  })().finally(()=>detailInflight.delete(key));
  detailInflight.set(key,job);return job;
}

export async function scoutAwareRest(path,options={}){
  const method=String(options?.method||'GET').toUpperCase();
  if(method==='GET'&&(path===SCOUT_LIVE_PATH||path===SCOUT_LIST_LIVE_PATH))return readScoutRankings(options);
  return baseRest(path,options);
}

export function installScoutCacheBridge(){
  scoutAwareRest.__cxScoutCache=true;scoutAwareRest.__cxBase=baseRest;
  window.rest=scoutAwareRest;
  window.CollectishScoutData={readRankings:readScoutRankings,readDetail:readScoutDetail,rest:scoutAwareRest,listPath:SCOUT_LIST_LIVE_PATH};
}
