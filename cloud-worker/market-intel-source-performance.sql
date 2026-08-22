-- MarketplaceScout source/author timing profiles.
-- Production migration: market_intel_source_performance

create or replace view public.market_intel_source_performance
with (security_invoker=true)
as
select
  i.user_id,
  coalesce(nullif(i.source_name,''),i.source_type) as source_name,
  coalesce(nullif(i.author,''),'Unknown') as author,
  count(*)::integer as total_claims,
  count(v.evaluation_id)::integer as covered_claims,
  count(*) filter (where v.market_stage='early')::integer as early_claims,
  count(*) filter (where v.market_stage='confirming')::integer as confirming_claims,
  count(*) filter (where v.market_stage='late')::integer as late_claims,
  count(*) filter (where v.market_stage='insufficient_data')::integer as insufficient_claims,
  count(distinct i.source_url)::integer as source_items,
  round(100.0 * count(v.evaluation_id) / nullif(count(*),0),1) as coverage_pct,
  round(100.0 * count(*) filter (where v.market_stage='early') / nullif(count(*) filter (where v.market_stage in ('early','confirming','late')),0),1) as early_pct,
  round(100.0 * count(*) filter (where v.market_stage='confirming') / nullif(count(*) filter (where v.market_stage in ('early','confirming','late')),0),1) as confirming_pct,
  round(100.0 * count(*) filter (where v.market_stage='late') / nullif(count(*) filter (where v.market_stage in ('early','confirming','late')),0),1) as late_pct,
  round(100.0 * avg(case v.market_stage when 'early' then 1.0 when 'confirming' then 0.6 when 'late' then 0.2 else null end),1) as timing_score,
  round(avg(i.confidence)*100,1) as avg_extraction_confidence,
  max(i.observed_at) as latest_observed_at
from public.market_intel_items i
join public.market_intel_entities e on e.intel_id=i.intel_id and e.user_id=i.user_id and e.entity_type='card'
left join public.market_intel_evaluations v on v.intel_entity_id=e.intel_entity_id and v.user_id=e.user_id
group by i.user_id,coalesce(nullif(i.source_name,''),i.source_type),coalesce(nullif(i.author,''),'Unknown');
