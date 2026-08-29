-- Read-only proposed source weights for catalyst shadow calibration.
-- Production source weights remain unchanged; this view only recommends a bounded shadow adjustment.

create or replace view public.market_intel_catalyst_shadow_weight_proposals
with (security_invoker=true)
as
with source_rows as (
  select s.*,
         case lower(coalesce(s.source_type,''))
           when 'official' then 1.25::numeric
           when 'article' then 1.00::numeric
           when 'youtube' then 1.00::numeric
           when 'x' then 0.80::numeric
           when 'twitter' then 0.80::numeric
           when 'reddit' then 0.65::numeric
           when 'discord' then 0.55::numeric
           when 'manual' then 0.50::numeric
           when 'other' then 0.50::numeric
           else 0.75::numeric
         end as current_weight
  from public.market_intel_catalyst_shadow_source_backtest s
), history as (
  select user_id, lower(source_name) as source_key,
         measured_signals, predictive_pct, reactive_pct, confirming_pct,
         avg_post7_market_price_change_pct
  from public.market_intel_source_outcomes
), scored as (
  select s.*,
         coalesce(h.measured_signals,0) as historical_measured_signals,
         h.predictive_pct as historical_predictive_pct,
         h.reactive_pct as historical_reactive_pct,
         h.confirming_pct as historical_confirming_pct,
         h.avg_post7_market_price_change_pct as historical_avg_post7_market_price_change_pct,
         greatest(-1::numeric, least(1::numeric, coalesce(s.avg_market_change_7d_pct,0) / 12.0)) as price_signal,
         case when coalesce(h.measured_signals,0) >= 8
              then greatest(-1::numeric, least(1::numeric,
                   (coalesce(h.predictive_pct,0) + 0.5*coalesce(h.confirming_pct,0) - coalesce(h.reactive_pct,0)) / 100.0))
              else 0::numeric end as timing_signal,
         least(1::numeric, coalesce(s.matured_7d,0)::numeric / 30.0) *
           case when coalesce(h.measured_signals,0) >= 8 then 1::numeric else 0.75::numeric end as confidence_factor
  from source_rows s
  left join history h on h.user_id=s.user_id and h.source_key=lower(s.source_label)
), proposed as (
  select scored.*,
         case when matured_7d >= 8 then
           greatest(-0.15::numeric, least(0.15::numeric,
             (0.65*price_signal + 0.35*timing_signal) * 0.18 * confidence_factor))
         else 0::numeric end as proposed_delta
  from scored
)
select user_id, source_label, source_type, snapshots, avg_modifier,
       matured_1d, matured_3d, matured_7d, matured_30d,
       avg_market_change_1d_pct, avg_market_change_3d_pct, avg_market_change_7d_pct, avg_market_change_30d_pct,
       avg_transactions_1d, avg_transactions_3d, avg_transactions_7d, avg_transactions_30d,
       current_weight,
       case when matured_7d >= 8 then greatest(0.35::numeric, least(1.40::numeric, current_weight + proposed_delta)) else null end as proposed_weight,
       case when matured_7d >= 8 then proposed_delta else null end as proposed_delta,
       confidence_factor,
       historical_measured_signals, historical_predictive_pct, historical_reactive_pct, historical_confirming_pct,
       historical_avg_post7_market_price_change_pct,
       case when matured_7d < 8 then 'insufficient_shadow_sample'
            when confidence_factor < 0.45 then 'low_confidence'
            when confidence_factor < 0.80 then 'medium_confidence'
            else 'high_confidence' end as proposal_confidence,
       case when matured_7d < 8 then 'wait'
            when abs(proposed_delta) < 0.025 then 'hold'
            when proposed_delta > 0 then 'raise'
            else 'lower' end as recommendation
from proposed;

revoke all on public.market_intel_catalyst_shadow_weight_proposals from anon;
grant select on public.market_intel_catalyst_shadow_weight_proposals to authenticated;
