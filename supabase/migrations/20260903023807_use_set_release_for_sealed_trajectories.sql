create or replace view public.sealed_product_trajectory_features_current
with (security_invoker=true) as
with daily as (
  select b.user_id,p.uuid sealed_uuid,p.category,p.subtype,coalesce(p.release_date,sc.released_at) release_date,b.bucket_start_date,
    sum(coalesce(b.quantity_sold,0)) quantity_sold,
    sum(coalesce(b.transaction_count,0)) transaction_count,
    sum(coalesce(b.market_price,0)*greatest(coalesce(b.transaction_count,0),1))
      /nullif(sum(greatest(coalesce(b.transaction_count,0),1)),0) market_price
  from public.marketplace_sku_sales_buckets b
  join public.mtgjson_sealed_products p on p.tcgplayer_product_id=b.product_id
  left join public.magic_set_catalog sc on upper(sc.code)=upper(p.set_code)
  where b.market_price>0
  group by b.user_id,p.uuid,p.category,p.subtype,coalesce(p.release_date,sc.released_at),b.bucket_start_date
), rollup as (
  select d.user_id,d.sealed_uuid,d.category,d.subtype,d.release_date,
    min(d.bucket_start_date) history_start,max(d.bucket_start_date) history_end,
    count(*) observation_count,sum(d.quantity_sold) units_sold,
    (array_agg(d.market_price order by d.bucket_start_date))[1] market_start,
    (array_agg(d.market_price order by d.bucket_start_date desc))[1] market_current,
    (array_agg(d.market_price order by d.bucket_start_date)
      filter(where d.bucket_start_date>=current_date-30))[1] market_30d_start,
    (array_agg(d.market_price order by d.bucket_start_date)
      filter(where d.bucket_start_date>=current_date-90))[1] market_90d_start,
    sum(d.quantity_sold) filter(where d.bucket_start_date>=current_date-30) units_30d,
    sum(d.quantity_sold) filter(where d.bucket_start_date>=current_date-90) units_90d
  from daily d group by d.user_id,d.sealed_uuid,d.category,d.subtype,d.release_date
)
select r.*,(history_end-history_start+1) history_days,
  round(100*(market_current/ nullif(market_30d_start,0)-1),2) change_30d_pct,
  round(100*(market_current/ nullif(market_90d_start,0)-1),2) change_90d_pct,
  round(coalesce(units_30d,0)/30.0,3) units_per_day_30d,
  round(coalesce(units_90d,0)/90.0,3) units_per_day_90d,
  greatest(0,current_date-release_date) product_age_days
from rollup r;

grant select on public.sealed_product_trajectory_features_current to authenticated,service_role;

create or replace view public.sealed_product_trajectory_backfill_queue
with (security_invoker=true) as
with users as (
  select distinct user_id from public.sealed_set_profiles where enabled
), coverage as (
  select user_id,product_id,min(bucket_start_date) history_start,max(bucket_start_date) history_end,
    max(observed_at) last_fetched_at
  from public.marketplace_sku_sales_buckets group by user_id,product_id
)
select u.user_id,p.uuid sealed_uuid,p.tcgplayer_product_id product_id,p.name,p.release_date,
  c.history_start,c.history_end,c.last_fetched_at,
  coalesce(c.history_end-c.history_start+1,0) history_days
from users u cross join public.mtgjson_sealed_products p
left join coverage c on c.user_id=u.user_id and c.product_id=p.tcgplayer_product_id
where p.category='booster_box' and p.subtype='collector'
  and p.tcgplayer_product_id~'^[0-9]+$'
  and (c.history_start is null or c.history_end-c.history_start<300
    or c.last_fetched_at<now()-interval '7 days');

grant select on public.sealed_product_trajectory_backfill_queue to service_role;

create or replace view public.sealed_product_trajectory_analogs_current
with (security_invoker=true) as
with pairs as (
  select t.user_id,t.sealed_uuid target_sealed_uuid,a.sealed_uuid analog_sealed_uuid,
    a.release_date analog_release_date,a.product_age_days analog_age_days,
    a.market_current analog_market_price,a.change_30d_pct analog_change_30d_pct,
    a.change_90d_pct analog_change_90d_pct,a.units_per_day_30d analog_units_per_day_30d,
    a.history_days analog_history_days,a.observation_count analog_observations,
    round(greatest(0,100
      -coalesce(abs(t.change_30d_pct-a.change_30d_pct),35)*.8
      -coalesce(abs(t.change_90d_pct-a.change_90d_pct),45)*.35
      -abs(ln(greatest(t.market_current,1)/greatest(a.market_current,1)))*10
      -abs(ln((greatest(t.units_per_day_30d,0)+.05)/(greatest(a.units_per_day_30d,0)+.05)))*8
    ),1) similarity_score
  from public.sealed_product_trajectory_features_current t
  join public.sealed_product_trajectory_features_current a
    on a.user_id=t.user_id and a.sealed_uuid<>t.sealed_uuid
    and a.category=t.category and a.subtype=t.subtype
    and a.release_date<=t.release_date-180
  where t.observation_count>=4 and a.observation_count>=4
), ranked as (
  select p.*,row_number() over(partition by user_id,target_sealed_uuid order by similarity_score desc,analog_history_days desc) analog_rank
  from pairs p
)
select r.*,p.name analog_product_name,p.set_code analog_set_code,
  case when r.analog_history_days>=300 and r.analog_observations>=12 then 'MEDIUM' else 'LOW' end analog_confidence,
  'Shape match uses observed 30/90-day price momentum, price scale, and marketplace sales velocity. It is descriptive, not a forecast.'::text analog_caveat
from ranked r join public.mtgjson_sealed_products p on p.uuid=r.analog_sealed_uuid
where r.analog_rank<=3;

grant select on public.sealed_product_trajectory_analogs_current to authenticated,service_role;
