-- MarketplaceScout independent-source rollups for card intelligence.
-- Production migration: market_intel_entity_rollups

create or replace view public.market_intel_entity_rollups
with (security_invoker=true)
as
select
  e.user_id,
  coalesce(e.scryfall_id::text,case when e.product_id is not null then 'product:'||e.product_id end,'name:'||lower(e.entity_name)) as entity_key,
  max(e.entity_name) as entity_name,
  nullif(max(e.scryfall_id::text),'')::uuid as scryfall_id,
  max(e.product_id) as product_id,
  count(*)::integer as claim_count,
  count(distinct i.source_url)::integer as independent_source_count,
  count(*) filter (where i.direction='bullish')::integer as bullish_claims,
  count(*) filter (where i.direction='bearish')::integer as bearish_claims,
  count(distinct i.source_url) filter (where v.market_stage='early')::integer as early_sources,
  count(distinct i.source_url) filter (where v.market_stage='confirming')::integer as confirming_sources,
  count(distinct i.source_url) filter (where v.market_stage='late')::integer as late_sources,
  count(distinct i.source_url) filter (where v.market_stage='insufficient_data' or v.market_stage is null)::integer as unevaluated_sources,
  round(avg((case i.direction when 'bullish' then 1 when 'bearish' then -1 else 0 end)::numeric
    * i.confidence
    * (case coalesce(v.market_stage,'insufficient_data') when 'early' then 1.0 when 'confirming' then 0.65 when 'late' then 0.20 else 0.35 end)) * 100,1) as intel_direction_score,
  max(i.observed_at) as latest_observed_at,
  max(coalesce(i.published_at,i.observed_at)) as latest_source_at
from public.market_intel_entities e
join public.market_intel_items i on i.intel_id=e.intel_id and i.user_id=e.user_id
left join public.market_intel_evaluations v on v.intel_entity_id=e.intel_entity_id and v.user_id=e.user_id
where e.entity_type='card'
group by e.user_id,coalesce(e.scryfall_id::text,case when e.product_id is not null then 'product:'||e.product_id end,'name:'||lower(e.entity_name));
