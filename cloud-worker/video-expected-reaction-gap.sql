-- Expected market reaction and unpriced catalyst gap.
-- This layer is presentation/prioritization only: it never changes Scout grade or economics.
-- Sparse cohorts remain explicitly prior-driven until enough mature 7-day outcomes exist.

create or replace view public.market_intel_video_outcome_cohorts with (security_invoker=true) as
with mature as (
  select
    v.user_id,
    lower(v.source_name) as creator_key,
    v.source_name,
    v.primary_event_type,
    case
      when coalesce(o.signal_market_price,v.baseline_market_price,0) < 5 then 'under_5'
      when coalesce(o.signal_market_price,v.baseline_market_price,0) < 15 then '5_to_15'
      when coalesce(o.signal_market_price,v.baseline_market_price,0) < 40 then '15_to_40'
      else '40_plus'
    end as price_band,
    o.intel_id,
    o.post7_vs_pre7_pct,
    o.post7_market_price_change_pct,
    o.empirical_timing
  from public.market_intel_video_market_response v
  join public.market_intel_signal_outcomes o
    on o.user_id=v.user_id and o.intel_id=v.intel_id and o.oracle_id=v.oracle_id
  where o.empirical_timing not in ('pending','unmeasured')
)
select
  user_id,creator_key,max(source_name) as source_name,primary_event_type,price_band,
  count(*)::integer as mature_signals,
  round(avg(post7_vs_pre7_pct),1) as avg_post7_velocity_change_pct,
  round(avg(post7_market_price_change_pct),1) as avg_post7_market_price_change_pct,
  round(100.0*count(*) filter(where empirical_timing='predictive')/nullif(count(*),0),1) as predictive_pct,
  round(100.0*count(*) filter(where empirical_timing='confirming')/nullif(count(*),0),1) as confirming_pct,
  round(100.0*count(*) filter(where empirical_timing='reactive')/nullif(count(*),0),1) as reactive_pct,
  least(100,greatest(0,round(50 + coalesce(avg(post7_vs_pre7_pct),0)*0.5 + coalesce(avg(post7_market_price_change_pct),0)*2)))::integer as empirical_reaction_score
from mature
group by user_id,creator_key,primary_event_type,price_band;

create or replace view public.market_intel_video_opportunity_gap with (security_invoker=true) as
with base as (
  select v.*,
    case
      when coalesce(v.baseline_market_price,0) < 5 then 'under_5'
      when coalesce(v.baseline_market_price,0) < 15 then '5_to_15'
      when coalesce(v.baseline_market_price,0) < 40 then '15_to_40'
      else '40_plus'
    end as price_band,
    round(v.catalyst_impact_score*0.75)::integer as prior_expected_reaction_score
  from public.market_intel_video_market_response v
), joined as (
  select b.*,
    c.mature_signals as cohort_mature_signals,
    c.empirical_reaction_score as cohort_empirical_reaction_score,
    c.avg_post7_velocity_change_pct as cohort_avg_post7_velocity_change_pct,
    c.avg_post7_market_price_change_pct as cohort_avg_post7_market_price_change_pct,
    c.predictive_pct as cohort_predictive_pct,
    s.measured_signals as source_measured_signals,
    greatest(0,coalesce(s.measured_signals,0)-coalesce(s.pending_signals,0)-coalesce(s.unmeasured_signals,0))::integer as source_mature_signals,
    least(100,greatest(0,round(50 + coalesce(s.avg_post7_vs_pre7_pct,0)*0.5 + coalesce(s.avg_post7_market_price_change_pct,0)*2)))::integer as source_empirical_reaction_score
  from base b
  left join public.market_intel_video_outcome_cohorts c
    on c.user_id=b.user_id
   and c.creator_key=lower(b.source_name)
   and c.primary_event_type=b.primary_event_type
   and c.price_band=b.price_band
  left join public.market_intel_source_outcomes s
    on s.user_id=b.user_id and s.source_key=lower(b.source_name)
), scored as (
  select j.*,
    case
      when coalesce(cohort_mature_signals,0)>=20 then round(prior_expected_reaction_score*0.50 + cohort_empirical_reaction_score*0.50)
      when coalesce(cohort_mature_signals,0)>=10 then round(prior_expected_reaction_score*0.65 + cohort_empirical_reaction_score*0.35)
      when coalesce(cohort_mature_signals,0)>=5 then round(prior_expected_reaction_score*0.80 + cohort_empirical_reaction_score*0.20)
      when coalesce(source_mature_signals,0)>=20 then round(prior_expected_reaction_score*0.80 + source_empirical_reaction_score*0.20)
      else prior_expected_reaction_score
    end::integer as expected_market_reaction_score,
    case
      when coalesce(cohort_mature_signals,0)>=20 then 'cohort_calibrated'
      when coalesce(cohort_mature_signals,0)>=10 then 'cohort_learning'
      when coalesce(cohort_mature_signals,0)>=5 then 'early_cohort_learning'
      when coalesce(source_mature_signals,0)>=20 then 'source_calibrated'
      else 'prior_only'
    end::text as expected_reaction_confidence
  from joined j
)
select s.*,
  greatest(0,expected_market_reaction_score-coalesce(market_response_score,0))::integer as unpriced_catalyst_gap_score,
  case
    when expected_market_reaction_score-coalesce(market_response_score,0)>=50 then 'large_unpriced_gap'
    when expected_market_reaction_score-coalesce(market_response_score,0)>=30 then 'meaningful_unpriced_gap'
    when expected_market_reaction_score-coalesce(market_response_score,0)>=15 then 'partial_gap'
    when coalesce(market_response_score,0)>=expected_market_reaction_score then 'market_caught_up'
    else 'small_gap'
  end::text as unpriced_catalyst_gap_state
from scored s;

revoke all on public.market_intel_video_outcome_cohorts from public,anon;
revoke all on public.market_intel_video_opportunity_gap from public,anon;
grant select on public.market_intel_video_outcome_cohorts to authenticated,service_role;
grant select on public.market_intel_video_opportunity_gap to authenticated,service_role;
