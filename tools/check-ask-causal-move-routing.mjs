import fs from 'node:fs';
const api=fs.readFileSync('supabase/functions/ask-collectish-api/index.ts','utf8');
const router=fs.readFileSync('supabase/functions/ask-collectish-route-intents/index.ts','utf8');
for(const token of ['causalMoveIntent','routed?.handled&&!causal','ask-collectish-orchestrator','additiveSellerSurfaces','seller_surface_additive','deterministic_route_bypassed']){
  if(!api.includes(token))throw new Error(`missing causal routing contract: ${token}`);
}
if(!api.includes("s?.type==='seller_opportunity_map'"))throw new Error('causal move additive surfaces must be seller maps only');
if(!router.includes('seller_opportunity_map'))throw new Error('shared router must continue to own seller opportunity surfaces');
for(const q of ['why did Optimus Prime move?','why is Optimus Prime spiking?','what drove Optimus Prime price move?','why are Bear cards moving?']){
  const source=api.match(/function causalMoveIntent\(q:any\)\{const s=text\(q\);return (\/.*?\/i)\.test\(s\)\}/s)?.[1];
  if(!source)throw new Error('could not locate causalMoveIntent regex');
  const last=source.lastIndexOf('/');const re=new RegExp(source.slice(1,last),source.slice(last+1));
  if(!re.test(q))throw new Error(`causal question not recognized: ${q}`);
}
console.log('Ask causal market-move routing guard passed');
