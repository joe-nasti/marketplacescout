-- Unified per-SKU opportunity context for Scout.
-- Combines execution-grade economics, Signal corroboration and creator catalyst/market-response context.
-- This view is presentation/prioritization only and never mutates Scout score or grade.

create or replace view public.scout_opportunity_context
with (security_invoker=true)
as
with scout_identity as (
  select s.*,
    coalesce(mc1.scryfall_oracle_id,mc2.scryfall_oracle_id) as oracle_id
  from public.scout_opportunities_v5 s
  left join public.mtgjson_cards mc1 on mc1.scryfall_id=s.scryfall_id
  left join public.mtgjson_cards mc2 on mc2.uuid=s.mtgjson_uuid
), video_ranked as (
  select v.*,
    row_number() over (
      partition by v.user_id,v.oracle_id
      order by v.unpriced_catalyst_gap_score desc nulls last,
               v.catalyst_impact_score desc nulls last,
               v.latest_captured_at desc nulls last,
               v.baseline_captured_at desc nulls last
    ) as rn
  from public.market_intel_video_opportunity_gap v
  where v.oracle_id is not null
), base as (
  select
    s.user_id,s.sku_id,s.product_id,s.product_name,s.set_name,s.set_code,s.collector_number,
    s.printing,s.condition,s.language,s.scryfall_id,s.oracle_id,
    s.promoted_grade,s.promoted_score,s.avg_daily_qty_sold,s.sales_rank,
    s.cheapest_buy,s.cheapest_source,s.direct_low,s.direct_net_est,s.direct_net_profit,s.direct_available,s.direct_listings,
    s.ck_buylist,s.buylist_backed,s.buylist_spread,s.buylist_roi_pct,s.source_verify,s.confidence_label as scout_confidence_label,
    nullif(s.score_components->>'directRealizationFactor','')::numeric as direct_realization_factor,
    coalesce(c.signal_count,0)::integer as signal_count,
    coalesce(c.independent_sources,0)::integer as signal_independent_sources,
    coalesce(c.leading_sources,0)::integer as signal_leading_sources,
    coalesce(c.confirming_sources,0)::integer as signal_confirming_sources,
    coalesce(c.exact_signal_count,0)::integer as exact_signal_count,
    coalesce(c.inherited_signal_count,0)::integer as inherited_signal_count,
    coalesce(c.interest_exact_signal_count,0)::integer as interest_exact_signal_count,
    coalesce(c.interest_inherited_signal_count,0)::integer as interest_inherited_signal_count,
    coalesce(c.interest_corroborating_printings,0)::integer as interest_corroborating_printings,
    coalesce(c.priority_boost,0)::integer as signal_priority_boost,
    coalesce(c.confidence_label,'no_signal')::text as signal_confidence_label,
    c.confidence_reason as signal_confidence_reason,c.latest_signal_at,
    v.intel_id as catalyst_intel_id,v.source_name as catalyst_source_name,v.source_url as catalyst_source_url,v.title as catalyst_title,
    v.primary_event_type,v.content_conviction_score,v.catalyst_impact_score,v.convergence_score,
    v.independent_source_count as catalyst_independent_sources,v.independent_creator_count,v.independent_nonvideo_source_count,
    v.expected_market_reaction_score,v.expected_reaction_confidence,v.market_response_score,v.market_response_status,
    v.unpriced_catalyst_gap_score,v.unpriced_catalyst_gap_state,v.catalyst_market_state,v.latest_horizon,
    v.market_price_change_pct,v.direct_low_change_pct,v.direct_available_change_pct,v.transaction_velocity_lift_30d_pct
  from scout_identity s
  left join public.market_intel_scout_confidence_sku c on c.user_id=s.user_id and c.sku_id=s.sku_id
  left join video_ranked v on v.user_id=s.user_id and v.oracle_id=s.oracle_id and v.rn=1
), scored as (
  select b.*,
    case
      when promoted_grade not in ('A','B') then 0
      when coalesce(unpriced_catalyst_gap_score,0)>=50 and coalesce(catalyst_impact_score,0)>=70 then 5
      when coalesce(unpriced_catalyst_gap_score,0)>=30 and coalesce(catalyst_impact_score,0)>=60 then 4
      when coalesce(unpriced_catalyst_gap_score,0)>=15 and coalesce(catalyst_impact_score,0)>=50 then 2
      else 0
    end::integer as catalyst_priority_boost,
    array_remove(array[
      case when coalesce(avg_daily_qty_sold,0)<0.5 then 'low_exact_sku_liquidity' end,
      case when interest_inherited_signal_count>0 and interest_exact_signal_count=0 and interest_corroborating_printings<2 then 'related_printing_only' end,
      case when coalesce(direct_realization_factor,1)<0.5 then 'weak_direct_realization' end,
      case when not coalesce(buylist_backed,false) then 'no_buylist_floor' end,
      case when signal_confidence_label='mixed_or_bearish' then 'mixed_or_bearish_signals' end,
      case when unpriced_catalyst_gap_state='market_caught_up' then 'market_already_caught_up' end
    ],null)::text[] as risk_flags
  from base b
), final as (
  select s.*,
    case when promoted_grade in ('A','B') then least(12,signal_priority_boost+catalyst_priority_boost) else 0 end::integer as context_priority_boost,
    case
      when promoted_grade not in ('A','B') then 'context_only'
      when unpriced_catalyst_gap_state='market_caught_up'
        or (expected_market_reaction_score is not null and coalesce(market_response_score,0)>=expected_market_reaction_score) then 'confirmed_late'
      when interest_exact_signal_count>0 and interest_corroborating_printings<2
        and coalesce(signal_independent_sources,0)<2 and coalesce(unpriced_catalyst_gap_score,0)<30 then 'printing_specific'
      when (
          signal_confidence_label in ('corroborated','strong_corroboration')
          or coalesce(unpriced_catalyst_gap_score,0)>=30
        ) and coalesce(avg_daily_qty_sold,0)>=0.5
        and not ('related_printing_only'=any(risk_flags)) then 'act_now'
      when signal_confidence_label in ('emerging','corroborated','strong_corroboration')
        or coalesce(unpriced_catalyst_gap_score,0)>=15 then 'watch_closely'
      else 'standard'
    end::text as urgency_state
  from scored s
)
select f.*,
  (promoted_score + context_priority_boost)::integer as discovery_priority_score,
  case urgency_state
    when 'act_now' then 'Strong Scout execution plus external/catalyst support with room for the market to react.'
    when 'watch_closely' then 'Scout economics are actionable, but external evidence or market timing is still developing.'
    when 'confirmed_late' then 'The catalyst is supported, but measured market response has largely caught up.'
    when 'printing_specific' then 'Movement is concentrated in this printing; broader card-level demand is not yet corroborated.'
    when 'context_only' then 'External context is retained, but this SKU is outside Scout A/B execution quality.'
    else 'Scout economics remain the primary thesis; no high-urgency external catalyst is currently established.'
  end::text as urgency_reason
from final f;

revoke all on public.scout_opportunity_context from public,anon;
grant select on public.scout_opportunity_context to authenticated,service_role;
