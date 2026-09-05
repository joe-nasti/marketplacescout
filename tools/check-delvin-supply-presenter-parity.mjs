import fs from 'node:fs';
const s=fs.readFileSync('cloud-worker/discord-shared-delvin-route.mjs','utf8');
if(!s.includes('async function polishSupplyResponse(env,d){return d}'))throw new Error('Discord supply must preserve shared presenter output');
for(const token of ['Set metadata scan','scan requested:','Research flag only — demand/velocity still needs confirmation.'])if(s.includes(token))throw new Error('Discord-side supply rewrite leaked: '+token);
console.log('Delvin supply presenter parity guard passed');
