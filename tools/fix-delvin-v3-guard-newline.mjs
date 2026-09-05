import fs from 'node:fs';
const p='tools/check-ask-market-wide-supply.mjs';
let s=fs.readFileSync(p,'utf8');
const bad=");\\nif(!/explicitRow/.test(presenter))";
const good=");\nif(!/explicitRow/.test(presenter))";
if(!s.includes(bad)) throw new Error('literal newline bug not found');
s=s.replace(bad,good);
fs.writeFileSync(p,s);
console.log('fixed guard newline');
