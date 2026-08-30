create or replace view public.market_intel_catalyst_candidate_backtest
with (security_invoker=true)
as
with signal_parts as (
  select b.snapshot_id,b.user_id,x.intel_id,i.source_type,
    coalesce(nullif(trim(i.author),''),nullif(trim(i.source_name),''),nullif(trim(i.source_type),''),'Unknown') source_label,
    case lower(coalesce(i.signal_stage,'')) when 'leading' then 2.25 when 'confirming' then 3.25 when 'lagging' then 0.75 when 'neutral' then 0 when 'noise' then 0 when 'unclassified' then 0.25 else 0.25 end
    * case lower(coalesce(i.direction,'')) when 'bullish' then 1 when 'bearish' then -1 else 0 end
    * case lower(coalesce(i.source_type,'')) when 'official' then 1.25 when 'article' then 1.00 when 'youtube' then 1.00 when 'x' then 0.80 when 'twitter' then 0.80 when 'reddit' then 0.65 when 'discord' then 0.55 when 'manual' then 0.50 when 'other' then 0.50 else 0.75 end
    * case when extract(epoch from (b.captured_at-i.observed_at))/86400.0 <= 2 then 1.00 when extract(epoch from (b.captured_at-i.observed_at))/86400.0 <= 7 then 0.90 when extract(epoch from (b.captured_at-i.observed_at))/86400.0 <= 21 then 0.70 when extract(epoch from (b.captured_at-i.observed_at))/86400.0 <= 45 then 0.45 when extract(epoch from (b.captured_at-i.observed_at))/86400.0 <= 90 then 0.25 else 0.10 end
    * greatest(0.35,least(1.0,case when i.confidence is null then 1.0 when i.confidence>1 then i.confidence/100.0 else i.confidence end)) current_signal_points,
    coalesce(c.candidate_weight,1.0) candidate_weight,
    (c.candidate_weight is not null) has_candidate_weight
  from public.market_intel_catalyst_shadow_backtest b
  cross join lateral unnest(b.intel_ids) x(intel_id)
  join public.market_intel_items i on i.user_id=b.user_id and i.intel_id=x.intel_id
  left join public.market_intel_catalyst_candidate_weights c on c.user_id=b.user_id and lower(c.source_label)=lower(coalesce(nullif(trim(i.author),''),nullif(trim(i.source_name),''),nullif(trim(i.source_type),''),'Unknown'))
), agg as (
  select snapshot_id,user_id,sum(current_signal_points) current_signal_points,sum(current_signal_points*candidate_weight) candidate_signal_points,
    count(*) filter(where has_candidate_weight) candidate_weighted_signals,
    count(distinct lower(source_label)) filter(where has_candidate_weight) candidate_weighted_sources
  from signal_parts group by snapshot_id,user_id
), rescored as (
  select b.*,coalesce(a.current_signal_points,0) reconstructed_signal_points,
    b.raw_modifier-coalesce(a.current_signal_points,0) preserved_non_source_points,
    coalesce(a.candidate_signal_points,a.current_signal_points,0) candidate_signal_points,
    coalesce(a.candidate_weighted_signals,0) candidate_weighted_signals,
    coalesce(a.candidate_weighted_sources,0) candidate_weighted_sources,
    (coalesce(a.candidate_weighted_sources,0)>0) candidate_model_active,
    (b.raw_modifier-coalesce(a.current_signal_points,0)+coalesce(a.candidate_signal_points,a.current_signal_points,0)) candidate_raw_modifier
  from public.market_intel_catalyst_shadow_backtest b left join agg a on a.snapshot_id=b.snapshot_id and a.user_id=b.user_id
)
select r.*,
  greatest(-8,least(12,round(r.candidate_raw_modifier)))::numeric candidate_modifier,
  case when r.future_release then 0 else greatest(-8,least(12,round(r.candidate_raw_modifier)))::numeric end candidate_applied_modifier,
  greatest(0,least(100,r.official_score + case when r.future_release then 0 else greatest(-8,least(12,round(r.candidate_raw_modifier))) end))::numeric candidate_shadow_score,
  case when greatest(0,least(100,r.official_score + case when r.future_release then 0 else greatest(-8,least(12,round(r.candidate_raw_modifier))) end))>=80 then 'A'
       when greatest(0,least(100,r.official_score + case when r.future_release then 0 else greatest(-8,least(12,round(r.candidate_raw_modifier))) end))>=70 then 'B'
       when greatest(0,least(100,r.official_score + case when r.future_release then 0 else greatest(-8,least(12,round(r.candidate_raw_modifier))) end))>=60 then 'C'
       when greatest(0,least(100,r.official_score + case when r.future_release then 0 else greatest(-8,least(12,round(r.candidate_raw_modifier))) end))>=50 then 'D' else 'F' end candidate_shadow_grade
from rescored r;

create or replace view public.market_intel_catalyst_candidate_model_metrics
with (security_invoker=true)
as
with matured as (
  select * from public.market_intel_catalyst_candidate_backtest where not future_release and matured_7d
), grouped as (
  select user_id,count(*) matured_7d,count(*) filter(where candidate_model_active) candidate_affected_snapshots,
    avg(market_change_7d_pct) filter(where shadow_modifier>=4) current_high_avg_7d,
    avg(market_change_7d_pct) filter(where shadow_modifier<=0) current_low_avg_7d,
    avg(market_change_7d_pct) filter(where candidate_applied_modifier>=4) candidate_high_avg_7d,
    avg(market_change_7d_pct) filter(where candidate_applied_modifier<=0) candidate_low_avg_7d,
    avg(transactions_7d) filter(where shadow_modifier>=4) current_high_tx_7d,
    avg(transactions_7d) filter(where candidate_applied_modifier>=4) candidate_high_tx_7d
  from matured group by user_id
)
select user_id,matured_7d,candidate_affected_snapshots,
  round(current_high_avg_7d,2) current_high_avg_7d,round(current_low_avg_7d,2) current_low_avg_7d,
  round(current_high_avg_7d-current_low_avg_7d,2) current_separation_7d,
  round(candidate_high_avg_7d,2) candidate_high_avg_7d,round(candidate_low_avg_7d,2) candidate_low_avg_7d,
  round(candidate_high_avg_7d-candidate_low_avg_7d,2) candidate_separation_7d,
  round((candidate_high_avg_7d-candidate_low_avg_7d)-(current_high_avg_7d-current_low_avg_7d),2) separation_lift_7d,
  round(current_high_tx_7d,2) current_high_tx_7d,round(candidate_high_tx_7d,2) candidate_high_tx_7d
from grouped;

revoke all on public.market_intel_catalyst_candidate_backtest from anon;
revoke all on public.market_intel_catalyst_candidate_model_metrics from anon;
grant select on public.market_intel_catalyst_candidate_backtest to authenticated;
grant select on public.market_intel_catalyst_candidate_model_metrics to authenticated;
