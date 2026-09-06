-- Persist Collector Booster model-promotion diagnostics so Scout/Delvin reads are cheap.
-- Production smoke testing showed live walk-forward recomputation is too expensive.

create table if not exists public.collector_booster_promotion_stage_current(
  horizon_days smallint not null,
  lifecycle_stage text not null,
  sample_count integer not null,
  product_count integer not null,
  similarity_median_absolute_error_pct numeric,
  pooled_median_absolute_error_pct numeric,
  similarity_direction_accuracy_pct numeric,
  pooled_direction_accuracy_pct numeric,
  median_error_improvement_pct numeric,
  stage_result text not null,
  refreshed_at timestamptz not null default now(),
  primary key(horizon_days,lifecycle_stage)
);

create table if not exists public.collector_booster_promotion_horizon_current(
  horizon_days smallint primary key,
  sample_count integer not null,
  product_count integer not null,
  similarity_median_absolute_error_pct numeric,
  pooled_median_absolute_error_pct numeric,
  similarity_direction_accuracy_pct numeric,
  pooled_direction_accuracy_pct numeric,
  mature_stage_count integer not null,
  winning_stage_count integer not null,
  losing_stage_count integer not null,
  promotion_gate text not null,
  eligible_for_primary boolean not null,
  refreshed_at timestamptz not null default now()
);

alter table public.collector_booster_promotion_stage_current enable row level security;
alter table public.collector_booster_promotion_horizon_current enable row level security;
revoke all on public.collector_booster_promotion_stage_current from public,anon,authenticated;
revoke all on public.collector_booster_promotion_horizon_current from public,anon,authenticated;
grant select,insert,update,delete on public.collector_booster_promotion_stage_current to service_role;
grant select,insert,update,delete on public.collector_booster_promotion_horizon_current to service_role;

create or replace function public.refresh_collector_booster_promotion_dashboard_v1()
returns integer
language plpgsql
set search_path=''
set statement_timeout='180s'
as $$
declare
  run_at timestamptz:=now();
  written integer:=0;
