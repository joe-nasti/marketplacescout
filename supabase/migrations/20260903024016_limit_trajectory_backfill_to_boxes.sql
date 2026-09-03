-- A quarter-range fallback is useful evidence but should not be fetched hourly.
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
  and p.name not ilike '%case%'
  and (c.last_fetched_at is null or c.last_fetched_at<now()-interval '7 days');

grant select on public.sealed_product_trajectory_backfill_queue to service_role;
