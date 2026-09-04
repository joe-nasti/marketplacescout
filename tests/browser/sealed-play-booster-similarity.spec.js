import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('Play Booster cohorts require mature horizons before calibration',async()=>{
  const sql=await readFile('supabase/migrations/20260904153500_add_play_booster_similarity_forecasts.sql','utf8');
  expect(sql).toContain('p.release_date+hz.horizon_days-3');
  expect(sql).toContain('(h.observed_on-p.release_date)::integer actual_days');
  expect(sql).toContain("'minimum_maturity_days','horizon minus 3 days'");
  expect(sql).toContain("'play-market-basket-v2-mature-horizons'");
});

test('similarity forecasts use release-time features and strict prior outcomes',async()=>{
  const sql=await readFile('supabase/migrations/20260904153500_add_play_booster_similarity_forecasts.sql','utf8');
  for(const feature of ['launch_basket_value','priced_products','top10_share_pct','variant_density_pct','premium_price_point_pct','release_gap_days','set_type'])expect(sql).toContain(feature);
  expect(sql).toContain('o.horizon_date<=t.baseline_date');
  expect(sql).toContain('row_number() over(');
  expect(sql).toContain('r.analog_rank<=5');
  expect(sql).toContain('power(greatest(r.similarity_score,1)/100.0,3)');
  expect(sql).toContain('pooled_median_absolute_error_pct');
  expect(sql).toContain("promotion_status in('SHADOW','PRIMARY')");
  expect(sql).toContain("then 'PRIMARY' else 'SHADOW'");
});

test('similarity evidence is read-only to signed-in clients',async()=>{
  const sql=await readFile('supabase/migrations/20260904153500_add_play_booster_similarity_forecasts.sql','utf8');
  expect(sql).toContain('alter table public.modeled_play_booster_similarity_forecast_current enable row level security');
  expect(sql).toContain('revoke all on public.modeled_play_booster_similarity_forecast_current from public,anon,authenticated');
  expect(sql).toContain('grant select on public.modeled_play_booster_similarity_forecast_current to authenticated,service_role');
  expect(sql).toContain('to authenticated using(true)');
});

test('Scout exposes analogs without changing executable EV or grade',async()=>{
  const ui=await readFile('src/modules/sealed/renderer.js','utf8');
  for(const label of ['Closest Play Booster analogs','similarity forecast','Shadow model','pooled trajectory remains primary'])expect(ui).toContain(label);
  expect(ui).toContain('modeled_play_booster_similarity_forecast_current?select=');
  expect(ui).toContain("x.promotion_status==='PRIMARY'");
  expect(ui).toContain('does not change the Scout grade');
  expect(ui).toContain('Direct-first / TCG Low fallback after fees, liquidity, and labor');
});

test('Delvin routes and presents named Play Booster trajectory questions',async()=>{
  const router=await readFile('supabase/functions/ask-collectish-route-intents/index.ts','utf8');
  const presenter=await readFile('supabase/functions/ask-collectish-delvin-present/index.ts','utf8');
  expect(router).toContain('sealedTrajectoryIntent');
  expect(router).toContain("route:'sealed_release_trajectory'");
  expect(router).toContain('Similarity remains SHADOW');
  expect(router).toContain('Scout grade is unchanged');
  expect(presenter).toContain('sealedTrajectoryPresentation');
  expect(presenter).toContain("d?.route==='sealed_release_trajectory'");
  expect(presenter).toContain('Remaining calibrated horizons');
});
