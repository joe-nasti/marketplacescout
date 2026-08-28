create or replace view public.market_intel_scout_synergy_opportunities
with (security_invoker = true)
as
select
  r.relationship_id, r.user_id, r.source_intel_id, r.source_video_id, r.source_name, r.source_url,
  r.source_card_name, r.source_scryfall_id, r.source_release_date,
  r.target_card_name, r.target_scryfall_id, r.relationship_type, r.conviction, r.start_ms,
  r.evidence, r.summary, r.source_is_unreleased, r.target_is_actionable,
  g.oracle_id, g.content_conviction_score, g.catalyst_impact_score, g.convergence_score,
  g.expected_market_reaction_score, g.expected_reaction_confidence,
  g.market_response_score, g.market_response_status,
  g.unpriced_catalyst_gap_score, g.unpriced_catalyst_gap_state,
  g.latest_horizon, g.market_price_change_pct, g.direct_low_change_pct,
  g.direct_available_change_pct, g.transaction_velocity_lift_30d_pct,
  c.sku_id, c.product_id, c.product_name, c.set_name, c.set_code, c.collector_number,
  c.printing, c.condition, c.language,
  c.promoted_grade as scout_grade, c.promoted_score as scout_score,
  c.cheapest_buy, c.cheapest_source, c.direct_low, c.direct_net_est, c.direct_net_profit,
  c.avg_daily_qty_sold, c.sales_rank, c.direct_available, c.direct_listings,
  c.ck_buylist, c.buylist_backed, c.buylist_spread, c.buylist_roi_pct,
  c.scout_confidence_label, c.risk_flags,
  round((0.45 * coalesce(c.promoted_score,0)) +
        (0.35 * coalesce(g.unpriced_catalyst_gap_score,0)) +
        (0.20 * (coalesce(r.conviction,0) * 100)))::int as synergy_priority_score,
  row_number() over (
    partition by r.user_id, r.relationship_id
    order by c.promoted_score desc nulls last,
             c.direct_net_profit desc nulls last,
             c.cheapest_buy asc nulls last,
             c.sku_id
  ) as synergy_printing_rank
from public.market_intel_card_relationships r
join public.market_intel_video_opportunity_gap g
  on g.user_id=r.user_id and g.intel_id=r.source_intel_id
join public.scout_opportunity_context c
  on c.user_id=r.user_id and c.oracle_id=g.oracle_id
where r.direction='bullish' and r.target_is_actionable=true;

grant select on public.market_intel_scout_synergy_opportunities to authenticated;
