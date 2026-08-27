-- Empirical Signal outcome tracking.
-- Measures whether a source tends to arrive before a velocity increase, while
-- velocity is already elevated, or after the move. This is deliberately
-- separate from Scout grade/economics and from extraction-time signal_stage.

create or replace view public.market_intel_signal_outcomes
with (security_invoker=true)
as
with signals as (
  select distinct
    i.user_id,
    i.intel_id,
    coalesce(nullif(i.source_name,''),i.source_type) as source_name,
    coalesce(nullif(i.author,''),'Unknown') as author,
    i.source_url,
    i.signal_stage,
    i.direction,
    coalesce(i.published_at,i.observed_at,i.created_at) as signal_at,
    l.oracle_id,
    l.canonical_name
  from public.market_intel_items i
  join public.market_intel_scout_signal_links l
    on l.user_id=i.user_id and l.intel_id=i.intel_id
  where l.oracle_id is not null
), skus as (
  select distinct
    s.user_id,s.intel_id,s.source_name,s.author,s.source_url,s.signal_stage,s.direction,
    s.signal_at,s.oracle_id,s.canonical_name,c.sku_id
  from signals s
  join public.market_intel_scout_signal_links l
    on l.user_id=s.user_id and l.intel_id=s.intel_id and l.oracle_id=s.oracle_id
  join public.scout_opportunities_v5_cache c
    on c.user_id=s.user_id and c.product_id=l.product_id
   and lower(coalesce(c.condition,''))='near mint'
   and lower(coalesce(c.language,''))='english'
), agg as (
  select
    s.user_id,s.intel_id,s.source_name,s.author,s.source_url,s.signal_stage,s.direction,
    s.signal_at,s.oracle_id,max(s.canonical_name) as canonical_name,
    count(distinct s.sku_id)::int as measured_sku_count,
    sum(coalesce(b.transaction_count,0)) filter(where b.bucket_start_date between s.signal_at::date-30 and s.signal_at::date-8) as prior23_transactions,
    sum(coalesce(b.transaction_count,0)) filter(where b.bucket_start_date between s.signal_at::date-7 and s.signal_at::date-1) as pre7_transactions,
    sum(coalesce(b.transaction_count,0)) filter(where b.bucket_start_date between s.signal_at::date and s.signal_at::date+6) as post7_transactions,
    sum(coalesce(b.transaction_count,0)) filter(where b.bucket_start_date between s.signal_at::date and s.signal_at::date+13) as post14_transactions,
    sum(coalesce(b.quantity_sold,0)) filter(where b.bucket_start_date between s.signal_at::date-7 and s.signal_at::date-1) as pre7_quantity,
    sum(coalesce(b.quantity_sold,0)) filter(where b.bucket_start_date between s.signal_at::date and s.signal_at::date+6) as post7_quantity,
    avg(b.market_price) filter(where b.bucket_start_date between s.signal_at::date-1 and s.signal_at::date and b.market_price>0) as signal_market_price,
    avg(b.market_price) filter(where b.bucket_start_date between s.signal_at::date+5 and s.signal_at::date+7 and b.market_price>0) as post7_market_price,
    count(distinct b.bucket_start_date) filter(where b.bucket_start_date between s.signal_at::date-30 and s.signal_at::date-8) as prior23_covered_days,
    count(distinct b.bucket_start_date) filter(where b.bucket_start_date between s.signal_at::date-7 and s.signal_at::date-1) as pre7_covered_days,
    count(distinct b.bucket_start_date) filter(where b.bucket_start_date between s.signal_at::date and least(current_date,s.signal_at::date+6)) as post7_covered_days
  from skus s
  left join public.marketplace_sku_sales_buckets b
    on b.user_id=s.user_id and b.sku_id=s.sku_id
   and b.bucket_start_date between s.signal_at::date-30 and least(current_date,s.signal_at::date+13)
  group by s.user_id,s.intel_id,s.source_name,s.author,s.source_url,s.signal_stage,s.direction,s.signal_at,s.oracle_id
), rates as (
  select *,
    round(coalesce(prior23_transactions,0)/23.0,4) as prior23_daily_transactions,
    round(coalesce(pre7_transactions,0)/7.0,4) as pre7_daily_transactions,
    round(coalesce(post7_transactions,0)/7.0,4) as post7_daily_transactions,
    case when coalesce(prior23_transactions,0)>0 then round((((coalesce(pre7_transactions,0)/7.0)/(prior23_transactions/23.0))-1)*100,2) end as pre7_vs_prior23_pct,
    case when coalesce(pre7_transactions,0)>0 then round((((coalesce(post7_transactions,0)/7.0)/(pre7_transactions/7.0))-1)*100,2) end as post7_vs_pre7_pct,
    case when signal_market_price>0 and post7_market_price is not null then round(((post7_market_price/signal_market_price)-1)*100,2) end as post7_market_price_change_pct
  from agg
)
select
  user_id,intel_id,source_name,author,source_url,signal_stage,direction,signal_at,oracle_id,canonical_name,
  measured_sku_count,prior23_transactions,pre7_transactions,post7_transactions,post14_transactions,
  pre7_quantity,post7_quantity,prior23_daily_transactions,pre7_daily_transactions,post7_daily_transactions,
  pre7_vs_prior23_pct,post7_vs_pre7_pct,signal_market_price,post7_market_price,post7_market_price_change_pct,
  prior23_covered_days,pre7_covered_days,post7_covered_days,
  case
    when current_date < signal_at::date+6 then 'pending'
    when measured_sku_count=0 or pre7_covered_days=0 or post7_covered_days=0 then 'unmeasured'
    -- Already-hot before the Signal, then flat/down afterward: reactive.
    when coalesce(pre7_transactions,0)>=3
      and pre7_daily_transactions >= greatest(0.25,prior23_daily_transactions*1.15)
      and post7_daily_transactions <= pre7_daily_transactions*1.10 then 'reactive'
    -- No clear pre-Signal acceleration, followed by a material post-Signal jump: predictive.
    when coalesce(post7_transactions,0)>=3
      and post7_daily_transactions >= greatest(0.25,pre7_daily_transactions*1.50)
      and pre7_daily_transactions < greatest(0.25,prior23_daily_transactions*1.25) then 'predictive'
    -- Already moving before the Signal and continues accelerating after: confirming.
    when coalesce(pre7_transactions,0)>=3 and coalesce(post7_transactions,0)>=3
      and pre7_daily_transactions >= greatest(0.25,prior23_daily_transactions*1.15)
      and post7_daily_transactions > pre7_daily_transactions*1.10 then 'confirming'
    else 'flat_or_unclear'
  end::text as empirical_timing,
  case
    when current_date < signal_at::date+6 then 'Post-7-day window is still incomplete.'
    when measured_sku_count=0 or pre7_covered_days=0 or post7_covered_days=0 then 'Sales coverage is insufficient for timing classification.'
    when coalesce(pre7_transactions,0)>=3 and pre7_daily_transactions >= greatest(0.25,prior23_daily_transactions*1.15) and post7_daily_transactions <= pre7_daily_transactions*1.10 then 'Velocity was already elevated before the Signal and did not accelerate afterward.'
    when coalesce(post7_transactions,0)>=3 and post7_daily_transactions >= greatest(0.25,pre7_daily_transactions*1.50) and pre7_daily_transactions < greatest(0.25,prior23_daily_transactions*1.25) then 'Velocity accelerated after the Signal without a comparable pre-Signal spike.'
    when coalesce(pre7_transactions,0)>=3 and coalesce(post7_transactions,0)>=3 and pre7_daily_transactions >= greatest(0.25,prior23_daily_transactions*1.15) and post7_daily_transactions > pre7_daily_transactions*1.10 then 'Velocity was rising before the Signal and continued to accelerate afterward.'
    else 'No strong timing pattern yet.'
  end::text as empirical_timing_reason
from rates;

create or replace view public.market_intel_source_outcomes
with (security_invoker=true)
as
select
  user_id,
  lower(source_name) as source_key,
  max(source_name) as source_name,
  count(*)::int as measured_signals,
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
from public.market_intel_signal_outcomes
group by user_id,lower(source_name);

revoke all on public.market_intel_signal_outcomes from public,anon;
revoke all on public.market_intel_source_outcomes from public,anon;
grant select on public.market_intel_signal_outcomes to authenticated;
grant select on public.market_intel_source_outcomes to authenticated;
