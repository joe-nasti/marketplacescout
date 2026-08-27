-- Deduplicate repeated extracted claims from the same source/card event before
-- calculating source-level empirical timing rates.
create or replace view public.market_intel_source_outcomes
with (security_invoker=true)
as
with events as (
  select distinct on (user_id,lower(source_name),coalesce(source_url,''),oracle_id,signal_at)
    user_id,lower(source_name) as source_key,source_name,source_url,oracle_id,signal_at,
    empirical_timing,pre7_vs_prior23_pct,post7_vs_pre7_pct,post7_market_price_change_pct
  from public.market_intel_signal_outcomes
  order by user_id,lower(source_name),coalesce(source_url,''),oracle_id,signal_at,intel_id
)
select
  user_id,source_key,max(source_name) as source_name,count(*)::int as measured_signals,
  count(*) filter(where empirical_timing='pending')::int as pending_signals,
  count(*) filter(where empirical_timing='unmeasured')::int as unmeasured_signals,
  count(*) filter(where empirical_timing='reactive')::int as reactive_signals,
  count(*) filter(where empirical_timing='predictive')::int as predictive_signals,
  count(*) filter(where empirical_timing='confirming')::int as confirming_signals,
  count(*) filter(where empirical_timing='flat_or_unclear')::int as flat_or_unclear_signals,
  round(100.0*count(*) filter(where empirical_timing='reactive')/nullif(count(*) filter(where empirical_timing not in ('pending','unmeasured')),0),1) as reactive_pct,
  round(100.0*count(*) filter(where empirical_timing='predictive')/nullif(count(*) filter(where empirical_timing not in ('pending','unmeasured')),0),1) as predictive_pct,
  round(100.0*count(*) filter(where empirical_timing='confirming')/nullif(count(*) filter(where empirical_timing not in ('pending','unmeasured')),0),1) as confirming_pct,
  round(avg(pre7_vs_prior23_pct) filter(where empirical_timing not in ('pending','unmeasured')),1) as avg_pre7_vs_prior23_pct,
  round(avg(post7_vs_pre7_pct) filter(where empirical_timing not in ('pending','unmeasured')),1) as avg_post7_vs_pre7_pct,
  round(avg(post7_market_price_change_pct) filter(where empirical_timing not in ('pending','unmeasured')),1) as avg_post7_market_price_change_pct,
  max(signal_at) as latest_signal_at
from events
group by user_id,source_key;

revoke all on public.market_intel_source_outcomes from public,anon;
grant select on public.market_intel_source_outcomes to authenticated;
