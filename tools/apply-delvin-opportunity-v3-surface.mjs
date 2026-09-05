import fs from 'node:fs';
const presenterPath='supabase/functions/ask-collectish-delvin-supply-present/index.ts';
const guardPath='tools/check-ask-market-wide-supply.mjs';
let s=fs.readFileSync(presenterPath,'utf8');

if(!s.includes('opportunityTextV3')) throw new Error('presenter v3 patch is unexpectedly missing');
if(!s.includes("ask_collectish_family_printing_opportunity_v3")) throw new Error('presenter does not call opportunity v3');
if(!s.includes("'★':''")) throw new Error('presenter compact foil notation missing');
if(!s.includes('pull odds appear only where explicitly sourced')) throw new Error('presenter sourced-odds guardrail missing');

let g=fs.readFileSync(guardPath,'utf8');
g=g.replace("if(!/\\*\\*Nonfoil\\*\\*/.test(presenter)||!/\\*\\*Foil\\*\\*/.test(presenter))throw new Error('modern-set supply ladder must bucket nonfoil and foil variants');","if(!/\\*\\*Nonfoil\\*\\*/.test(presenter)||!/\\*\\*Foil · ★\\*\\*/.test(presenter))throw new Error('modern-set supply ladder must bucket nonfoil and foil variants with compact star notation');");
const marker="if(!/explicitRow/.test(presenter))throw new Error('ambiguous collector-number schemes need explicit finish-label fallback');";
if(!g.includes('ask_collectish_family_printing_opportunity_v3')){
  const extra="for(const token of ['ask_collectish_family_printing_opportunity_v3','opportunityTextV3','UNDERPRICED_FOR_PULL_RARITY_CANDIDATE','PULL_RARITY_VALUE_SIGNAL_DEMAND_UNCONFIRMED','demand confirmed','demand unknown','Collector Boosters','pull odds appear only where explicitly sourced'])if(!presenter.includes(token))throw new Error(`missing demand/pull-odds presenter token: ${token}`);\n";
  if(!g.includes(marker)) throw new Error('guard insertion anchor missing');
  g=g.replace(marker,extra+marker);
}
fs.writeFileSync(guardPath,g);
console.log('Delvin opportunity v3 presenter already patched; guard aligned');
