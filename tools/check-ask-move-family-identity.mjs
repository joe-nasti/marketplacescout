import fs from 'node:fs';
const src=fs.readFileSync('supabase/functions/ask-collectish-identity-recovery/index.ts','utf8');
for(const token of ['preferredMoveProduct','market_intel_items','source_name=eq.MTGStocks','move_selection','move.metric===\'market\'','finishBonus','storedMoveFallback','stored_family_lookup']){
  if(!src.includes(token))throw new Error(`missing move-family identity token: ${token}`);
}
if(!/if\(i\.move&&lookupRows\.length\)/.test(src))throw new Error('move families are not evidence-disambiguated');
if(!/if\(i\.move\)\{return js\(\{ok:true,recovered:Boolean\(move_selection\|\|lookupRows\.length\|\|ids\.length\)/.test(src))throw new Error('causal recovery does not accept stored identity immediately');
const moveBranch=src.match(/if\(i\.move\)\{return js\([\s\S]*?\)\}\nif\(!ids\.length\)/)?.[0]||'';
if(!moveBranch)throw new Error('could not isolate causal recovery branch');
if(/discover\(/.test(moveBranch))throw new Error('causal identity recovery must not depend on SKU discovery');
if(!/lookup_candidates/.test(moveBranch))throw new Error('causal family candidates must remain available for downstream fallback');
console.log('Ask move-family identity guard passed');
