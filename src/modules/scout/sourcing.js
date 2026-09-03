const finite=n=>n!=null&&n!==''&&Number.isFinite(Number(n))?Number(n):null;
const positive=n=>{const v=finite(n);return v!=null&&v>0?v:null};
const firstPositive=(...values)=>{for(const value of values){const v=positive(value);if(v!=null)return v}return null};
const firstValue=(...values)=>values.find(v=>v!=null&&v!=='')??null;

export const SOURCING_CHANNELS=Object.freeze({
  TCGPLAYER:'tcgplayer',
  TCGPLAYER_DIRECT:'tcgplayer_direct',
  MANAPOOL:'manapool',
  CARD_KINGDOM:'card_kingdom',
  CARDTRADER_DIRECT:'cardtrader_direct',
  CARDTRADER_ZERO:'cardtrader_zero',
  SEALED_CRACK:'sealed_crack'
});

export const SOURCING_RECOMMENDATIONS=Object.freeze({
  BUY_LOCAL:'BUY LOCAL',
  IMPORT_CT:'IMPORT CT',
  IMPORT_CT0:'IMPORT CT0',
  ADD_TO_ZERO:'ADD TO ZERO',
  WATCH_IMPORT:'WATCH IMPORT',
  STRUCTURAL_GAP:'STRUCTURAL GAP',
  CATALYST_TOO_SHORT:'CATALYST TOO SHORT',
  PASS:'PASS'
});

const CHANNEL_ALIASES=new Map([
  ['tcg',SOURCING_CHANNELS.TCGPLAYER],['tcgplayer',SOURCING_CHANNELS.TCGPLAYER],
  ['direct',SOURCING_CHANNELS.TCGPLAYER_DIRECT],['tcg_direct',SOURCING_CHANNELS.TCGPLAYER_DIRECT],['tcgplayer_direct',SOURCING_CHANNELS.TCGPLAYER_DIRECT],
  ['manapool',SOURCING_CHANNELS.MANAPOOL],['mana_pool',SOURCING_CHANNELS.MANAPOOL],
  ['ck',SOURCING_CHANNELS.CARD_KINGDOM],['card_kingdom',SOURCING_CHANNELS.CARD_KINGDOM],
  ['ct',SOURCING_CHANNELS.CARDTRADER_DIRECT],['cardtrader',SOURCING_CHANNELS.CARDTRADER_DIRECT],['cardtrader_direct',SOURCING_CHANNELS.CARDTRADER_DIRECT],
  ['ct0',SOURCING_CHANNELS.CARDTRADER_ZERO],['ct_zero',SOURCING_CHANNELS.CARDTRADER_ZERO],['cardtrader_zero',SOURCING_CHANNELS.CARDTRADER_ZERO],
  ['sealed',SOURCING_CHANNELS.SEALED_CRACK],['sealed_crack',SOURCING_CHANNELS.SEALED_CRACK]
]);

export function normalizeSourcingChannel(value){
  const key=String(value||'').trim().toLowerCase().replace(/[\s-]+/g,'_');
  return CHANNEL_ALIASES.get(key)||key||null;
}

function defaultShippingMode(channel){
  if(channel===SOURCING_CHANNELS.CARDTRADER_ZERO)return 'basket_marginal';
  if(channel===SOURCING_CHANNELS.CARDTRADER_DIRECT)return 'seller_specific';
  return 'quoted';
}

function defaultLeadDays(channel){
  if(channel===SOURCING_CHANNELS.CARDTRADER_ZERO)return {min:null,max:null,source:'required_import_assumption'};
  if(channel===SOURCING_CHANNELS.CARDTRADER_DIRECT)return {min:null,max:null,source:'required_import_assumption'};
  return {min:0,max:0,source:'local'};
}

