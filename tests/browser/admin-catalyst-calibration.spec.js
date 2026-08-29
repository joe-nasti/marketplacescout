import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const read=p=>readFile(path.join(process.cwd(),p),'utf8');

test('Admin registers the catalyst calibration module',async()=>{
  const index=await read('src/modules/admin/index.js');
  const module=await read('src/modules/admin/catalyst-calibration.js');
  expect(index).toContain("import('./catalyst-calibration.js')");
  expect(module).toContain("const MIN_SAMPLE=8");
  expect(module).toContain('Official Scout ranking and production source weights remain unchanged');
  expect(module).toContain('market_intel_catalyst_shadow_backtest_summary');
  expect(module).toContain('market_intel_catalyst_shadow_weight_proposals');
  expect(module).toContain('market_intel_catalyst_candidate_weights');
  expect(module).toContain("rpc/review_catalyst_weight_proposal");
  expect(module).not.toContain("method:'PATCH'");
  expect(module).not.toContain("method:'DELETE'");
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
  expect(sql).toContain("case when decision='approved_candidate' then proposed_weight end as candidate_weight");
  expect(sql).not.toMatch(/update\s+public\.market_intel_catalyst_shadow_weight_proposals/i);
});

test('Catalyst calibration styles retain mobile governance controls',async()=>{
  const css=await read('src/styles/admin-catalyst-calibration.css');
  expect(css).toContain('.cx-cal-grid{display:grid');
  expect(css).toContain('.cx-cal-weight{display:flex');
  expect(css).toContain('.cx-cal-governance{grid-column:1/-1');
  expect(css).toContain('@media(max-width:600px)');
  expect(css).toContain('.cx-cal-governance button{min-height:40px}');
});
