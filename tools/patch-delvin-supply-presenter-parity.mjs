import fs from 'node:fs';
const p='cloud-worker/discord-shared-delvin-route.mjs';
let s=fs.readFileSync(p,'utf8');
const re=/async function polishSupplyResponse\(env,d\)\{[\s\S]*?\}async function route\(env,q\)\{/;
if(!re.test(s)) throw new Error('polishSupplyResponse anchor not found');
s=s.replace(re,"async function polishSupplyResponse(env,d){return d}async function route(env,q){");
fs.writeFileSync(p,s);
console.log('Discord supply now trusts the shared presenter contract');