begin
  -- Canonical refresh builds indexed temp checkpoint/outcome tables once. Reuse them
  -- rather than rebuilding the historical feature graph for promotion diagnostics.
  perform public.refresh_collector_booster_trajectory_forecasts();

  drop table if exists pg_temp.collector_booster_promotion_predictions_work;
  create temporary table collector_booster_promotion_predictions_work on commit drop as
  with test_target_periods as materialized (
    select o.*,
      ((o.checkpoint_date-date '2024-02-08')/180)::integer checkpoint_period,
      row_number() over(
        partition by o.sealed_uuid,o.horizon_days,o.lifecycle_stage,
          ((o.checkpoint_date-date '2024-02-08')/180)::integer
        order by o.checkpoint_date desc
      ) period_rank
    from pg_temp.collector_booster_checkpoint_outcomes_work o
    where o.change_30d_pct is not null
      and o.lifecycle_stage not in ('PRE_RELEASE','MIXED')
  ), test_targets as materialized (
    select * from test_target_periods where period_rank=1
  ), candidate_points as materialized (
    select
      t.sealed_uuid target_sealed_uuid,
      t.horizon_days,
      t.checkpoint_date,
      t.lifecycle_stage target_stage,
      t.actual_return_pct target_actual_return_pct,
      t.feature_vector target_feature_vector,
      a.sealed_uuid analog_sealed_uuid,
      a.actual_return_pct analog_return_pct,
      a.horizon_outcome_date analog_outcome_date,
      a.feature_vector analog_feature_vector,
      row_number() over(
        partition by t.sealed_uuid,t.horizon_days,t.checkpoint_date,t.lifecycle_stage,a.sealed_uuid
        order by abs(t.signed_age_days-a.signed_age_days),a.checkpoint_date desc
      ) analog_point_rank
    from test_targets t
    join pg_temp.collector_booster_checkpoint_outcomes_work a
      on a.horizon_days=t.horizon_days
      and a.sealed_uuid<>t.sealed_uuid
      and a.release_date<=t.release_date-120
      and a.horizon_outcome_date<t.checkpoint_date
      and abs(a.signed_age_days-t.signed_age_days)<=case
        when t.signed_age_days<180 then 45
        when t.signed_age_days<730 then 90
        else 180
      end
    where a.change_30d_pct is not null
  ), one_point_per_analog as materialized (
    select * from candidate_points where analog_point_rank=1
  ), scored as materialized (
    -- Score only after choosing one leakage-safe checkpoint per analog product.
    select c.*,
      public.collector_booster_similarity_score_v2(c.target_feature_vector,c.analog_feature_vector) similarity_score
    from one_point_per_analog c
  ), test_pooled as materialized (
    select target_sealed_uuid,horizon_days,checkpoint_date,target_stage,
      percentile_cont(.5) within group(order by analog_return_pct)::numeric pooled_prediction
    from scored
    group by target_sealed_uuid,horizon_days,checkpoint_date,target_stage
  ), test_ranked as materialized (
    select s.*,
      row_number() over(
        partition by target_sealed_uuid,horizon_days,checkpoint_date,target_stage
        order by similarity_score desc,analog_outcome_date desc,analog_sealed_uuid
      ) analog_rank
    from scored s
  ), test_weights as materialized (
    select r.*,power(greatest(similarity_score,1)/100.0,3) analog_weight
    from test_ranked r
    where analog_rank<=5
  ), test_ordered as materialized (
    select w.*,
      sum(analog_weight) over(
        partition by target_sealed_uuid,horizon_days,checkpoint_date,target_stage
        order by analog_return_pct,analog_sealed_uuid rows unbounded preceding
      ) cumulative_weight,
      sum(analog_weight) over(
        partition by target_sealed_uuid,horizon_days,checkpoint_date,target_stage
      ) total_weight
    from test_weights w
  )
  select
    w.target_sealed_uuid sealed_uuid,
    w.horizon_days,
    w.checkpoint_date,
    w.target_stage lifecycle_stage,
    max(w.target_actual_return_pct) actual_return_pct,
    count(*)::integer analog_count,
    min(w.analog_return_pct) filter(where w.cumulative_weight>=w.total_weight*.50) similarity_prediction_pct,
    max(p.pooled_prediction) pooled_prediction_pct,
    round(abs(max(w.target_actual_return_pct)-min(w.analog_return_pct) filter(where w.cumulative_weight>=w.total_weight*.50)),2) similarity_absolute_error_pct,
    round(abs(max(w.target_actual_return_pct)-max(p.pooled_prediction)),2) pooled_absolute_error_pct,
    sign(max(w.target_actual_return_pct))=sign(min(w.analog_return_pct) filter(where w.cumulative_weight>=w.total_weight*.50)) similarity_direction_correct,
    sign(max(w.target_actual_return_pct))=sign(max(p.pooled_prediction)) pooled_direction_correct
  from test_ordered w
  join test_pooled p using(target_sealed_uuid,horizon_days,checkpoint_date,target_stage)
  group by w.target_sealed_uuid,w.horizon_days,w.checkpoint_date,w.target_stage
  having count(*)>=3;

  create index on collector_booster_promotion_predictions_work(horizon_days,lifecycle_stage);
  analyze collector_booster_promotion_predictions_work;

  delete from public.collector_booster_promotion_stage_current;
  insert into public.collector_booster_promotion_stage_current(
    horizon_days,lifecycle_stage,sample_count,product_count,
    similarity_median_absolute_error_pct,pooled_median_absolute_error_pct,
    similarity_direction_accuracy_pct,pooled_direction_accuracy_pct,
    median_error_improvement_pct,stage_result,refreshed_at
  )
  select
    horizon_days,lifecycle_stage,count(*)::integer,count(distinct sealed_uuid)::integer,
    round(percentile_cont(.5) within group(order by similarity_absolute_error_pct)::numeric,2),
    round(percentile_cont(.5) within group(order by pooled_absolute_error_pct)::numeric,2),
    round(100.0*avg(similarity_direction_correct::integer),1),
    round(100.0*avg(pooled_direction_correct::integer),1),
    round(100.0*(1-percentile_cont(.5) within group(order by similarity_absolute_error_pct)
      /nullif(percentile_cont(.5) within group(order by pooled_absolute_error_pct),0))::numeric,1),
    case
      when count(*)<6 or count(distinct sealed_uuid)<3 then 'BUILDING_HISTORY'
      when percentile_cont(.5) within group(order by similarity_absolute_error_pct)
        < percentile_cont(.5) within group(order by pooled_absolute_error_pct) then 'SIMILARITY_WIN'
      else 'POOLED_WIN'
    end,
    run_at
  from pg_temp.collector_booster_promotion_predictions_work
  group by horizon_days,lifecycle_stage;

  delete from public.collector_booster_promotion_horizon_current;
  insert into public.collector_booster_promotion_horizon_current(
    horizon_days,sample_count,product_count,
    similarity_median_absolute_error_pct,pooled_median_absolute_error_pct,
    similarity_direction_accuracy_pct,pooled_direction_accuracy_pct,
    mature_stage_count,winning_stage_count,losing_stage_count,
    promotion_gate,eligible_for_primary,refreshed_at
  )
  with overall as (
    select horizon_days,count(*)::integer sample_count,count(distinct sealed_uuid)::integer product_count,
      round(percentile_cont(.5) within group(order by similarity_absolute_error_pct)::numeric,2) similarity_mae,
      round(percentile_cont(.5) within group(order by pooled_absolute_error_pct)::numeric,2) pooled_mae,
      round(100.0*avg(similarity_direction_correct::integer),1) similarity_direction,
      round(100.0*avg(pooled_direction_correct::integer),1) pooled_direction
    from pg_temp.collector_booster_promotion_predictions_work
    group by horizon_days
  ), stages as (
    select horizon_days,
      count(*) filter(where sample_count>=6 and product_count>=3)::integer mature_stage_count,
      count(*) filter(where sample_count>=6 and product_count>=3 and stage_result='SIMILARITY_WIN')::integer winning_stage_count,
      count(*) filter(where sample_count>=6 and product_count>=3 and stage_result='POOLED_WIN')::integer losing_stage_count
    from public.collector_booster_promotion_stage_current
    group by horizon_days
  )
  select o.horizon_days,o.sample_count,o.product_count,o.similarity_mae,o.pooled_mae,
    o.similarity_direction,o.pooled_direction,
    coalesce(s.mature_stage_count,0),coalesce(s.winning_stage_count,0),coalesce(s.losing_stage_count,0),
    case
      when o.sample_count<30 or o.product_count<10 then 'BUILDING_HISTORY'
      when coalesce(s.mature_stage_count,0)<3 then 'BUILDING_STAGE_COVERAGE'
      when coalesce(s.losing_stage_count,0)>0 then 'SHADOW_STAGE_REGRESSION'
      when o.similarity_mae>o.pooled_mae*.90 then 'SHADOW_INSUFFICIENT_EDGE'
      when o.similarity_direction<o.pooled_direction then 'SHADOW_DIRECTION_REGRESSION'
      else 'ELIGIBLE_FOR_PRIMARY'
    end,
    case
      when o.sample_count<30 or o.product_count<10 then false
      when coalesce(s.mature_stage_count,0)<3 then false
      when coalesce(s.losing_stage_count,0)>0 then false
      when o.similarity_mae>o.pooled_mae*.90 then false
      when o.similarity_direction<o.pooled_direction then false
      else true
    end,
    run_at
  from overall o left join stages s using(horizon_days);

  select count(*)::integer into written from public.collector_booster_promotion_horizon_current;
  return written;
