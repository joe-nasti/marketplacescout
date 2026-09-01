import fs from 'node:fs';
const src=fs.readFileSync('src/modules/ask/structured-surfaces.js','utf8');
const router=fs.readFileSync('supabase/functions/ask-collectish-route-intents/index.ts','utf8');
for (const token of [
  'historyCoverage',
  'cx-ask-history-y-label',
  'cx-ask-history-x-label',
  'cx-ask-history-point',
  'observed_at',
  'collector_number',
  'requested',
  'stored coverage',
  'aria-label',
  'niceStep',
  'tickLo',
  'tickHi'
]) {
  if (!src.includes(token)) throw new Error(`missing labeled price-history chart token: ${token}`);
}
if (!router.includes('across ${coverage} (${x.days}d requested)')) throw new Error('history answer must describe stored coverage plus requested window');
if (router.includes("over the last ${x.days} days")) throw new Error('history answer must not imply the requested window equals stored coverage');
console.log('Ask price-history chart labeling guard passed');