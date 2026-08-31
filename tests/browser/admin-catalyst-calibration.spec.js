import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Admin registers catalyst calibration and production promotion modules',async()=>{
  const index=await read('src/modules/admin/index.js');
  const module=await read('src/modules/admin/catalyst-calibration.js');
  const promotion=await read('src/modules/admin/catalyst-production-promotion.js');
  expect(index).toContain("import('./catalyst-calibration.js')");
  expect(index).toContain("import('./catalyst-production-promotion.js')");
  expect(module).toContain("const MIN_SAMPLE=8");
  expect(module).toContain('Official Scout ranking and production source weights remain unchanged');
  expect(module).toContain('Candidate model backtest');
  expect(promotion).toContain('Production promotion gate');
  expect(promotion).toContain('market_intel_catalyst_candidate_promotion_gate');
  expect(promotion).toContain('market_intel_catalyst_production_promotion_state');
  expect(promotion).toContain("rpc/review_catalyst_candidate_for_production");
  expect(promotion).not.toContain("method:'PATCH'");
  expect(promotion).not.toContain("method:'DELETE'");
});

test('Catalyst source calibration view is security-invoker and excludes future releases',async()=>{
  const sql=await read('supabase/migrations/20260829023900_catalyst_shadow_source_calibration.sql');
  expect(sql).toContain('with (security_invoker=true)');
  expect(sql).toContain('where not future_release');
  expect(sql).toContain('cross join lateral unnest(b.intel_ids)');
  expect(sql).toContain('revoke all on public.market_intel_catalyst_shadow_source_backtest from anon');
});

test('Catalyst proposed weights stay gated and bounded before governance',async()=>{
  const sql=await read('supabase/migrations/20260829024000_catalyst_shadow_proposed_source_weights.sql');
  expect(sql).toContain('with (security_invoker=true)');
  expect(sql).toContain('case when matured_7d >= 8');
  expect(sql).toContain('greatest(-0.15::numeric, least(0.15::numeric');
  expect(sql).toContain('greatest(0.35::numeric, least(1.40::numeric');
  expect(sql).toContain("'insufficient_shadow_sample'");
});

test('Candidate promotion is server gated auditable and does not mutate production weights',async()=>{
  const sql=await read('supabase/migrations/20260829142100_catalyst_weight_promotion_governance.sql');
  expect(sql).toContain('market_intel_catalyst_weight_reviews');
  expect(sql).toContain("decision in ('approved_candidate','rejected','revoked')");
  expect(sql).toContain("p.matured_7d < 8 or p.proposed_weight is null");
  expect(sql).toContain('security invoker');
  expect(sql).toContain('with (security_invoker=true)');
  expect(sql).toContain('market_intel_catalyst_candidate_weights');
  expect(sql).not.toMatch(/update\s+public\.market_intel_catalyst_shadow_weight_proposals/i);
});

test('Candidate backtest preserves non-source points and only swaps approved source weights',async()=>{
  const sql=await read('supabase/migrations/20260830003000_catalyst_candidate_model_backtest.sql');
  expect(sql).toContain('with (security_invoker=true)');
  expect(sql).toContain('market_intel_catalyst_candidate_weights');
  expect(sql).toContain('preserved_non_source_points');
  expect(sql).toContain('current_signal_points*candidate_weight');
  expect(sql).toContain('candidate_model_active');
  expect(sql).toContain('candidate_applied_modifier');
  expect(sql).toContain('market_intel_catalyst_candidate_model_metrics');
  expect(sql).toContain('separation_lift_7d');
  expect(sql).toContain('where not future_release and matured_7d');
});

test('Production promotion requires mature lift safety diversity and grade gates',async()=>{
  const sql=await read('supabase/migrations/20260831151000_catalyst_candidate_production_promotion_gate.sql');
  expect(sql).toContain('with (security_invoker=true)');
  expect(sql).toContain('affected_matured_7d>=30');
  expect(sql).toContain('affected_matured_30d>=10');
  expect(sql).toContain('separation_lift_7d>=2.0');
  expect(sql).toContain('separation_lift_30d>=0');
  expect(sql).toContain('candidate_false_positive_pct_7d');
  expect(sql).toContain('candidate_low_avg_7d');
  expect(sql).toContain('approved_candidate_sources>=3');
  expect(sql).toContain('promoted_to_ab_avg_7d');
  expect(sql).toContain('eligible_for_production_review');
  expect(sql).toContain("decision in ('approved_for_production','rejected','revoked')");
  expect(sql).toContain('security invoker');
  expect(sql).toContain("not g.eligible_for_production_review");
  expect(sql).not.toMatch(/update\s+public\.(scout|market_intel_catalyst_candidate_weights)/i);
});

test('Catalyst calibration styles retain mobile governance candidate and production gate controls',async()=>{
  const css=await read('src/styles/admin-catalyst-calibration.css');
  const prod=await read('src/styles/admin-catalyst-production.css');
  expect(css).toContain('.cx-cal-model-grid{display:grid');
  expect(css).toContain('.cx-cal-governance{display:flex');
  expect(prod).toContain('.cx-prod-gates{display:grid');
  expect(prod).toContain('.cx-prod-actions button{min-height:40px');
  expect(prod).toContain('@media(max-width:600px)');
  expect(prod).toContain('.cx-prod-summary,.cx-prod-gates{grid-template-columns:1fr}');
});
