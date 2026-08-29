create or replace view public.market_intel_catalyst_shadow_source_backtest
with (security_invoker=true) as
with labeled as (
  select distinct
    b.snapshot_id,
    b.user_id,
    coalesce(nullif(trim(i.author),''), nullif(trim(i.source_name),''), nullif(trim(i.source_type),''), 'Unknown') as source_label,
    coalesce(nullif(trim(i.source_type),''),'unknown') as source_type,
    b.shadow_modifier,
    b.future_release,
    b.matured_1d,b.matured_3d,b.matured_7d,b.matured_30d,
    b.market_change_1d_pct,b.market_change_3d_pct,b.market_change_7d_pct,b.market_change_30d_pct,
    b.transactions_1d,b.transactions_3d,b.transactions_7d,b.transactions_30d
  from public.market_intel_catalyst_shadow_backtest b
  cross join lateral unnest(b.intel_ids) as x(intel_id)
  join public.market_intel_items i on i.user_id=b.user_id and i.intel_id=x.intel_id
)
select
  user_id,
  source_label,
  max(source_type) as source_type,
  count(*)::bigint as snapshots,
  round(avg(shadow_modifier),2) as avg_modifier,
  count(*) filter(where matured_1d)::bigint as matured_1d,
  count(*) filter(where matured_3d)::bigint as matured_3d,
  count(*) filter(where matured_7d)::bigint as matured_7d,
  count(*) filter(where matured_30d)::bigint as matured_30d,
  round(avg(market_change_1d_pct) filter(where matured_1d),2) as avg_market_change_1d_pct,
  round(avg(market_change_3d_pct) filter(where matured_3d),2) as avg_market_change_3d_pct,
  round(avg(market_change_7d_pct) filter(where matured_7d),2) as avg_market_change_7d_pct,
  round(avg(market_change_30d_pct) filter(where matured_30d),2) as avg_market_change_30d_pct,
  round(avg(transactions_1d) filter(where matured_1d),2) as avg_transactions_1d,
  round(avg(transactions_3d) filter(where matured_3d),2) as avg_transactions_3d,
  round(avg(transactions_7d) filter(where matured_7d),2) as avg_transactions_7d,
  round(avg(transactions_30d) filter(where matured_30d),2) as avg_transactions_30d
from labeled
where not future_release
group by user_id,source_label;

grant select on public.market_intel_catalyst_shadow_source_backtest to authenticated;
revoke all on public.market_intel_catalyst_shadow_source_backtest from anon;
