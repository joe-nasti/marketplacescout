-- Ongoing audit of how external Signal context overlaps with execution-qualified Scout A/B cards.
-- This is diagnostic/prioritization data only. It does not change Scout grade or economics.

create or replace view public.scout_signal_ab_audit
with (security_invoker=true)
as
select
  s.sku_id,
  s.product_id,
  s.product_name,
  s.set_name,
  s.printing,
  s.condition,
  s.language,
  s.promoted_grade,
  s.promoted_score,
  s.avg_daily_qty_sold,
  coalesce(c.confidence_label,'no_signal')::text as signal_confidence_label,
  coalesce(c.priority_boost,0)::integer as signal_priority_boost,
  (s.promoted_score + coalesce(c.priority_boost,0))::numeric as discovery_priority_score,
  coalesce(c.independent_sources,0)::integer as independent_sources,
  coalesce(c.leading_sources,0)::integer as leading_sources,
  coalesce(c.confirming_sources,0)::integer as confirming_sources,
  coalesce(c.exact_signal_count,0)::integer as exact_signal_count,
  coalesce(c.inherited_signal_count,0)::integer as inherited_signal_count,
  coalesce(c.interest_exact_signal_count,0)::integer as interest_exact_signal_count,
  coalesce(c.interest_inherited_signal_count,0)::integer as interest_inherited_signal_count,
  coalesce(c.interest_corroborating_printings,0)::integer as interest_corroborating_printings,
  c.latest_signal_at,
  case
    when c.sku_id is null then 'no_signal'
    when coalesce(c.interest_corroborating_printings,0)>=2 then 'cross_print_corroborated'
    when coalesce(c.interest_exact_signal_count,0)>0 then 'interests_exact_sku'
    when coalesce(c.interest_inherited_signal_count,0)>0 and coalesce(c.interest_exact_signal_count,0)=0 then 'interests_related_printing'
    when coalesce(c.exact_signal_count,0)>0 and coalesce(c.inherited_signal_count,0)=0 then 'exact_printing'
    when coalesce(c.inherited_signal_count,0)>0 then 'oracle_family'
    else 'underlying_card'
  end::text as signal_scope,
  case when coalesce(c.independent_sources,0)>=2 then true else false end as multi_source,
  case when coalesce(c.priority_boost,0)>0 then true else false end as signal_prioritized
from public.scout_opportunities_v5 s
left join public.market_intel_scout_confidence_sku c on c.sku_id=s.sku_id
where s.promoted_grade in ('A','B');

create or replace view public.scout_signal_ab_audit_summary
with (security_invoker=true)
as
select
  promoted_grade,
  signal_confidence_label,
  signal_scope,
  count(*)::integer as cards,
  count(*) filter(where multi_source)::integer as multi_source_cards,
  count(*) filter(where signal_prioritized)::integer as signal_prioritized_cards,
  round(avg(promoted_score),2) as avg_scout_score,
  round(avg(discovery_priority_score),2) as avg_discovery_priority_score,
  round(avg(avg_daily_qty_sold),3) filter(where avg_daily_qty_sold is not null) as avg_exact_sku_sales_per_day,
  max(latest_signal_at) as latest_signal_at
from public.scout_signal_ab_audit
group by promoted_grade,signal_confidence_label,signal_scope;

revoke all on public.scout_signal_ab_audit from public,anon;
revoke all on public.scout_signal_ab_audit_summary from public,anon;
grant select on public.scout_signal_ab_audit to authenticated,service_role;
grant select on public.scout_signal_ab_audit_summary to authenticated,service_role;
