import fs from 'node:fs';
const web=fs.readFileSync('supabase/functions/ask-collectish-web-research/index.ts','utf8');
for(const token of [
  'market_linkage',
  'market_linking_source_count',
  'causal_assessment',
  'catalyst_status',
  'catalyst_confidence',
  'attention_plausibility',
  'family_move_confirmation',
  'familyMoveEvidence',
  "catalyst_status='INFERRED'",
  "catalyst_status='CONFIRMED'",
  'Pre-consensus attention catalyst'
]){
  if(!web.includes(token))throw new Error(`missing catalyst evidence token: ${token}`);
}
if(/market_linking_source_count===0\)\{answer=`Causal confidence: LOW/.test(web))throw new Error('explicit market linkage must not be a hard veto on inferred catalysts');
if(!/Explicit MTG buying\/buyout\/demand commentary upgrades an inference to CONFIRMED; it is not a prerequisite/.test(web))throw new Error('research prompt must treat explicit commentary as confirmation, not prerequisite');
if(!/distinct_printings/.test(web)||!/MTGStocks/.test(web))throw new Error('family-level coordinated move evidence must inform inferred catalysts');
if(!/event_confidence/.test(web)||!/timing_strength/.test(web))throw new Error('event confidence and timing strength must remain separate');
console.log('Ask inferred/confirmed catalyst evidence contract passed');
