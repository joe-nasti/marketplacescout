import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const migration='supabase/migrations/20260905142500_add_collector_promotion_dashboard.sql';

test('Collector promotion backtests remain leakage-safe and lifecycle-aware',async()=>{
  const sql=await readFile(migration,'utf8');
  expect(sql).toContain('a.horizon_outcome_date<t.checkpoint_date');
  expect(sql).toContain('a.sealed_uuid<>t.sealed_uuid');
  expect(sql).toContain("lifecycle_stage not in ('PRE_RELEASE','MIXED')");
  expect(sql).toContain('collector_booster_similarity_score_v2');
  expect(sql).toContain('pooled_prediction_pct');
});

test('Collector promotion gate requires broad, stage-consistent superiority',async()=>{
  const sql=await readFile(migration,'utf8');
  for(const guard of [
    'o.sample_count<30',
    'o.product_count<10',
    's.mature_stage_count,0)<3',
    's.losing_stage_count,0)>0',
    'o.pooled_median_absolute_error_pct*.90',
    'o.similarity_direction_accuracy_pct<o.pooled_direction_accuracy_pct'
  ])expect(sql).toContain(guard);
  for(const status of [
    'BUILDING_HISTORY',
    'BUILDING_STAGE_COVERAGE',
    'SHADOW_STAGE_REGRESSION',
    'SHADOW_INSUFFICIENT_EDGE',
    'SHADOW_DIRECTION_REGRESSION',
    'ELIGIBLE_FOR_PRIMARY'
  ])expect(sql).toContain(status);
});

test('Promotion dashboard is diagnostic and cannot change Scout economics',async()=>{
  const sql=await readFile(migration,'utf8');
  expect(sql).toContain("'role','DIAGNOSTIC_ONLY'");
  expect(sql).toContain('TCGCSV Market does not replace executable acquisition, liquidation EV, or Scout grades');
  expect(sql).toContain('ask_collectish_collector_promotion_dashboard_v1');
  expect(sql).toContain('grant execute on function public.ask_collectish_collector_promotion_dashboard_v1() to authenticated,service_role');
  expect(sql).not.toContain('update public.sealed_ev_current');
  expect(sql).not.toContain('update public.collector_booster_trajectory_forecast_current');
});