export function normalizeAcquisitionQuote(input={}){
  const channel=normalizeSourcingChannel(input.channel||input.source||input.source_kind);
  const unitPrice=positive(input.unitPrice??input.unit_price??input.price);
  const quantity=positive(input.quantity??input.qty)??1;
  const fees=finite(input.fees??input.feeAllocation??input.fee_allocation)??0;
  const shippingAllocation=finite(input.shippingAllocation??input.shipping_allocation??input.shipping)??null;
  const fxReserve=finite(input.fxReserve??input.fx_reserve)??0;
  const dutiesReserve=finite(input.dutiesReserve??input.duties_reserve)??0;
  const conditionReserve=finite(input.conditionReserve??input.condition_reserve)??0;
  const explicitLanded=positive(input.landedUnitCost??input.landed_unit_cost);
  const isCt0=channel===SOURCING_CHANNELS.CARDTRADER_ZERO;
  const isCt=channel===SOURCING_CHANNELS.CARDTRADER_DIRECT;
  const imported=isCt0||isCt;
  const componentsComplete=unitPrice!=null&&(!imported||shippingAllocation!=null);
  const computedLanded=componentsComplete?unitPrice+fees+(shippingAllocation??0)+fxReserve+dutiesReserve+conditionReserve:null;
  const landedUnitCost=explicitLanded??computedLanded;
  const leadDefaults=defaultLeadDays(channel);
  const leadMin=finite(input.leadDaysMin??input.lead_days_min??input.estimatedLeadDaysMin)??leadDefaults.min;
  const leadMax=finite(input.leadDaysMax??input.lead_days_max??input.estimatedLeadDaysMax??input.estimatedLeadDays)??leadDefaults.max;
  const missing=[];
  if(unitPrice==null)missing.push('unit_price');
  if(imported&&shippingAllocation==null&&explicitLanded==null)missing.push(isCt0?'basket_marginal_shipping':'seller_shipping');
  if(imported&&leadMax==null)missing.push('lead_time');
  if(input.mappingConfidence==null&&input.mapping_confidence==null&&imported)missing.push('mapping_confidence');
  return {
    channel,
    sourceLabel:firstValue(input.sourceLabel,input.source_label,input.label,channel),
    unitPrice,
    quantity,
    currency:String(input.currency||'USD').toUpperCase(),
    fees,
    shippingAllocation,
    shippingMode:firstValue(input.shippingMode,input.shipping_mode,defaultShippingMode(channel)),
    fxReserve,
    dutiesReserve,
    conditionReserve,
    landedUnitCost,
    leadDaysMin:leadMin,
    leadDaysMax:leadMax,
    leadTimeSource:firstValue(input.leadTimeSource,input.lead_time_source,leadDefaults.source),
    mappingConfidence:firstValue(input.mappingConfidence,input.mapping_confidence,imported?null:'local_exact'),
    capturedAt:firstValue(input.capturedAt,input.captured_at,input.refreshed_at),
    provenance:firstValue(input.provenance,input.source_url,input.source_id),
    complete:missing.length===0&&landedUnitCost!=null,
    missing
  };
}