end $$;

revoke all on function public.refresh_collector_booster_promotion_dashboard_v1() from public,anon,authenticated;
grant execute on function public.refresh_collector_booster_promotion_dashboard_v1() to service_role;

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
    'refreshed_at',(select max(h.refreshed_at) from public.collector_booster_promotion_horizon_current h),
    'horizons',coalesce((
      select jsonb_agg(jsonb_build_object(
        'horizon_days',h.horizon_days,
        'samples',h.sample_count,
        'products',h.product_count,
        'similarity_median_absolute_error_pct',h.similarity_median_absolute_error_pct,
        'pooled_median_absolute_error_pct',h.pooled_median_absolute_error_pct,
        'similarity_direction_accuracy_pct',h.similarity_direction_accuracy_pct,
        'pooled_direction_accuracy_pct',h.pooled_direction_accuracy_pct,
        'mature_stage_count',h.mature_stage_count,
        'winning_stage_count',h.winning_stage_count,
        'losing_stage_count',h.losing_stage_count,
        'promotion_gate',h.promotion_gate,
        'eligible_for_primary',h.eligible_for_primary,
        'stages',coalesce((select jsonb_agg(jsonb_build_object(
          'stage',s.lifecycle_stage,'samples',s.sample_count,'products',s.product_count,
          'similarity_mae_pct',s.similarity_median_absolute_error_pct,
          'pooled_mae_pct',s.pooled_median_absolute_error_pct,
          'similarity_direction_accuracy_pct',s.similarity_direction_accuracy_pct,
          'pooled_direction_accuracy_pct',s.pooled_direction_accuracy_pct,
          'result',s.stage_result
        ) order by s.lifecycle_stage)
          from public.collector_booster_promotion_stage_current s
          where s.horizon_days=h.horizon_days),'[]'::jsonb)
      ) order by h.horizon_days)
      from public.collector_booster_promotion_horizon_current h
    ),'[]'::jsonb),
    'caveat','Leakage-safe trajectory diagnostics only. TCGCSV Market does not replace executable acquisition, liquidation EV, or Scout grades.'
  );
$$;

revoke all on function public.ask_collectish_collector_promotion_dashboard_v1() from public,anon;
grant execute on function public.ask_collectish_collector_promotion_dashboard_v1() to authenticated,service_role;

comment on function public.ask_collectish_collector_promotion_dashboard_v1() is
  'Fast authenticated diagnostic read from persisted Collector Booster promotion snapshots.';

notify pgrst,'reload schema';