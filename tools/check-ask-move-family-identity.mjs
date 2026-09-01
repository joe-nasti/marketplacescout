import fs from 'node:fs';
const src=fs.readFileSync('supabase/functions/ask-collectish-identity-recovery/index.ts','utf8');
for(const token of ['preferredMoveProduct','market_intel_items','source_name=eq.MTGStocks','move_selection','move.metric===\'market\'','finishBonus']){
  if(!src.includes(token))throw new Error(`missing move-family identity token: ${token}`);
}
if(!/i\.move&&ids\.length>1&&lookupRows\.length/.test(src))throw new Error('ambiguous move families are not evidence-disambiguated');
if(!/ids=\[move_selection\.product_id\]/.test(src))throw new Error('selected move product is not narrowed before recovery');
console.log('Ask move-family identity guard passed');
