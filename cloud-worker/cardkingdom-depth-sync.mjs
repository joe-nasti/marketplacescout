// Card Kingdom v2 full-feed sync. Stores current printing/condition supply and
// condition-agnostic buylist capacity; a DB trigger records change-only history.
import {beginRun,finishRun,money,now,observation,qty,rest,sha,upsert} from './vendor-depth-lib.mjs';

const ENDPOINT=process.env.CARDKINGDOM_PRICELIST_URL||'https://api.cardkingdom.com/api/v2/pricelist';
const observedAt=now();
const conditionMap=[['NM','nm'],['EX','ex'],['VG','vg'],['G','g']];
const text=value=>value==null?null:String(value);
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''))?String(value):null;
const finish=row=>/etched/i.test(String(row.variation||''))?'etched':String(row.is_foil).toLowerCase()==='true'?'foil':'nonfoil';

function sourceItemKey(row){return String(row.id)}
function obsKey(row,lane,condition){return `${row.id}:${lane}:${condition}`}

async function mtgjsonMap(){
  const map=new Map();let offset=0;
  for(;;){
    const page=await rest(`mtgjson_cards?select=uuid,scryfall_id&scryfall_id=not.is.null&limit=1000&offset=${offset}`)||[];
    for(const row of page)map.set(String(row.scryfall_id),row.uuid);
    if(page.length<1000)break;
    offset+=1000;
  }
  return map;
}

const run=await beginRun('cardkingdom',ENDPOINT,observedAt,{semantic_contract:'ck-v2-validated-2026-09-02'});
try{
  const response=await fetch(ENDPOINT,{headers:{Accept:'application/json','User-Agent':'Collectish-CardKingdom-Depth/1.0'}});
  if(!response.ok)throw new Error(`Card Kingdom ${response.status}: ${(await response.text()).slice(0,500)}`);
  const raw=await response.text();const doc=JSON.parse(raw);const rows=Array.isArray(doc.data)?doc.data:[];
  if(!rows.length)throw new Error('Card Kingdom returned no price-list rows');
  const identityByScryfall=await mtgjsonMap();
  let sumMatches=0;
  const identities=[];const observations=[];
  for(const row of rows){
    const item=sourceItemKey(row),f=finish(row),cv=row.condition_values||{};
    const retailTotal=conditionMap.reduce((n,[,prefix])=>n+Number(cv[`${prefix}_qty`]||0),0);
    if(retailTotal===Number(row.qty_retail||0))sumMatches++;
    identities.push({
      source:'cardkingdom',source_item_key:item,source_product_id:text(row.id),source_sku:text(row.sku),
      mtgjson_uuid:identityByScryfall.get(String(row.scryfall_id))||null,scryfall_id:uuid(row.scryfall_id),
      card_name:text(row.name),set_name:text(row.edition),variation:text(row.variation),finish:f,language:'EN',
      product_url:row.url?new URL(row.url,doc.meta?.base_url||'https://www.cardkingdom.com/').toString():null,
      first_seen_at:observedAt,last_seen_at:observedAt,source_updated_at:observedAt,
      identity_detail:{is_foil:row.is_foil,retail_total:qty(row.qty_retail),condition_values:cv}
    });
    for(const [condition,prefix] of conditionMap){
      const price=money(cv[`${prefix}_price`]),quantity=qty(cv[`${prefix}_qty`]);
      observations.push(observation({
        source:'cardkingdom',observation_key:obsKey(row,'retail_supply',condition),source_item_key:item,
        lane:'retail_supply',condition,finish:f,language:'EN',price,quantity,listing_count:quantity>0?1:0,threshold_price:null,
        measurement_scope:'exact_printing_finish_condition_owned_stock',count_quality:'exact',is_executable:Boolean(price>0&&quantity>0),
        source_as_of:null,source_as_of_raw:text(doc.meta?.created_at),observed_at:observedAt,first_seen_at:observedAt,last_changed_at:observedAt,run_id:run.id,
        detail:{quantity_field:`condition_values.${prefix}_qty`,price_field:`condition_values.${prefix}_price`}
      }));
    }
    const buyPrice=money(row.price_buy),buyQty=qty(row.qty_buying);
    observations.push(observation({
      source:'cardkingdom',observation_key:obsKey(row,'buylist_demand','ALL'),source_item_key:item,
      lane:'buylist_demand',condition:'ALL',finish:f,language:'EN',price:buyPrice,quantity:buyQty,listing_count:null,threshold_price:null,
      measurement_scope:'exact_printing_finish_condition_unspecified_remaining_acceptance',count_quality:'exact',is_executable:Boolean(buyPrice>0&&buyQty>0),
      source_as_of:null,source_as_of_raw:text(doc.meta?.created_at),observed_at:observedAt,first_seen_at:observedAt,last_changed_at:observedAt,run_id:run.id,
      detail:{quantity_field:'qty_buying',price_field:'price_buy',condition_scope:'not_exposed_by_source'}
    }));
  }
  if(sumMatches!==rows.length)throw new Error(`Card Kingdom retail condition invariant failed: ${sumMatches}/${rows.length}`);
  await upsert('vendor_item_identities',identities,'source,source_item_key');
  await upsert('vendor_depth_current',observations,'source,observation_key');
  await finishRun(run.id,{status:'complete',source_as_of_raw:text(doc.meta?.created_at),row_count:rows.length,changed_count:null,payload_sha256:sha(raw),
    detail:{semantic_contract:'ck-v2-validated-2026-09-02',observations:observations.length,condition_quantity_sum_matches:sumMatches,
      source_timestamp_note:'Card Kingdom omits timezone; retained verbatim and not coerced to UTC'}});
  console.log(JSON.stringify({ok:true,rows:rows.length,observations:observations.length,conditionQuantityInvariant:true,sourceAsOfRaw:doc.meta?.created_at}));
}catch(error){
  await finishRun(run.id,{status:'failed',detail:{error:String(error?.stack||error)}}).catch(()=>null);
  throw error;
}
