import fs from 'node:fs';
const web=fs.readFileSync('supabase/functions/ask-collectish-web-research/index.ts','utf8');
for(const token of ['market_linkage','market_linking_source_count','causal_assessment','timing_strength','No market-linking source found']){
  if(!web.includes(token))throw new Error(`missing causal evidence token: ${token}`);
}
if(!/News\/general event coverage verifies the event but is not market linkage/.test(web))throw new Error('research prompt must distinguish event verification from market linkage');
if(!/causal_confidence/.test(web))throw new Error('causal confidence must be explicit');
console.log('Ask causal evidence contract passed');
