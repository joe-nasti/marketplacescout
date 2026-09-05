-- Collector Booster similarity-model promotion diagnostics.
-- All comparisons are leakage-safe: an analog's matured horizon outcome must predate
-- the target checkpoint. TCGCSV Market remains trajectory evidence only.

create or replace view public.collector_booster_promotion_backtest_predictions_v1
with (security_invoker=true) as
select
  t.sealed_uuid,
  t.product_id,
  t.product_name,
  t.set_code,
  t.checkpoint_date,
  t.horizon_days,
  t.lifecycle_stage,
  t.actual_return_pct,
  sim.analog_count,
  sim.similarity_prediction_pct,
  pool.pooled_prediction_pct,
  round(abs(t.actual_return_pct-sim.similarity_prediction_pct),2) similarity_absolute_error_pct,
  round(abs(t.actual_return_pct-pool.pooled_prediction_pct),2) pooled_absolute_error_pct,
  case when sign(t.actual_return_pct)=sign(sim.similarity_prediction_pct) then true else false end similarity_direction_correct,
  case when sign(t.actual_return_pct)=sign(pool.pooled_prediction_pct) then true else false end pooled_direction_correct
from public.collector_booster_checkpoint_outcomes_v2 t
join lateral (
  select
    count(*)::integer analog_count,
    round(sum(z.actual_return_pct*z.similarity_score)/nullif(sum(z.similarity_score),0),2) similarity_prediction_pct
  from (
    select
      a.actual_return_pct,
      public.collector_booster_similarity_score_v2(t.feature_vector,a.feature_vector) similarity_score
    from public.collector_booster_checkpoint_outcomes_v2 a
    where a.horizon_days=t.horizon_days
      and a.sealed_uuid<>t.sealed_uuid
      and a.horizon_outcome_date<t.checkpoint_date
      and abs(a.signed_age_days-t.signed_age_days)<=120
    order by public.collector_booster_similarity_score_v2(t.feature_vector,a.feature_vector) desc,
      a.horizon_outcome_date desc
    limit 12
  ) z
  where z.similarity_score>=55
) sim on sim.analog_count>=3 and sim.similarity_prediction_pct is not null
join lateral (
  select round(percentile_cont(.5) within group(order by p.actual_return_pct)::numeric,2) pooled_prediction_pct
  from public.collector_booster_checkpoint_outcomes_v2 p
  where p.horizon_days=t.horizon_days
    and p.sealed_uuid<>t.sealed_uuid
    and p.horizon_outcome_date<t.checkpoint_date
) pool on pool.pooled_prediction_pct is not null;

revoke all on public.collector_booster_promotion_backtest_predictions_v1 from public,anon,authenticated;
grant select on public.collector_booster_promotion_backtest_predictions_v1 to service_role;

comment on view public.collector_booster_promotion_backtest_predictions_v1 is
  'Leakage-safe Collector Booster similarity-versus-pooled predictions. Every analog outcome predates the target checkpoint.';

create or replace view public.collector_booster_promotion_stage_dashboard_v1
with (security_invoker=true) as
select
  horizon_days,
  lifecycle_stage,
  count(*)::integer sample_count,
  count(distinct sealed_uuid)::integer product_count,
  round(percentile_cont(.5) within group(order by similarity_absolute_error_pct)::numeric,2) similarity_median_absolute_error_pct,
  round(percentile_cont(.5) within group(order by pooled_absolute_error_pct)::numeric,2) pooled_median_absolute_error_pct,
  round(100.0*avg(similarity_direction_correct::integer),1) similarity_direction_accuracy_pct,
  round(100.0*avg(pooled_direction_correct::integer),1) pooled_direction_accuracy_pct,
  round(100.0*(1-percentile_cont(.5) within group(order by similarity_absolute_error_pct)
    /nullif(percentile_cont(.5) within group(order by pooled_absolute_error_pct),0))::numeric,1) median_error_improvement_pct,
  case
    when count(*)<6 or count(distinct sealed_uuid)<3 then 'BUILDING_HISTORY'
    when percentile_cont(.5) within group(order by similarity_absolute_error_pct)
      < percentile_cont(.5) within group(order by pooled_absolute_error_pct) then 'SIMILARITY_WIN'
    else 'POOLED_WIN'
  end stage_result
from public.collector_booster_promotion_backtest_predictions_v1
where lifecycle_stage not in ('PRE_RELEASE','MIXED')
group by horizon_days,lifecycle_stage;

revoke all on public.collector_booster_promotion_stage_dashboard_v1 from public,anon,authenticated;
grant select on public.collector_booster_promotion_stage_dashboard_v1 to service_role;

comment on view public.collector_booster_promotion_stage_dashboard_v1 is
  'Collector Booster promotion diagnostics by horizon and lifecycle stage. Sparse cohorts remain BUILDING_HISTORY.';