export function legacyAcquisitionQuotesFromScoutRow(row={}){
  const quotes=[];
  const local=firstPositive(row.cheapest_buy,row.tcg_low,row.low_with_shipping);
  if(local!=null)quotes.push(normalizeAcquisitionQuote({channel:SOURCING_CHANNELS.TCGPLAYER,unitPrice:local,landedUnitCost:local,sourceLabel:row.cheapest_source||'TCGplayer exact-printing acquisition',mappingConfidence:'local_exact',capturedAt:row.refreshed_at}));

  const ctPrice=firstPositive(row.ct_price,row.ct_low,row.cardtrader_price,row.cardtrader_low,row.cardtrader_direct_price,row.cardtrader_direct_low);
  if(ctPrice!=null)quotes.push(normalizeAcquisitionQuote({
    channel:SOURCING_CHANNELS.CARDTRADER_DIRECT,
    unitPrice:ctPrice,
    shippingAllocation:firstValue(row.ct_shipping_allocation,row.cardtrader_shipping_allocation),
    fees:firstValue(row.ct_fee_allocation,row.cardtrader_fee_allocation,0),
    fxReserve:firstValue(row.ct_fx_reserve,row.cardtrader_fx_reserve,0),
    dutiesReserve:firstValue(row.ct_duties_reserve,row.cardtrader_duties_reserve,0),
    conditionReserve:firstValue(row.ct_condition_reserve,row.cardtrader_condition_reserve,0),
    landedUnitCost:firstPositive(row.ct_landed_cost,row.cardtrader_landed_cost),
    leadDaysMin:firstValue(row.ct_lead_days_min,row.cardtrader_lead_days_min),
    leadDaysMax:firstValue(row.ct_lead_days_max,row.cardtrader_lead_days_max),
    mappingConfidence:firstValue(row.ct_mapping_confidence,row.cardtrader_mapping_confidence),
    capturedAt:firstValue(row.ct_refreshed_at,row.cardtrader_refreshed_at,row.refreshed_at),
    sourceLabel:'CardTrader'
  }));

  const ct0Price=firstPositive(row.ct0_price,row.ct0_low,row.ct_zero_price,row.cardtrader_zero_price,row.cardtrader_zero_low);
  if(ct0Price!=null)quotes.push(normalizeAcquisitionQuote({
    channel:SOURCING_CHANNELS.CARDTRADER_ZERO,
    unitPrice:ct0Price,
    shippingAllocation:firstValue(row.ct0_shipping_allocation,row.ct_zero_shipping_allocation,row.cardtrader_zero_shipping_allocation),
    fees:firstValue(row.ct0_fee_allocation,row.ct_zero_fee_allocation,row.cardtrader_zero_fee_allocation,0),
    fxReserve:firstValue(row.ct0_fx_reserve,row.ct_zero_fx_reserve,row.cardtrader_zero_fx_reserve,0),
    dutiesReserve:firstValue(row.ct0_duties_reserve,row.ct_zero_duties_reserve,row.cardtrader_zero_duties_reserve,0),
    conditionReserve:firstValue(row.ct0_condition_reserve,row.ct_zero_condition_reserve,row.cardtrader_zero_condition_reserve,0),
    landedUnitCost:firstPositive(row.ct0_landed_cost,row.ct_zero_landed_cost,row.cardtrader_zero_landed_cost),
    leadDaysMin:firstValue(row.ct0_lead_days_min,row.ct_zero_lead_days_min,row.cardtrader_zero_lead_days_min),
    leadDaysMax:firstValue(row.ct0_lead_days_max,row.ct_zero_lead_days_max,row.cardtrader_zero_lead_days_max),
    mappingConfidence:firstValue(row.ct0_mapping_confidence,row.ct_zero_mapping_confidence,row.cardtrader_zero_mapping_confidence),
    capturedAt:firstValue(row.ct0_refreshed_at,row.ct_zero_refreshed_at,row.cardtrader_zero_refreshed_at,row.refreshed_at),
    sourceLabel:'CardTrader Zero',
    shippingMode:'basket_marginal'
  }));
  return quotes;
}

export function exitQuotesFromScoutRow(row={}){
  const lanes=[
    {channel:SOURCING_CHANNELS.TCGPLAYER_DIRECT,label:'TCG Direct',net:positive(row.direct_net_est),provenance:'direct_net_est'},
    {channel:SOURCING_CHANNELS.TCGPLAYER,label:'TCG regular',net:positive(row.tcg_regular_net_est)??(positive(row.sku_market_price)!=null?Number(row.sku_market_price)*0.75:null),provenance:positive(row.tcg_regular_net_est)!=null?'tcg_regular_net_est':'legacy_market_x_0.75'},
    {channel:SOURCING_CHANNELS.CARD_KINGDOM,label:'Card Kingdom',net:positive(row.ck_buylist),provenance:'ck_buylist'},
    {channel:SOURCING_CHANNELS.MANAPOOL,label:'ManaPool',net:positive(row.manapool_net_est)??(positive(row.manapool_retail)!=null?Number(row.manapool_retail)*0.921:null),provenance:positive(row.manapool_net_est)!=null?'manapool_net_est':'legacy_retail_x_0.921'}
  ];
  return lanes.filter(x=>x.net!=null).sort((a,b)=>b.net-a.net);
}

export function bestExitQuoteFromScoutRow(row={}){return exitQuotesFromScoutRow(row)[0]||null}

