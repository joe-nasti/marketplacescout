import store from '../../state/store.js';
import {rest} from '../../core/rest.js';
import {scoreCatalystShadow} from '../signals/catalyst-shadow-score.js';

const lower=s=>String(s||'').trim().toLowerCase();
const baseName=s=>String(s||'').replace(/\s*\([^)]*(foil|showcase|borderless|extended art|serialized|retro frame|etched|alternate art|halo foil|rainbow foil|surge foil|galaxy foil)[^)]*\)\s*/ig,' ').replace(/\s+/g,' ').trim();
let timer=null,running=false,lastRunAt=0;

function scoutRows(){return Array.isArray(store.get().scout?.rows)?store.get().scout.rows:[]}
function intelItems(){return Array.isArray(store.get().intel?.items)?store.get().intel.items:[]}
function crossSourceRows(){return Array.isArray(store.get().intel?.crossSourceRows)?store.get().intel.crossSourceRows:[]}
function matches(item,row){
  if(!item||!row)return false;
  const sku=String(row.sku_id||''),pid=String(row.product_id||''),sf=String(row.scryfall_id||''),name=lower(baseName(row.product_name));
  const entities=Array.isArray(item.market_intel_entities)?item.market_intel_entities:[];
  if(entities.some(e=>(sku&&String(e.sku_id||'')===sku)||(pid&&String(e.product_id||'')===pid)||(sf&&String(e.scryfall_id||'')===sf)||lower(baseName(e.entity_name))===name))return true;
  const mentions=Array.isArray(item.market_intel_card_mentions)?item.market_intel_card_mentions:[];
  return mentions.some(m=>(sf&&String(m.scryfall_id||'')===sf)||lower(baseName(m.card_name))===name);
}
function crossSourceFor(row){const sku=String(row?.sku_id||''),pid=String(row?.product_id||''),name=lower(baseName(row?.product_name));return crossSourceRows().filter(x=>(sku&&String(x.sku_id||'')===sku)||(pid&&String(x.product_id||'')===pid)||lower(baseName(x.card_name))===name)}
function payloadFor(row,signals){
  const shadow=scoreCatalystShadow({row,signals,crossSource:crossSourceFor(row)});
  if(!shadow.catalystKey||(!shadow.signalCount&&!crossSourceFor(row).length))return null;
  return {
    sku_id:Number(row.sku_id),
    product_id:row.product_id==null?null:Number(row.product_id),
    scryfall_id:row.scryfall_id||null,
    card_name:String(row.product_name||'Unknown card'),
    official_score:shadow.baseScore,
    official_grade:shadow.baseGrade||null,
    shadow_modifier:shadow.appliedModifier,
    shadow_score:shadow.shadowScore,
    shadow_grade:shadow.shadowGrade||null,
    raw_modifier:shadow.rawModifier,
    future_release:Boolean(shadow.future),
    future_thesis_modifier:shadow.futureThesisModifier,
    independent_sources:shadow.sourceCount,
    unique_events:shadow.signalCount,
    source_keys:shadow.sourceKeys,
    intel_ids:shadow.intelIds,
    catalyst_key:shadow.catalystKey,
    scorer_version:shadow.scorerVersion,
    signal_max_at:shadow.signalMaxAt
  };
}
async function record(){
  if(running)return;running=true;
  try{
    const signals=intelItems(),rows=scoutRows();if(!signals.length||!rows.length)return;
    const payload=[];
    for(const row of rows){const linked=signals.filter(item=>matches(item,row));if(!linked.length&&!crossSourceFor(row).length)continue;const item=payloadFor(row,linked);if(item)payload.push(item)}
    if(!payload.length)return;
    for(let i=0;i<payload.length;i+=100){await rest('market_intel_catalyst_shadow_snapshots',{method:'POST',prefer:'resolution=ignore-duplicates,return=minimal',body:payload.slice(i,i+100)}).catch(()=>null)}
    lastRunAt=Date.now();
    document.dispatchEvent(new CustomEvent('collectish:catalyst-shadow-recorded',{detail:{count:payload.length,capturedAt:lastRunAt}}));
  }finally{running=false}
}
function schedule(delay=500){clearTimeout(timer);timer=setTimeout(()=>void record(),delay)}

for(const event of ['collectish:intel-changed','collectish:cross-source-changed','collectish:scout-list-rendered'])document.addEventListener(event,()=>schedule());
document.addEventListener('collectish:page-change',e=>{if(e.detail?.page==='scout'&&Date.now()-lastRunAt>5*60*1000)schedule(900)});

window.CollectishCatalystShadowRecorder={record,schedule};
