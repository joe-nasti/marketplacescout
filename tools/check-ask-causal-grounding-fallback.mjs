import fs from 'node:fs';
const src=fs.readFileSync('supabase/functions/ask-collectish-orchestrator/index.ts','utf8');
for(const token of [
  'ask_collectish_public_internal_sku_evidence_v1',
  'shared_public_sku_evidence_fallback',
  'recoveredCard',
  'researchCard=inv?.card||tl?.card||recoveredCard',
  'timelineEvents.length',
  "research_grounding:inv?'investigation':timelineEvents.length?'timeline':'recovered_identity'"
]) if(!src.includes(token)) throw new Error(`missing causal grounding fallback contract: ${token}`);
if(/const \[inv,tl\]=await Promise\.all\(\[getInvestigation\(t,id\),getTimeline\(t,id\)\]\);if\(!inv\)/.test(src)) throw new Error('causal web research must not hard-gate on rich investigation availability');
if(!/getInvestigation\(t,id,ctx\)/.test(src)) throw new Error('recovered context must flow into investigation fallback');
console.log('Ask causal grounding fallback guard passed');
