import fs from 'node:fs';
const src=fs.readFileSync('supabase/functions/ask-collectish-identity-recovery/index.ts','utf8');
for(const token of ['preferredMoveProduct','market_intel_items','source_name=eq.MTGStocks','move_selection','move.metric===\'market\'','finishBonus','storedMoveFallback','stored_family_lookup','evidenceAwareFallback','ask_collectish_public_internal_sku_evidence_v1','ask_card_price_history_v1','shared_internal_sku_evidence','official_price_history','marketAlias','namedMarket']){
  if(!src.includes(token))throw new Error(`missing move-family identity token: ${token}`);
}
if(!/if\(\(i\.move\|\|i\.namedMarket\)&&lookupRows\.length\)/.test(src))throw new Error('move and named-market families are not evidence-disambiguated');
if(!/move_selection=i\.move\?await preferredMoveProduct\(t,lookupRows\):null;if\(!move_selection\)move_selection=await evidenceAwareFallback\(t,lookupRows\)/.test(src))throw new Error('identity fallback must rank shared evidence before catalog order');
if(!/if\(best&&best\.score>0\).*shared_internal_sku_evidence/.test(src))throw new Error('shared market evidence must outrank arbitrary same-name printing order');
if(!/price_point_count/.test(src))throw new Error('official price-history coverage must remain an evidence fallback');
if(!/\^\(\?:is\|are\).*supply/.test(src)||!/Boolean\(namedMarket\)/.test(src))throw new Error('named supply/sales/demand questions must trigger identity recovery');
if(!/if\(i\.move\|\|i\.namedMarket\)\{return js\(\{ok:true,recovered:Boolean\(move_selection\|\|lookupRows\.length\|\|ids\.length\)/.test(src))throw new Error('named market recovery does not accept resolved identity immediately');
const marketBranch=src.match(/if\(i\.move\|\|i\.namedMarket\)\{return js\([\s\S]*?\)\}\nif\(!ids\.length\)/)?.[0]||'';
if(!marketBranch)throw new Error('could not isolate immediate identity recovery branch');
if(/discover\(/.test(marketBranch))throw new Error('causal/named-market identity recovery must not depend on SKU discovery');
if(!/lookup_candidates/.test(marketBranch))throw new Error('identity candidates must remain available for downstream fallback');
console.log('Ask move-family and named-market identity guard passed');
