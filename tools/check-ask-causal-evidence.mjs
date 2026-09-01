import fs from 'node:fs';
const web=fs.readFileSync('supabase/functions/ask-collectish-web-research/index.ts','utf8');
const orch=fs.readFileSync('supabase/functions/ask-collectish-orchestrator/index.ts','utf8');
const route=fs.readFileSync('supabase/functions/ask-collectish-route-intents/index.ts','utf8');
for(const token of ['market_linkage','market_linking_source_count','causal_assessment','timing_strength','No market-linking source']){
  if(!web.includes(token))throw new Error(`missing causal evidence token: ${token}`);
}
if(!orch.includes('causal_assessment')||!orch.includes('market_linkage'))throw new Error('orchestrator does not preserve causal/linkage evidence');
if(!route.includes('window_days')&&!route.includes('window'))throw new Error('seller move evidence must retain its observation window');
console.log('Ask causal evidence contract passed');
