-- Unified per-SKU opportunity context for Scout.
-- Combines execution-grade economics, Signal corroboration, creator catalyst/market-response context,
-- and printing-specific demand classification. This view does not change Scout grade or economics.

create or replace view public.scout_opportunity_context
with (security_invoker=true)
as
with scout_identity as (
  select s.*,
    coalesce(mc1.scryfall_oracle_id,mc2.scryfall_oracle_id) as oracle_id,
    coalesce(mc1.release_date,mc2.release_date) as current_printing_release_date
  from public.scout_opportunities_v5 s
  left join public.mtgjson_cards mc1 on mc1.scryfall_id=s.scryfall_id
  left join public.mtgjson_cards mc2 on mc2.uuid=s.mtgjson_uuid
), oracle_release as (
  select
    scryfall_oracle_id as oracle_id,
    max(release_date) filter (where release_date<=current_date) as newest_family_release_date,
    count(distinct coalesce(tcgplayer_product_id,uuid::text)) filter (where release_date<=current_date)::integer as family_printing_count
  from public.mtgjson_cards
  where scryfall_oracle_id is not null
  group by scryfall_oracle_id
), family_finish_stats as (
  select
    user_id,oracle_id,upper(coalesce(printing,'')) as finish_key,
    percentile_cont(0.5) within group (order by sku_market_price)
      filter (where sku_market_price is not null and sku_market_price>0) as finish_family_market_median
  from scout_identity
  where oracle_id is not null
    and lower(coalesce(condition,'')) in ('near mint','nm')
    and lower(coalesce(language,'')) in ('english','en')
  group by user_id,oracle_id,upper(coalesce(printing,''))
), printing_profile_raw as (
  select
    s.user_id,s.sku_id,s.oracle_id,
    s.sku_market_price as printing_market_price,
    fs.finish_family_market_median,
    case when fs.finish_family_market_median>0 and s.sku_market_price>0
      then s.sku_market_price/fs.finish_family_market_median end as printing_premium_ratio,
    s.current_printing_release_date,
    r.newest_family_release_date,
    case when r.newest_family_release_date is not null
      then (current_date-r.newest_family_release_date)::integer end as days_since_newest_family_release,
    coalesce(r.family_printing_count,0)::integer as family_printing_count,
    coalesce(c.interest_exact_signal_count,0)::integer as interest_exact_signal_count,
    coalesce(c.interest_corroborating_printings,0)::integer as interest_corroborating_printings,
    coalesce(c.independent_sources,0)::integer as signal_independent_sources,
    coalesce(s.avg_daily_qty_sold,0) as avg_daily_qty_sold,
    coalesce(s.buylist_backed,false) as buylist_backed,
    (
      coalesce(c.interest_exact_signal_count,0)>0
      and r.newest_family_release_date is not null
      and s.current_printing_release_date is not null
      and r.newest_family_release_date>s.current_printing_release_date+30
      and r.newest_family_release_date>=current_date-365
      and coalesce(s.avg_daily_qty_sold,0)>=0.1
      and (fs.finish_family_market_median is null or s.sku_market_price is null
        or s.sku_market_price/fs.finish_family_market_median>=0.90)
    ) as reprint_migration_evidence,
    (
      coalesce(c.interest_exact_signal_count,0)>0
      and coalesce(s.avg_daily_qty_sold,0)>=0.1
      and (
        (fs.finish_family_market_median>0 and s.sku_market_price>0
          and s.sku_market_price/fs.finish_family_market_median>=1.25)
        or lower(coalesce(s.set_name,'')) similar to '%(secret lair|judge|masterpiece|promo)%'
        or (
          upper(coalesce(s.printing,'')) like '%FOIL%'
          and fs.finish_family_market_median>0 and s.sku_market_price>0
          and s.sku_market_price/fs.finish_family_market_median>=1.10
        )
      )
    ) as prestige_evidence
  from scout_identity s
  left join public.market_intel_scout_confidence_sku c on c.user_id=s.user_id and c.sku_id=s.sku_id
  left join oracle_release r on r.oracle_id=s.oracle_id
  left join family_finish_stats fs on fs.user_id=s.user_id and fs.oracle_id=s.oracle_id
    and fs.finish_key=upper(coalesce(s.printing,''))
), printing_profile as (
  select p.*,
    case
      when p.interest_exact_signal_count=0 then 'not_printing_specific'
      when p.interest_corroborating_printings>=2 then 'broad_card_demand'
      when p.reprint_migration_evidence then 'reprint_migration'
      when p.prestige_evidence then 'prestige_printing'
      when p.avg_daily_qty_sold<0.1 and not p.buylist_backed and p.signal_independent_sources<2 then 'thin_print_anomaly'
      else 'unknown_printing_specific'
    end::text as printing_demand_class
  from printing_profile_raw p
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
      when b.promoted_grade not in ('A','B') then 0
      when coalesce(b.unpriced_catalyst_gap_score,0)>=50 and coalesce(b.catalyst_impact_score,0)>=70 then 5
      when coalesce(b.unpriced_catalyst_gap_score,0)>=30 and coalesce(b.catalyst_impact_score,0)>=60 then 4
      when coalesce(b.unpriced_catalyst_gap_score,0)>=15 and coalesce(b.catalyst_impact_score,0)>=50 then 2
      else 0
    end::integer as catalyst_priority_boost,
    array_remove(array[
      case when coalesce(b.avg_daily_qty_sold,0)<0.5 then 'low_exact_sku_liquidity' end,
      case when p.printing_demand_class='thin_print_anomaly' then 'thin_print_anomaly' end,
      case when coalesce(b.direct_realization_factor,1)<0.5 then 'weak_direct_realization' end,
      case when not coalesce(b.buylist_backed,false) then 'no_buylist_floor' end,
      case when b.signal_confidence_label='mixed_or_bearish' then 'mixed_or_bearish_signals' end,
      case when b.unpriced_catalyst_gap_state='market_caught_up' then 'market_already_caught_up' end
    ],null)::text[] as risk_flags
  from base b
  left join printing_profile p on p.user_id=b.user_id and p.sku_id=b.sku_id
), final as (
  select s.*,
    case when s.promoted_grade in ('A','B') then least(12,s.signal_priority_boost+s.catalyst_priority_boost) else 0 end::integer as context_priority_boost,
    case
      when s.promoted_grade not in ('A','B') then 'context_only'
      when s.unpriced_catalyst_gap_state='market_caught_up'
        or (s.expected_market_reaction_score is not null and coalesce(s.market_response_score,0)>=s.expected_market_reaction_score) then 'confirmed_late'
      when (
          s.signal_confidence_label in ('corroborated','strong_corroboration')
          or coalesce(s.unpriced_catalyst_gap_score,0)>=30
          or p.printing_demand_class='broad_card_demand'
        ) and coalesce(s.avg_daily_qty_sold,0)>=0.5
        and coalesce(p.printing_demand_class,'')<>'thin_print_anomaly' then 'act_now'
      when p.printing_demand_class in ('thin_print_anomaly','unknown_printing_specific')
        and s.interest_exact_signal_count>0 and s.interest_corroborating_printings<2
        and coalesce(s.signal_independent_sources,0)<2 and coalesce(s.unpriced_catalyst_gap_score,0)<30 then 'printing_specific'
      when s.signal_confidence_label in ('emerging','corroborated','strong_corroboration')
        or coalesce(s.unpriced_catalyst_gap_score,0)>=15
        or p.printing_demand_class in ('reprint_migration','prestige_printing','broad_card_demand') then 'watch_closely'
      else 'standard'
    end::text as urgency_state
  from scored s
  left join printing_profile p on p.user_id=s.user_id and p.sku_id=s.sku_id
)
select f.*,
  (f.promoted_score+f.context_priority_boost)::integer as discovery_priority_score,
  case
    when f.urgency_state='act_now' and p.printing_demand_class='broad_card_demand'
      then 'Multiple printings are moving with actionable Scout execution; this looks like card-level demand rather than an isolated SKU.'
    when f.urgency_state='watch_closely' and p.printing_demand_class='reprint_migration'
      then 'Demand is concentrating into this older printing after a newer reprint; exact-SKU sales support a reprint-migration thesis.'
    when f.urgency_state='watch_closely' and p.printing_demand_class='prestige_printing'
      then 'This exact printing is showing supported demand with collector-oriented treatment or same-finish premium evidence.'
    when f.urgency_state='printing_specific' and p.printing_demand_class='thin_print_anomaly'
      then 'The price move is isolated and exact-SKU sales depth is thin, so scarcity noise remains a material risk.'
    when f.urgency_state='printing_specific'
      then 'Movement is concentrated in this printing, but there is not yet enough evidence to classify it as reprint migration, prestige demand, or a thin-market anomaly.'
    when f.urgency_state='act_now' then 'Strong Scout execution plus external/catalyst support with room for the market to react.'
    when f.urgency_state='watch_closely' then 'Scout economics are actionable, but external evidence or market timing is still developing.'
    when f.urgency_state='confirmed_late' then 'The catalyst is supported, but measured market response has largely caught up.'
    when f.urgency_state='context_only' then 'External context is retained, but this SKU is outside Scout A/B execution quality.'
    else 'Scout economics remain the primary thesis; no high-urgency external catalyst is currently established.'
  end::text as urgency_reason,
  coalesce(p.printing_demand_class,'not_printing_specific')::text as printing_demand_class,
  case coalesce(p.printing_demand_class,'not_printing_specific')
    when 'broad_card_demand' then 'Multiple printings in the Oracle family are moving together.'
    when 'reprint_migration' then 'A newer reprint landed recently while this older printing is moving with measurable exact-SKU sales.'
    when 'prestige_printing' then 'This exact printing is moving with measurable sales and carries a current premium or collector-oriented treatment signal.'
    when 'thin_print_anomaly' then 'This exact printing moved without enough sales depth, buylist support, or independent corroboration to rule out thin-market noise.'
    when 'unknown_printing_specific' then 'This exact printing is moving, but current evidence does not yet identify the cause.'
    else 'No exact-printing MTGStocks movement is currently attached to this SKU.'
  end::text as printing_demand_reason,
  p.printing_market_price,
  p.finish_family_market_median as printing_finish_family_median,
  p.printing_premium_ratio,
  p.current_printing_release_date,
  p.newest_family_release_date,
  p.days_since_newest_family_release,
  p.family_printing_count,
  coalesce(p.reprint_migration_evidence,false) as reprint_migration_evidence,
  coalesce(p.prestige_evidence,false) as prestige_evidence
from final f
left join printing_profile p on p.user_id=f.user_id and p.sku_id=f.sku_id;

revoke all on public.scout_opportunity_context from public,anon;
grant select on public.scout_opportunity_context to authenticated,service_role;
