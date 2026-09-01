import fs from 'node:fs';

const read=(p)=>fs.readFileSync(p,'utf8');
const orchestrator=read('supabase/functions/ask-collectish-orchestrator/index.ts');
const migration=read('supabase/migrations/20260901140500_ask_market_research_scan_fallback.sql');

for(const token of [
  "wantsExternal=action==='chat'&&(external(q)||deep(q))",
  "ask-collectish-web-research",
  "causal_family:ctx?.causal_family||null",
  "causal_assessment:r.causal_assessment||null",
]) if(!orchestrator.includes(token)) throw new Error(`missing causal orchestrator contract: ${token}`);

for(const token of [
  'marketplace_scan_rows',
  'v3_scan_fallback',
  'tcgplayer_official_sku_price_history',
  'v1_official_intraday_scan_fallback',
  'STABLE SECURITY DEFINER',
  'r.user_id=auth.uid()',
  'user_id=auth.uid()',
]) if(!migration.includes(token)) throw new Error(`missing market research fallback token: ${token}`);

if(/from public\.scout_opportunities_v5[\s\S]{0,700}if [a-z_]+\.sku_id is null then[\s\S]{0,200}No exact current Scout card matched/i.test(migration)) {
  throw new Error('market investigation reintroduced Scout-only identity gating');
}
if(!/official_points[\s\S]*lag\(market_price\) over\(order by observed_at\)/.test(migration)) {
  throw new Error('timeline must preserve intraday official price acceleration');
}
if(!/revoke all on function public\.ask_collectish_market_timeline_v1/.test(migration)) {
  throw new Error('security-definer timeline must not be public executable');
}

console.log('Ask market research scan fallback guard passed');
