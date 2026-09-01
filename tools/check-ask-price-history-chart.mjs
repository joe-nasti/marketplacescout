import fs from 'node:fs';
const src=fs.readFileSync('src/modules/ask/structured-surfaces.js','utf8');
for (const token of [
  'historyCoverage',
  'cx-ask-history-y-label',
  'cx-ask-history-x-label',
  'cx-ask-history-point',
  'observed_at',
  'collector_number',
  'requested',
  'stored coverage',
  'aria-label'
]) {
  if (!src.includes(token)) throw new Error(`missing labeled price-history chart token: ${token}`);
}
console.log('Ask price-history chart labeling guard passed');
