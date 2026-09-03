create or replace view public.sealed_product_trajectory_backtest_points_current
with (security_invoker=true) as
with products as (
  select p.uuid sealed_uuid,p.tcgplayer_product_id::bigint product_id,p.name product_name,
    p.set_code,p.category,p.subtype,coalesce(p.release_date,sc.released_at) release_date
  from public.mtgjson_sealed_products p
  left join public.magic_set_catalog sc on upper(sc.code)=upper(p.set_code)
  where p.category='booster_box' and p.subtype='collector'
    and p.tcgplayer_product_id~'^[0-9]+$' and p.name not ilike '%case%'
), checkpoints as (
  select p.*,h.observed_on checkpoint_date,h.market_price checkpoint_market_price
  from products p join public.sealed_product_market_history h
    on h.product_id=p.product_id and h.sub_type_name='Normal'
  where h.market_price>0 and h.source like 'tcgcsv%'
)
select c.*,greatest(0,c.checkpoint_date-c.release_date) age_days,
  p30.observed_on price_30d_date,p30.market_price price_30d,
  p90.observed_on price_90d_date,p90.market_price price_90d,
  outcome.observed_on outcome_date,outcome.market_price outcome_market_price,
  round(100*(c.checkpoint_market_price/nullif(p30.market_price,0)-1),2) change_30d_pct,
  round(100*(c.checkpoint_market_price/nullif(p90.market_price,0)-1),2) change_90d_pct,
  round(100*(outcome.market_price/nullif(c.checkpoint_market_price,0)-1),2) actual_future_90d_return_pct
from checkpoints c
left join lateral (
  select h.observed_on,h.market_price from public.sealed_product_market_history h
  where h.product_id=c.product_id and h.sub_type_name='Normal' and h.market_price>0
    and h.observed_on between c.checkpoint_date-45 and c.checkpoint_date-21
  order by abs(h.observed_on-(c.checkpoint_date-30)),h.observed_on desc limit 1
) p30 on true
left join lateral (
  select h.observed_on,h.market_price from public.sealed_product_market_history h
  where h.product_id=c.product_id and h.sub_type_name='Normal' and h.market_price>0
    and h.observed_on between c.checkpoint_date-105 and c.checkpoint_date-75
  order by abs(h.observed_on-(c.checkpoint_date-90)),h.observed_on desc limit 1
) p90 on true
left join lateral (
  select h.observed_on,h.market_price from public.sealed_product_market_history h
  where h.product_id=c.product_id and h.sub_type_name='Normal' and h.market_price>0
    and h.observed_on between c.checkpoint_date+75 and c.checkpoint_date+105
  order by abs(h.observed_on-(c.checkpoint_date+90)),h.observed_on limit 1
) outcome on true;

grant select on public.sealed_product_trajectory_backtest_points_current to authenticated,service_role;

create or replace view public.sealed_product_trajectory_backtest_predictions_current
with (security_invoker=true) as
with candidates as (
  select t.sealed_uuid,t.product_id,t.product_name,t.set_code,t.category,t.subtype,
    t.checkpoint_date,t.actual_future_90d_return_pct,
    a.sealed_uuid analog_sealed_uuid,a.product_name analog_product_name,
    a.checkpoint_date analog_checkpoint_date,a.outcome_date analog_outcome_date,
    a.actual_future_90d_return_pct analog_future_90d_return_pct,
    greatest(0,100
      -abs(t.change_30d_pct-a.change_30d_pct)*.55
      -abs(t.change_90d_pct-a.change_90d_pct)*.30
      -abs(ln(greatest(t.checkpoint_market_price,1)/greatest(a.checkpoint_market_price,1)))*8
      -abs(t.age_days-a.age_days)/60.0) similarity_score
  from public.sealed_product_trajectory_backtest_points_current t
  join public.sealed_product_trajectory_backtest_points_current a
    on a.sealed_uuid<>t.sealed_uuid and a.category=t.category and a.subtype=t.subtype
    and a.release_date<=t.release_date-180
    and a.outcome_date<=t.checkpoint_date
    and abs(a.age_days-t.age_days)<=180
  where t.change_30d_pct is not null and t.change_90d_pct is not null
    and t.actual_future_90d_return_pct is not null
    and a.change_30d_pct is not null and a.change_90d_pct is not null
    and a.actual_future_90d_return_pct is not null
), ranked as (
  select c.*,row_number() over(partition by sealed_uuid,checkpoint_date
    order by similarity_score desc,analog_outcome_date desc) analog_rank
  from candidates c
), predictions as (
  select sealed_uuid,product_id,product_name,set_code,category,subtype,checkpoint_date,
    actual_future_90d_return_pct,count(*) analog_count,
    round(sum(analog_future_90d_return_pct*greatest(similarity_score,1)) /
      nullif(sum(greatest(similarity_score,1)),0),2) predicted_future_90d_return_pct,
    array_agg(analog_product_name order by analog_rank) analog_products
  from ranked where analog_rank<=3
  group by sealed_uuid,product_id,product_name,set_code,category,subtype,
    checkpoint_date,actual_future_90d_return_pct
)
select p.*,
  (sign(predicted_future_90d_return_pct)=sign(actual_future_90d_return_pct)) direction_correct,
  round(abs(predicted_future_90d_return_pct-actual_future_90d_return_pct),2) absolute_error_pct
from predictions p;

grant select on public.sealed_product_trajectory_backtest_predictions_current to authenticated,service_role;

create or replace view public.sealed_product_trajectory_backtest_summary_current
with (security_invoker=true) as
select category,subtype,count(*)::integer sample_count,count(distinct sealed_uuid)::integer product_count,
  min(checkpoint_date) first_checkpoint,max(checkpoint_date) last_checkpoint,
  round(100*avg(direction_correct::integer),1) direction_accuracy_pct,
  round(avg(absolute_error_pct),1) mean_absolute_error_pct,
  round(percentile_cont(.5) within group(order by absolute_error_pct)::numeric,1) median_absolute_error_pct,
  case when count(*)>=100 and avg(direction_correct::integer)>=.60 then 'HIGH'
       when count(*)>=30 then 'MEDIUM' else 'LOW' end calibration_confidence,
  'Leakage-safe walk-forward test: every analog outcome predates its target checkpoint. TCG Market measures trajectory only, not liquidation EV.'::text caveat
from public.sealed_product_trajectory_backtest_predictions_current
group by category,subtype;

grant select on public.sealed_product_trajectory_backtest_summary_current to authenticated,service_role;