function recommendationFor(acquisition,{meetsEconomics,catalystTooShort,ct0BasketOpen=false}={}){
  if(!acquisition?.complete)return acquisition?.channel===SOURCING_CHANNELS.CARDTRADER_DIRECT||acquisition?.channel===SOURCING_CHANNELS.CARDTRADER_ZERO?SOURCING_RECOMMENDATIONS.WATCH_IMPORT:SOURCING_RECOMMENDATIONS.PASS;
  if(catalystTooShort)return SOURCING_RECOMMENDATIONS.CATALYST_TOO_SHORT;
  if(!meetsEconomics)return acquisition.channel===SOURCING_CHANNELS.CARDTRADER_DIRECT||acquisition.channel===SOURCING_CHANNELS.CARDTRADER_ZERO?SOURCING_RECOMMENDATIONS.WATCH_IMPORT:SOURCING_RECOMMENDATIONS.PASS;
  if(acquisition.channel===SOURCING_CHANNELS.CARDTRADER_ZERO)return ct0BasketOpen?SOURCING_RECOMMENDATIONS.ADD_TO_ZERO:SOURCING_RECOMMENDATIONS.IMPORT_CT0;
  if(acquisition.channel===SOURCING_CHANNELS.CARDTRADER_DIRECT)return SOURCING_RECOMMENDATIONS.IMPORT_CT;
  return SOURCING_RECOMMENDATIONS.BUY_LOCAL;
}

export function buildSourcingPath(acquisitionInput,exitInput,context={}){
  const acquisition=acquisitionInput?.complete!=null?acquisitionInput:normalizeAcquisitionQuote(acquisitionInput);
  const exitNet=positive(exitInput?.net??exitInput?.netUnitValue??exitInput?.net_unit_value);
  const landed=positive(acquisition?.landedUnitCost);
  const profit=exitNet!=null&&landed!=null?exitNet-landed:null;
  const roiPct=profit!=null&&landed>0?100*profit/landed:null;
  const minRoiPct=finite(context.minRoiPct)??20;
  const minProfit=finite(context.minProfit)??1;
  const catalystWindowDays=finite(context.catalystWindowDays);
  const leadDaysMax=finite(acquisition?.leadDaysMax);
  const catalystTooShort=catalystWindowDays!=null&&leadDaysMax!=null&&catalystWindowDays<leadDaysMax;
  const meetsEconomics=profit!=null&&roiPct!=null&&profit>=minProfit&&roiPct>=minRoiPct;
  return {
    acquisition,
    exit:exitInput?{...exitInput,net:exitNet}:null,
    profitPerUnit:profit,
    roiPct,
    capitalDays:leadDaysMax,
    catalystWindowDays,
    catalystTooShort,
    meetsEconomics,
    recommendation:recommendationFor(acquisition,{meetsEconomics,catalystTooShort,ct0BasketOpen:Boolean(context.ct0BasketOpen)}),
    actionable:Boolean(acquisition?.complete&&exitNet!=null&&!catalystTooShort&&meetsEconomics),
    blockers:[...(acquisition?.missing||[]),...(exitNet==null?['exit_net']:[]),...(catalystTooShort?['catalyst_shorter_than_import_lead']:[])]
  };
}

export function structuralBasisSignal(observations=[],options={}){
  const thresholdPct=finite(options.thresholdPct)??20;
  const minPersistence=finite(options.minPersistence)??0.7;
  const valid=observations.map(o=>finite(o?.landedAdvantagePct??o?.landed_advantage_pct)).filter(v=>v!=null);
  if(!valid.length)return {recommendation:SOURCING_RECOMMENDATIONS.PASS,persistence:null,medianAdvantagePct:null,sampleSize:0};
  const sorted=[...valid].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2),median=sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
  const persistence=valid.filter(v=>v>=thresholdPct).length/valid.length;
  return {recommendation:persistence>=minPersistence&&median>=thresholdPct?SOURCING_RECOMMENDATIONS.STRUCTURAL_GAP:SOURCING_RECOMMENDATIONS.PASS,persistence,medianAdvantagePct:median,sampleSize:valid.length,thresholdPct,minPersistence};
}
