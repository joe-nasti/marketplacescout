create or replace view public.sealed_product_lifecycle_signal_current
with (security_invoker=true) as
with users as (
  select distinct user_id from public.sealed_set_profiles where enabled
), sales as (
  select user_id,product_id,
    sum(coalesce(quantity_sold,0)) filter(where bucket_start_date>=current_date-30) units_30d,
    sum(coalesce(quantity_sold,0)) filter(where bucket_start_date>=current_date-90) units_90d
  from public.marketplace_sku_sales_buckets
  group by user_id,product_id
), current_supply as (
  select distinct on (sealed_uuid) sealed_uuid,total_listings,captured_at
  from public.sealed_product_price_current
  where source='tcgplayer_public'
  order by sealed_uuid,captured_at desc
), calibration as (
  select calibration_confidence,sample_count,direction_accuracy_pct,median_absolute_error_pct
  from public.sealed_product_trajectory_backtest_summary_current
  where category='booster_box' and subtype='collector'
  limit 1
), features as (
  select u.user_id,l.*,coalesce(s.units_30d,0) units_30d,coalesce(s.units_90d,0) units_90d,
    cs.total_listings,cs.captured_at supply_observed_at,
    coalesce(c.calibration_confidence,'LOW') calibration_confidence,
    coalesce(c.sample_count,0) calibration_samples,c.direction_accuracy_pct,c.median_absolute_error_pct
  from users u cross join public.sealed_product_lifecycle_current l
  left join sales s on s.user_id=u.user_id and s.product_id=l.product_id::text
  left join current_supply cs on cs.sealed_uuid=l.sealed_uuid
  left join calibration c on true
), classified as (
  select f.*,
    case
      when change_30d_pct<=-8 and (change_90d_pct>5 or below_history_high_pct>=15) then 'REVERSAL'
      when total_listings between 1 and 20 and units_30d>=5 and change_30d_pct>=3 then 'SUPPLY SQUEEZE'
      when change_30d_pct>=10 and above_history_low_pct>=20 and below_history_high_pct<=7 then 'BREAKOUT'
      when abs(change_30d_pct)<=5 and change_90d_pct between -10 and 10 and above_history_low_pct<=15 then 'ACCUMULATION'
      when abs(change_30d_pct)<=3 and above_history_low_pct>15 then 'PLATEAU'
      else 'MIXED' end lifecycle_state
  from features f
)
select c.*,
  case when calibration_confidence<>'HIGH' then 'OBSERVE'
       when lifecycle_state in ('BREAKOUT','SUPPLY SQUEEZE') then 'REVIEW ENTRY'
       when lifecycle_state='REVERSAL' then 'RISK REVIEW'
       else 'WATCH' end trajectory_action,
  case when calibration_confidence<>'HIGH'
       then 'Observed pattern only; walk-forward calibration has not earned actionable confidence.'
       else 'Calibrated trajectory signal; confirm executable acquisition, liquidity, and exit economics separately.' end action_caveat,
  jsonb_build_object(
    'change_30d_pct',change_30d_pct,'change_90d_pct',change_90d_pct,
    'above_history_low_pct',above_history_low_pct,'below_history_high_pct',below_history_high_pct,
    'units_30d',units_30d,'units_90d',units_90d,'total_listings',total_listings,
    'history_days',history_days,'observation_count',observation_count
  ) lifecycle_evidence
from classified c;

grant select on public.sealed_product_lifecycle_signal_current to authenticated,service_role;
