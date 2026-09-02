import fs from 'node:fs';
const web=fs.readFileSync('supabase/functions/ask-collectish-web-research/index.ts','utf8');
for(const token of [
  'creatorContext','creatorSignals','attention_impact','evidence_quality','timing_role','competitive_testing','finance_speculation','general_mtg','crossover_ip','originator','amplifier','late_commentary','clickbait','clickbaitFlag','credibleLinked','nonFinanceLinked','specificLinked','creator_context_counts'
]) if(!web.includes(token)) throw new Error(`missing creator taxonomy contract: ${token}`);
if(!/modern\|pioneer\|standard\|legacy\|vintage\|pauper\|cedh/.test(web)) throw new Error('competitive format coverage missing');
if(!/context==='finance_speculation'/.test(web)||!/evidence_quality=Math\.min\(evidence_quality,.35\)/.test(web)) throw new Error('finance/clickbait evidence discount missing');
if(!/if\(specificLinked\.length\)\{catalyst_status='CONFIRMED'/.test(web)) throw new Error('confirmation must require card-specific non-finance linked evidence');
if(!/attention impact separately from evidence quality/i.test(web)) throw new Error('attention and evidence quality must remain separate');
console.log('Ask video creator taxonomy contract passed');
