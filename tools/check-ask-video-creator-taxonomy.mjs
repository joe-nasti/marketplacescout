import fs from 'node:fs';
const web=fs.readFileSync('supabase/functions/ask-collectish-web-research/index.ts','utf8');
for(const token of [
  'creatorContext',
  'attention_impact',
  'evidence_quality',
  'timing_role',
  'competitive_testing',
  'finance_speculation',
  'general_mtg',
  'crossover_ip',
  'originator',
  'amplifier',
  'late_commentary',
  'clickbait',
  'take it with a grain of salt',
  'creator_context_counts'
]) if(!web.includes(token)) throw new Error(`missing creator taxonomy contract: ${token}`);
if(!/Standard, Pioneer, Modern, Legacy, Vintage, Pauper and cEDH/.test(web)) throw new Error('competitive format coverage missing');
if(!/one clickbait finance creator alone must not upgrade causation to CONFIRMED/.test(web)) throw new Error('finance confirmation guard missing');
if(!/ATTENTION IMPACT/.test(web)||!/EVIDENCE QUALITY/.test(web)) throw new Error('attention and evidence quality must remain separate');
console.log('Ask video creator taxonomy contract passed');