create or replace view public.collector_booster_promotion_horizon_gate_v1
with (security_invoker=true) as
with overall as (
  select
    horizon_days,
    count(*)::integer sample_count,
    count(distinct sealed_uuid)::integer product_count,
    round(percentile_cont(.5) within group(order by similarity_absolute_error_pct)::numeric,2) similarity_median_absolute_error_pct,
    round(percentile_cont(.5) within group(order by pooled_absolute_error_pct)::numeric,2) pooled_median_absolute_error_pct,
    round(100.0*avg(similarity_direction_correct::integer),1) similarity_direction_accuracy_pct,
    round(100.0*avg(pooled_direction_correct::integer),1) pooled_direction_accuracy_pct
  from public.collector_booster_promotion_backtest_predictions_v1
  group by horizon_days
), stages as (
  select
    horizon_days,
    count(*) filter(where sample_count>=6 and product_count>=3)::integer mature_stage_count,
    count(*) filter(where sample_count>=6 and product_count>=3 and stage_result='SIMILARITY_WIN')::integer winning_stage_count,
    count(*) filter(where sample_count>=6 and product_count>=3 and stage_result='POOLED_WIN')::integer losing_stage_count,
    jsonb_agg(jsonb_build_object(
      'stage',lifecycle_stage,
      'samples',sample_count,
      'products',product_count,
      'similarity_mae_pct',similarity_median_absolute_error_pct,
      'pooled_mae_pct',pooled_median_absolute_error_pct,
      'similarity_direction_accuracy_pct',similarity_direction_accuracy_pct,
      'pooled_direction_accuracy_pct',pooled_direction_accuracy_pct,
      'result',stage_result
    ) order by lifecycle_stage) stage_results
  from public.collector_booster_promotion_stage_dashboard_v1
  group by horizon_days
)
select
  o.horizon_days,
  o.sample_count,
  o.product_count,
  o.similarity_median_absolute_error_pct,
  o.pooled_median_absolute_error_pct,
  o.similarity_direction_accuracy_pct,
  o.pooled_direction_accuracy_pct,
  coalesce(s.mature_stage_count,0) mature_stage_count,
  coalesce(s.winning_stage_count,0) winning_stage_count,
  coalesce(s.losing_stage_count,0) losing_stage_count,
  coalesce(s.stage_results,'[]'::jsonb) stage_results,
  case
    when o.sample_count<30 or o.product_count<10 then 'BUILDING_HISTORY'
    when coalesce(s.mature_stage_count,0)<3 then 'BUILDING_STAGE_COVERAGE'
    when coalesce(s.losing_stage_count,0)>0 then 'SHADOW_STAGE_REGRESSION'
    when o.similarity_median_absolute_error_pct>o.pooled_median_absolute_error_pct*.90 then 'SHADOW_INSUFFICIENT_EDGE'
    when o.similarity_direction_accuracy_pct<o.pooled_direction_accuracy_pct then 'SHADOW_DIRECTION_REGRESSION'
    else 'ELIGIBLE_FOR_PRIMARY'
  end promotion_gate,
  case
    when o.sample_count<30 or o.product_count<10 then false
    when coalesce(s.mature_stage_count,0)<3 then false
    when coalesce(s.losing_stage_count,0)>0 then false
    when o.similarity_median_absolute_error_pct>o.pooled_median_absolute_error_pct*.90 then false
    when o.similarity_direction_accuracy_pct<o.pooled_direction_accuracy_pct then false
    else true
  end eligible_for_primary
from overall o
left join stages s using(horizon_days);

revoke all on public.collector_booster_promotion_horizon_gate_v1 from public,anon,authenticated;
grant select on public.collector_booster_promotion_horizon_gate_v1 to service_role;

comment on view public.collector_booster_promotion_horizon_gate_v1 is
  'Conservative Collector Booster promotion gate: >=30 tests, >=10 products, >=3 mature lifecycle stages, no mature-stage MAE regression, >=10% overall median-MAE edge, and no direction-accuracy regression.';

create or replace function public.ask_collectish_collector_promotion_dashboard_v1()
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'model','collector_booster_similarity_v2',
    'role','DIAGNOSTIC_ONLY',
    'horizons',coalesce((
      select jsonb_agg(jsonb_build_object(
        'horizon_days',g.horizon_days,
        'samples',g.sample_count,
        'products',g.product_count,
        'similarity_median_absolute_error_pct',g.similarity_median_absolute_error_pct,
        'pooled_median_absolute_error_pct',g.pooled_median_absolute_error_pct,
        'similarity_direction_accuracy_pct',g.similarity_direction_accuracy_pct,
        'pooled_direction_accuracy_pct',g.pooled_direction_accuracy_pct,
        'mature_stage_count',g.mature_stage_count,
        'winning_stage_count',g.winning_stage_count,
        'losing_stage_count',g.losing_stage_count,
        'promotion_gate',g.promotion_gate,
        'eligible_for_primary',g.eligible_for_primary,
        'stages',g.stage_results
      ) order by g.horizon_days)
      from public.collector_booster_promotion_horizon_gate_v1 g
    ),'[]'::jsonb),
    'caveat','Leakage-safe trajectory diagnostics only. TCGCSV Market does not replace executable acquisition, liquidation EV, or Scout grades.'
  );
$$;

revoke all on function public.ask_collectish_collector_promotion_dashboard_v1() from public,anon;
grant execute on function public.ask_collectish_collector_promotion_dashboard_v1() to authenticated,service_role;

comment on function public.ask_collectish_collector_promotion_dashboard_v1() is
  'Authenticated diagnostic dashboard for pooled-vs-similarity Collector Booster model promotion evidence.';

notify pgrst,'reload schema';