import fs from 'node:fs';
const web=fs.readFileSync('supabase/functions/ask-collectish-web-research/index.ts','utf8');
for (const token of [
  'generic_release_context',
  'specific_event_score',
  'card_specific_event_count',
  'generic_context_event_count',
  'specificLinked',
  'specific-event precedence',
  'broad release context',
  'cannot independently confirm'
]) if (!web.includes(token)) throw new Error(`missing causal specificity precedence token: ${token}`);
if (!/specificLinked\.length/.test(web)) throw new Error('confirmation must depend on specific linked evidence');
if (/if\(nonFinanceLinked\.length\|\|credibleLinked\.length>=2\)\{catalyst_status='CONFIRMED'/.test(web)) throw new Error('generic linked sources must not independently confirm causation');
console.log('Ask causal specificity precedence contract passed');
