create or replace view public.sealed_product_supply_trend_current
with (security_invoker=true) as
with latest as (
  select distinct on (sealed_uuid) sealed_uuid,product_id,total_listings,captured_at
  from public.sealed_product_price_history
  where source='tcgplayer_public' and total_listings is not null
  order by sealed_uuid,captured_at desc
)
select l.*,
  p7.total_listings listings_7d_prior,p7.captured_at listings_7d_observed_at,
  p30.total_listings listings_30d_prior,p30.captured_at listings_30d_observed_at,
  round(100*(1-l.total_listings::numeric/nullif(p7.total_listings,0)),1) supply_compression_7d_pct,
  round(100*(1-l.total_listings::numeric/nullif(p30.total_listings,0)),1) supply_compression_30d_pct,
  stats.observation_days supply_observation_days,
  case when p30.total_listings is not null then 'HIGH'
       when p7.total_listings is not null then 'MEDIUM' else 'LOW' end supply_trend_confidence
from latest l
left join lateral (
  select h.total_listings,h.captured_at
  from public.sealed_product_price_history h
  where h.sealed_uuid=l.sealed_uuid and h.source='tcgplayer_public'
    and h.total_listings is not null
    and h.captured_at between l.captured_at-interval '10 days' and l.captured_at-interval '4 days'
  order by abs(extract(epoch from (h.captured_at-(l.captured_at-interval '7 days')))) limit 1
) p7 on true
left join lateral (
  select h.total_listings,h.captured_at
  from public.sealed_product_price_history h
  where h.sealed_uuid=l.sealed_uuid and h.source='tcgplayer_public'
    and h.total_listings is not null
    and h.captured_at between l.captured_at-interval '37 days' and l.captured_at-interval '21 days'
  order by abs(extract(epoch from (h.captured_at-(l.captured_at-interval '30 days')))) limit 1
) p30 on true
left join lateral (
  select count(distinct h.captured_at::date)::integer observation_days
  from public.sealed_product_price_history h
  where h.sealed_uuid=l.sealed_uuid and h.source='tcgplayer_public'
    and h.total_listings is not null
) stats on true;

grant select on public.sealed_product_supply_trend_current to authenticated,service_role;

drop view if exists public.sealed_product_lifecycle_signal_current;
create view public.sealed_product_lifecycle_signal_current
with (security_invoker=true) as
with users as (
  select distinct user_id from public.sealed_set_profiles where enabled
), sales as (
  select user_id,product_id,
    sum(coalesce(quantity_sold,0)) filter(where bucket_start_date>=current_date-30) units_30d,
    sum(coalesce(quantity_sold,0)) filter(where bucket_start_date>=current_date-90) units_90d
  from public.marketplace_sku_sales_buckets group by user_id,product_id
), calibration as (
  select calibration_confidence,sample_count,direction_accuracy_pct,median_absolute_error_pct
  from public.sealed_product_trajectory_backtest_summary_current
  where category='booster_box' and subtype='collector' limit 1
), features as (
  select u.user_id,l.*,coalesce(s.units_30d,0) units_30d,coalesce(s.units_90d,0) units_90d,
    st.total_listings,st.captured_at supply_observed_at,st.listings_7d_prior,st.listings_30d_prior,
    st.supply_compression_7d_pct,st.supply_compression_30d_pct,
    st.supply_observation_days,coalesce(st.supply_trend_confidence,'LOW') supply_trend_confidence,
    coalesce(c.calibration_confidence,'LOW') calibration_confidence,
    coalesce(c.sample_count,0) calibration_samples,c.direction_accuracy_pct,c.median_absolute_error_pct
  from users u cross join public.sealed_product_lifecycle_current l
  left join sales s on s.user_id=u.user_id and s.product_id=l.product_id::text
  left join public.sealed_product_supply_trend_current st on st.sealed_uuid=l.sealed_uuid
  left join calibration c on true
), classified as (
  select f.*,
    case
      when change_30d_pct<=-8 and (change_90d_pct>5 or below_history_high_pct>=15) then 'REVERSAL'
      when total_listings between 1 and 20 and units_30d>=5 and change_30d_pct>=3
        and supply_trend_confidence<>'LOW'
        and (supply_compression_7d_pct>=20 or supply_compression_30d_pct>=35) then 'SUPPLY SQUEEZE'
      when change_30d_pct>=10 and above_history_low_pct>=20 and below_history_high_pct<=7 then 'BREAKOUT'
      when abs(change_30d_pct)<=5 and change_90d_pct between -10 and 10 and above_history_low_pct<=15 then 'ACCUMULATION'
      when abs(change_30d_pct)<=3 and above_history_low_pct>15 then 'PLATEAU'
      else 'MIXED' end lifecycle_state
  from features f
)
select c.*,
  case when calibration_confidence<>'HIGH' then 'OBSERVE'
       when lifecycle_state in ('BREAKOUT','SUPPLY SQUEEZE') then 'REVIEW ENTRY'
       when lifecycle_state='REVERSAL' then 'RISK REVIEW' else 'WATCH' end trajectory_action,
  case when calibration_confidence<>'HIGH'
       then 'Observed pattern only; walk-forward calibration has not earned actionable confidence.'
       else 'Calibrated trajectory signal; confirm executable acquisition, liquidity, and exit economics separately.' end action_caveat,
  jsonb_build_object(
    'change_30d_pct',change_30d_pct,'change_90d_pct',change_90d_pct,
    'above_history_low_pct',above_history_low_pct,'below_history_high_pct',below_history_high_pct,
    'units_30d',units_30d,'units_90d',units_90d,'total_listings',total_listings,
    'listings_7d_prior',listings_7d_prior,'listings_30d_prior',listings_30d_prior,
    'supply_compression_7d_pct',supply_compression_7d_pct,
    'supply_compression_30d_pct',supply_compression_30d_pct,
    'supply_observation_days',supply_observation_days,'supply_trend_confidence',supply_trend_confidence,
    'history_days',history_days,'observation_count',observation_count
  ) lifecycle_evidence
from classified c;

grant select on public.sealed_product_lifecycle_signal_current to authenticated,service_role;
