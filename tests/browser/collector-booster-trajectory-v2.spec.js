import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const migration='supabase/migrations/20260904171310_collector_booster_trajectory_v2.sql';

test('Collector Box features preserve separate price, basket, structure, and demand evidence',async()=>{
  const sql=await readFile(migration,'utf8');
  for(const feature of ['signed_age_days','variant_density_pct','premium_treatment_pct','premium_price_point_pct','release_gap_days','basket_market_value','top10_share_pct','units_sold_30d'])expect(sql).toContain(feature);
  for(const stage of ['PRE_RELEASE','REVERSAL','LAUNCH_COMPRESSION','APPRECIATION','SCARCITY_TURN','STABILIZATION','MIXED'])expect(sql).toContain(stage);
  expect(sql).toContain('collector_booster_sales_daily_v1');
  expect(sql).toContain('collector_booster_card_basket_features_history');
  expect(sql).toContain('TCGCSV Market is trajectory evidence only');
});

test('Collector Box horizons are lifecycle matched and leakage safe',async()=>{
  const sql=await readFile(migration,'utf8');
  for(const horizon of ['90::smallint','180::smallint','365::smallint'])expect(sql).toContain(horizon);
  expect(sql).toContain('a.horizon_outcome_date<=t.checkpoint_date');
  expect(sql).toContain('abs(a.signed_age_days-t.signed_age_days)');
  expect(sql).toContain('analog_point_rank=1');
  expect(sql).toContain('power(greatest(similarity_score,1)/100.0,3)');
  expect(sql).toContain('test_target_periods');
  expect(sql).toContain('checkpoint_period');
});

test('Collector similarity cannot promote without sufficient and superior backtests',async()=>{
  const sql=await readFile(migration,'utf8');
  expect(sql).toContain("promotion_status text not null check(promotion_status in('SHADOW','PRIMARY'))");
  expect(sql).toContain('coalesce(b.sample_count,0)>=30');
  expect(sql).toContain('b.direction_accuracy_pct>=55');
  expect(sql).toContain('b.median_absolute_error_pct<=b.pooled_median_absolute_error_pct');
  expect(sql).toContain("then 'PRIMARY' else 'SHADOW'");
  expect(sql).toContain('SHADOW rows never alter executable EV');
});

test('Collector forecast state is authenticated read-only and refresh is service-only',async()=>{
  const sql=await readFile(migration,'utf8');
  expect(sql).toContain('alter table public.collector_booster_trajectory_forecast_current enable row level security');
  expect(sql).toContain('revoke all on public.collector_booster_trajectory_forecast_current from public,anon,authenticated');
  expect(sql).toContain('grant select on public.collector_booster_trajectory_forecast_current to authenticated,service_role');
  expect(sql).toContain('revoke all on function public.refresh_collector_booster_trajectory_forecasts()');
  expect(sql).toContain('to service_role');
});

test('Scout presents lifecycle Market references without changing executable economics',async()=>{
  const ui=await readFile('src/modules/sealed/renderer.js','utf8');
  for(const label of ['Lifecycle-normalized Collector Box outlook','Current Market reference','Pooled cohort remains primary','Market trajectory evidence only—not acquisition or liquidation EV'])expect(ui).toContain(label);
  expect(ui).toContain('collector_booster_trajectory_forecast_current?select=*');
  expect(ui).toContain("x.promotion_status==='PRIMARY'");
  expect(ui).toContain("d.collectorForecast?.length?'':analogSummary");
  expect(ui).toContain('Executable EV stays Direct-first / TCG Low fallback');
  expect(ui).toContain('Scout grade is unchanged');
});

test('Delvin routes and presents named Collector Box lifecycle questions',async()=>{
  const router=await readFile('supabase/functions/ask-collectish-route-intents/index.ts','utf8');
  const presenter=await readFile('supabase/functions/ask-collectish-delvin-present/index.ts','utf8');
  expect(router).toContain('collectorTrajectoryIntent');
  expect(router).toContain("category=eq.booster_box&subtype=eq.collector");
  expect(router).toContain("route:'sealed_collector_trajectory'");
  expect(router).toContain('The pooled cohort remains primary');
  expect(router).toContain('normalizeCollectorTrajectory');
  expect(router).toContain("role=primaryDays.length&&shadowDays.length?'MIXED'");
  expect(router).toContain("'similarity PRIMARY':'pooled PRIMARY'");
  expect(router).toContain('Scout grade is unchanged');
  expect(presenter).toContain('sealedCollectorTrajectoryPresentation');
  expect(presenter).toContain("d?.route==='sealed_collector_trajectory'");
  expect(presenter).toContain('Lifecycle-normalized horizons');
});
