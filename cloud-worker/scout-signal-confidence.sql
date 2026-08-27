-- Signal confidence overlay for Scout.
-- This intentionally does NOT change Scout grade/economics. It provides a
-- bounded priority boost and explanation based on recent independent Signals.

create or replace view public.market_intel_scout_confidence
with (security_invoker=true)
as
with recent as (
  select distinct
    l.user_id,
    l.product_id,
    l.oracle_id,
    l.canonical_name,
    l.intel_id,
    l.family_match,
    i.source_url,
    i.source_name,
    i.signal_stage,
    i.direction,
    coalesce(i.confidence,0.5)::numeric confidence,
    coalesce(i.published_at,i.observed_at,i.created_at) signal_at,
    case i.signal_stage
      when 'leading' then 1.00
      when 'confirming' then 0.70
      when 'lagging' then 0.25
      else 0.10
    end::numeric stage_weight,
    case
      when coalesce(i.published_at,i.observed_at,i.created_at) >= now()-interval '3 days' then 1.00
      when coalesce(i.published_at,i.observed_at,i.created_at) >= now()-interval '7 days' then 0.85
      when coalesce(i.published_at,i.observed_at,i.created_at) >= now()-interval '14 days' then 0.65
      else 0.40
    end::numeric recency_weight,
    case i.direction when 'bullish' then 1 when 'bearish' then -1 else 0 end::numeric direction_weight,
    coalesce(nullif(i.source_url,''),nullif(i.source_name,''),i.intel_id::text) source_key
  from public.market_intel_scout_signal_links l
  join public.market_intel_items i on i.intel_id=l.intel_id and i.user_id=l.user_id
  where l.product_id is not null
    and coalesce(i.published_at,i.observed_at,i.created_at) >= now()-interval '30 days'
    and coalesce(i.signal_stage,'noise') <> 'noise'
), agg as (
  select
    user_id,product_id,max(oracle_id) oracle_id,max(canonical_name) canonical_name,
    count(distinct intel_id)::int signal_count,
    count(distinct source_key)::int independent_sources,
    count(distinct source_key) filter(where signal_stage='leading')::int leading_sources,
    count(distinct source_key) filter(where signal_stage='confirming')::int confirming_sources,
    count(*) filter(where direction='bullish')::int bullish_signals,
    count(*) filter(where direction='bearish')::int bearish_signals,
    count(*) filter(where family_match)::int inherited_signal_count,
    count(*) filter(where not family_match)::int exact_signal_count,
    max(signal_at) latest_signal_at,
    round(sum(direction_weight*confidence*stage_weight*recency_weight),3) weighted_net
  from recent
  group by user_id,product_id
), scored as (
  select *,
    greatest(0,least(8,
      (case when independent_sources>=3 then 5 when independent_sources=2 then 3 when independent_sources=1 then 1 else 0 end)
      + (case when leading_sources>=1 then 2 else 0 end)
      + (case when latest_signal_at>=now()-interval '3 days' then 1 else 0 end)
    ))::int raw_priority_boost
  from agg
)
select
  user_id,product_id,oracle_id,canonical_name,signal_count,independent_sources,
  leading_sources,confirming_sources,bullish_signals,bearish_signals,
  inherited_signal_count,exact_signal_count,latest_signal_at,weighted_net,
  case when weighted_net>0 then raw_priority_boost else 0 end::int priority_boost,
  case
    when weighted_net<=0 then 'mixed_or_bearish'
    when raw_priority_boost>=6 then 'strong_corroboration'
    when raw_priority_boost>=4 then 'corroborated'
    when raw_priority_boost>=2 then 'emerging'
    else 'context'
  end::text confidence_label,
  case
    when weighted_net<=0 then 'Recent Signals are mixed or bearish; no Scout priority boost.'
    when raw_priority_boost>=6 then 'Multiple recent independent Signals strongly corroborate the underlying card thesis.'
    when raw_priority_boost>=4 then 'Recent independent Signals corroborate the underlying card thesis.'
    when raw_priority_boost>=2 then 'Recent Signals provide emerging support for the underlying card thesis.'
    else 'A recent Signal provides context, but not enough corroboration to materially raise priority.'
  end::text confidence_reason
from scored;

revoke all on public.market_intel_scout_confidence from public, anon;
grant select on public.market_intel_scout_confidence to authenticated;
