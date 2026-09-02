import fs from 'node:fs';
const web=fs.readFileSync('supabase/functions/ask-collectish-web-research/index.ts','utf8');
const sharedSignals=fs.readFileSync('supabase/migrations/20260901164500_share_mtgstocks_signals_with_authenticated_clients.sql','utf8');
const timeline=fs.readFileSync('supabase/migrations/20260902044000_ask_timeline_mtgstocks_fallback_anchor.sql','utf8');
for(const token of [
  'market_linkage','market_linking_source_count','causal_assessment','catalyst_status','catalyst_confidence','attention_plausibility','family_move_confirmation','familyMoveEvidence',
  "catalyst_status='INFERRED'","catalyst_status='CONFIRMED'","catalyst_status='UNRESOLVED'",'Pre-consensus card-specific catalyst','first_observed_at','delta>=-21&&delta<=3',
  'older events are background only','no_relevant_sources:true',"return'Video'",'creatorContext','creatorSignals','attention_impact','evidence_quality','featured_commander','meaningful_performance',
  'creator_attention_event_count','dedicated Collectish MTG creator-discovery pass','competitive playtesting','finance/speculation','originator','amplifier','credibleLinked','nonFinanceLinked',
  'specificLinked','generic_release_context','specific_event_score','card_specific_event_count','generic_context_event_count'
]) if(!web.includes(token))throw new Error(`missing catalyst evidence token: ${token}`);
if(/market_linking_source_count===0\)\{answer=`Causal confidence: LOW/.test(web))throw new Error('explicit market linkage must not be a hard veto on inferred catalysts');
if(!/if\(specificLinked\.length\)\{catalyst_status='CONFIRMED'/.test(web))throw new Error('card-specific credible linkage must remain the confirmation path');
if(/if\(nonFinanceLinked\.length\|\|credibleLinked\.length>=2\)\{catalyst_status='CONFIRMED'/.test(web))throw new Error('generic linked evidence must not independently confirm causation');
if(!/distinct_printings/.test(web)||!/MTGStocks/.test(web))throw new Error('family-level coordinated move evidence must inform inferred catalysts');
if(!/event_confidence/.test(web)||!/timing_strength/.test(web))throw new Error('event confidence and timing strength must remain separate');
if(!/attention impact separately from evidence quality/i.test(web))throw new Error('creator attention impact and evidence quality must remain separate');
if(!/clickbait finance\/speculation/.test(web))throw new Error('finance creator confirmation guard missing');
for(const token of ['market_intel_items_shared_mtgstocks_read','to authenticated',"source_name='MTGStocks'"]) if(!sharedSignals.includes(token)) throw new Error(`missing shared MTGStocks scorecard contract: ${token}`);
for(const token of ["version','v3_shared_history_mtgstocks_anchor'","source_name='MTGStocks'","order by i.observed_at asc","'fallback_anchor',true"]) if(!timeline.includes(token)) throw new Error(`missing current-move timing anchor contract: ${token}`);
console.log('Ask inferred/confirmed catalyst evidence contract passed');
