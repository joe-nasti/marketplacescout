create or replace view public.market_intel_catalyst_shadow_backtest_summary
with (security_invoker = true)
as
select user_id,scorer_version,
 case when shadow_modifier<=-4 then '-8..-4' when shadow_modifier<0 then '-3..-1' when shadow_modifier=0 then '0' when shadow_modifier<=3 then '+1..+3' when shadow_modifier<=7 then '+4..+7' else '+8..+12' end modifier_band,
 count(*) snapshots,
 count(*) filter(where matured_1d) matured_1d,count(*) filter(where matured_3d) matured_3d,count(*) filter(where matured_7d) matured_7d,count(*) filter(where matured_30d) matured_30d,
 round(avg(market_change_1d_pct) filter(where matured_1d),2) avg_market_change_1d_pct,
 round(avg(market_change_3d_pct) filter(where matured_3d),2) avg_market_change_3d_pct,
 round(avg(market_change_7d_pct) filter(where matured_7d),2) avg_market_change_7d_pct,
 round(avg(market_change_30d_pct) filter(where matured_30d),2) avg_market_change_30d_pct,
 round(avg(transactions_1d) filter(where matured_1d),2) avg_transactions_1d,
 round(avg(transactions_3d) filter(where matured_3d),2) avg_transactions_3d,
 round(avg(transactions_7d) filter(where matured_7d),2) avg_transactions_7d,
 round(avg(transactions_30d) filter(where matured_30d),2) avg_transactions_30d
from public.market_intel_catalyst_shadow_backtest
group by user_id,scorer_version,modifier_band;
grant select on public.market_intel_catalyst_shadow_backtest_summary to authenticated;
