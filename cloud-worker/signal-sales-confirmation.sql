-- Adaptive Signal demand confirmation built on the shared Marketplace sales-history subsystem.
-- Storage remains 3-day TCGplayer buckets; evidence windows expand until >=3 transactions.

create or replace view public.marketplace_signal_sku_sales_response
with (security_invoker=true) as
with base as (
  select distinct n.user_id,n.card_name,n.set_code,n.product_id,n.sku_id,n.finish,n.printing,
    n.signal_first_at,n.signal_last_at,n.sales_fetched_at,
    n.average_daily_quantity_sold,n.average_daily_transaction_count,
    n.quarter_quantity_sold,n.quarter_transaction_count
  from public.marketplace_signal_nm_sales_current n
), post_buckets as (
  select b.user_id,b.product_id,b.sku_id,b.bucket_start_date,
    sum(coalesce(b.transaction_count,0)) over (
      partition by b.user_id,b.product_id,b.sku_id
      order by b.bucket_start_date
      rows between unbounded preceding and current row
    ) as cumulative_post_tx
  from public.marketplace_sku_sales_buckets b
  join base n on n.user_id=b.user_id and n.product_id=b.product_id and n.sku_id=b.sku_id
  where b.bucket_start_date>=n.signal_first_at::date
    and b.bucket_start_date<=least(current_date,n.signal_first_at::date+89)
), threshold as (
  select user_id,product_id,sku_id,
    min(bucket_start_date) filter(where cumulative_post_tx>=3) as threshold_bucket_start
  from post_buckets group by user_id,product_id,sku_id
), windows as (
  select n.*,t.threshold_bucket_start,
    case when t.threshold_bucket_start is not null
      then least(current_date,t.threshold_bucket_start+2)
      else least(current_date,n.signal_first_at::date+89) end as evaluation_end_date,
    greatest(1,(case when t.threshold_bucket_start is not null
      then least(current_date,t.threshold_bucket_start+2)
      else least(current_date,n.signal_first_at::date+89) end)-n.signal_first_at::date+1)::integer as evaluation_window_days
  from base n
  left join threshold t on t.user_id=n.user_id and t.product_id=n.product_id and t.sku_id=n.sku_id
), agg as (
  select w.user_id,w.product_id,w.sku_id,
    sum(b.quantity_sold) filter(where b.bucket_start_date>=w.signal_first_at::date and b.bucket_start_date<=w.evaluation_end_date) as evidence_qty,
    sum(b.transaction_count) filter(where b.bucket_start_date>=w.signal_first_at::date and b.bucket_start_date<=w.evaluation_end_date) as evidence_tx,
    sum(b.quantity_sold) filter(where b.bucket_start_date>=w.signal_first_at::date-w.evaluation_window_days and b.bucket_start_date<w.signal_first_at::date) as matched_pre_qty,
    sum(b.transaction_count) filter(where b.bucket_start_date>=w.signal_first_at::date-w.evaluation_window_days and b.bucket_start_date<w.signal_first_at::date) as matched_pre_tx,
    sum(b.quantity_sold) filter(where b.bucket_start_date>=w.signal_first_at::date-30 and b.bucket_start_date<w.signal_first_at::date) as pre_qty_30d,
    sum(b.transaction_count) filter(where b.bucket_start_date>=w.signal_first_at::date-30 and b.bucket_start_date<w.signal_first_at::date) as pre_tx_30d,
    sum(b.quantity_sold) filter(where b.bucket_start_date>=w.signal_first_at::date and b.bucket_start_date<=least(current_date,w.signal_first_at::date+89)) as post_qty_to_date,
    sum(b.transaction_count) filter(where b.bucket_start_date>=w.signal_first_at::date and b.bucket_start_date<=least(current_date,w.signal_first_at::date+89)) as post_tx_to_date,
    (array_agg(b.market_price order by b.bucket_start_date desc) filter(where b.bucket_start_date<=w.signal_first_at::date and b.market_price>0))[1] as signal_market_price,
    (array_agg(b.market_price order by b.bucket_start_date desc) filter(where b.market_price>0))[1] as latest_market_price,
    (array_agg(b.low_sale_price order by b.bucket_start_date desc) filter(where b.quantity_sold>0))[1] as latest_low_sale_price,
    (array_agg(b.high_sale_price order by b.bucket_start_date desc) filter(where b.quantity_sold>0))[1] as latest_high_sale_price,
    (array_agg(b.low_sale_price_with_shipping order by b.bucket_start_date desc) filter(where b.quantity_sold>0))[1] as latest_low_sale_price_with_shipping,
    (array_agg(b.high_sale_price_with_shipping order by b.bucket_start_date desc) filter(where b.quantity_sold>0))[1] as latest_high_sale_price_with_shipping,
    max(b.bucket_start_date) as latest_bucket_date
  from windows w
  left join public.marketplace_sku_sales_buckets b on b.user_id=w.user_id and b.product_id=w.product_id and b.sku_id=w.sku_id
  group by w.user_id,w.product_id,w.sku_id,w.signal_first_at,w.evaluation_end_date,w.evaluation_window_days
)
select w.user_id,w.card_name,w.set_code,w.product_id,w.sku_id,w.finish,w.printing,
  w.signal_first_at,w.signal_last_at,w.sales_fetched_at,
  w.average_daily_quantity_sold,w.average_daily_transaction_count,w.quarter_quantity_sold,w.quarter_transaction_count,
  coalesce(a.post_tx_to_date,0)::numeric as post_signal_transactions_to_date,
  coalesce(a.post_qty_to_date,0)::numeric as post_signal_quantity_to_date,
  w.threshold_bucket_start,w.evaluation_end_date,w.evaluation_window_days,
  case when w.threshold_bucket_start is not null then greatest(1,w.evaluation_end_date-w.signal_first_at::date+1) else null end as time_to_3_transactions_days,
  coalesce(a.evidence_tx,0)::numeric as evidence_transactions,
  coalesce(a.evidence_qty,0)::numeric as evidence_quantity,
  coalesce(a.matched_pre_tx,0)::numeric as matched_pre_transactions,
  coalesce(a.matched_pre_qty,0)::numeric as matched_pre_quantity,
  coalesce(a.pre_tx_30d,0)::numeric as pre_signal_transactions_30d,
  coalesce(a.pre_qty_30d,0)::numeric as pre_signal_qty_30d,
  round(coalesce(a.evidence_tx,0)/w.evaluation_window_days::numeric,4) as evidence_daily_transactions,
  round(coalesce(a.matched_pre_tx,0)/w.evaluation_window_days::numeric,4) as matched_pre_daily_transactions,
  round(coalesce(a.pre_tx_30d,0)/30.0,4) as pre_30d_daily_transactions,
  round(coalesce(a.evidence_qty,0)/w.evaluation_window_days::numeric,4) as evidence_daily_quantity,
  round(coalesce(a.matched_pre_qty,0)/w.evaluation_window_days::numeric,4) as matched_pre_daily_quantity,
  case when coalesce(a.matched_pre_tx,0)>0 then round(((coalesce(a.evidence_tx,0)/w.evaluation_window_days::numeric)/(a.matched_pre_tx/w.evaluation_window_days::numeric)-1)*100,2) end as transaction_velocity_lift_matched_pct,
  case when coalesce(a.pre_tx_30d,0)>0 then round(((coalesce(a.evidence_tx,0)/w.evaluation_window_days::numeric)/(a.pre_tx_30d/30.0)-1)*100,2) end as transaction_velocity_lift_30d_pct,
  case when coalesce(a.matched_pre_qty,0)>0 then round(((coalesce(a.evidence_qty,0)/w.evaluation_window_days::numeric)/(a.matched_pre_qty/w.evaluation_window_days::numeric)-1)*100,2) end as quantity_velocity_lift_matched_pct,
  case when w.sales_fetched_at is null then 'unmeasured' when coalesce(a.post_tx_to_date,0)>=6 then 'strong' when coalesce(a.post_tx_to_date,0)>=3 then 'confirmed' when coalesce(a.post_tx_to_date,0)=2 then 'emerging' when coalesce(a.post_tx_to_date,0)=1 then 'anecdotal' else 'no_sales' end as evidence_level,
  case when w.sales_fetched_at is null then 'awaiting_collection' when coalesce(a.post_tx_to_date,0)>=3 then 'confirmed' else 'insufficient_sales_evidence' end as evidence_status,
  case when w.sales_fetched_at is null then 'none' when coalesce(a.post_tx_to_date,0)>=6 and coalesce(a.pre_tx_30d,0)>=3 then 'high' when coalesce(a.post_tx_to_date,0)>=3 then 'medium' else 'low' end as evidence_confidence,
  a.signal_market_price,a.latest_market_price,
  case when a.signal_market_price>0 and a.latest_market_price is not null then round((a.latest_market_price/a.signal_market_price-1)*100,2) end as market_price_change_pct,
  a.latest_low_sale_price,a.latest_high_sale_price,a.latest_low_sale_price_with_shipping,a.latest_high_sale_price_with_shipping,a.latest_bucket_date,
  case when w.sales_fetched_at is null then 'unmeasured' else 'measured' end as measurement_status
from windows w left join agg a on a.user_id=w.user_id and a.product_id=w.product_id and a.sku_id=w.sku_id;

grant select on public.marketplace_signal_sku_sales_response to authenticated,service_role;
revoke all on public.marketplace_signal_sku_sales_response from anon;

-- Card-level rollup uses the same adaptive rule across all NM-English printings.
create or replace view public.marketplace_signal_card_sales_response
with (security_invoker=true) as
with sku_set as (
  select distinct user_id,card_name,sku_id,signal_first_at,signal_last_at
  from public.marketplace_signal_nm_sales_current
), card_dates as (
  select user_id,card_name,min(signal_first_at) as signal_first_at,max(signal_last_at) as signal_last_at
  from sku_set group by user_id,card_name
), daily as (
  select s.user_id,s.card_name,d.signal_first_at,d.signal_last_at,b.bucket_start_date,
    sum(coalesce(b.transaction_count,0)) as transaction_count,
    sum(coalesce(b.quantity_sold,0)) as quantity_sold
  from sku_set s
  join card_dates d on d.user_id=s.user_id and d.card_name=s.card_name
  join public.marketplace_sku_sales_buckets b on b.user_id=s.user_id and b.sku_id=s.sku_id
  group by s.user_id,s.card_name,d.signal_first_at,d.signal_last_at,b.bucket_start_date
), post as (
  select d.*,sum(transaction_count) over(partition by user_id,card_name order by bucket_start_date rows between unbounded preceding and current row) as cumulative_post_tx
  from daily d
  where bucket_start_date>=signal_first_at::date and bucket_start_date<=least(current_date,signal_first_at::date+89)
), threshold as (
  select user_id,card_name,min(bucket_start_date) filter(where cumulative_post_tx>=3) as threshold_bucket_start
  from post group by user_id,card_name
), windows as (
  select c.user_id,c.card_name,c.signal_first_at,c.signal_last_at,t.threshold_bucket_start,
    case when t.threshold_bucket_start is not null then least(current_date,t.threshold_bucket_start+2) else least(current_date,c.signal_first_at::date+89) end as evaluation_end_date,
    greatest(1,(case when t.threshold_bucket_start is not null then least(current_date,t.threshold_bucket_start+2) else least(current_date,c.signal_first_at::date+89) end)-c.signal_first_at::date+1)::integer as evaluation_window_days
  from card_dates c left join threshold t on t.user_id=c.user_id and t.card_name=c.card_name
), agg as (
  select w.user_id,w.card_name,
    sum(d.transaction_count) filter(where d.bucket_start_date>=w.signal_first_at::date and d.bucket_start_date<=w.evaluation_end_date) as evidence_tx,
    sum(d.quantity_sold) filter(where d.bucket_start_date>=w.signal_first_at::date and d.bucket_start_date<=w.evaluation_end_date) as evidence_qty,
    sum(d.transaction_count) filter(where d.bucket_start_date>=w.signal_first_at::date-w.evaluation_window_days and d.bucket_start_date<w.signal_first_at::date) as matched_pre_tx,
    sum(d.quantity_sold) filter(where d.bucket_start_date>=w.signal_first_at::date-w.evaluation_window_days and d.bucket_start_date<w.signal_first_at::date) as matched_pre_qty,
    sum(d.transaction_count) filter(where d.bucket_start_date>=w.signal_first_at::date-30 and d.bucket_start_date<w.signal_first_at::date) as pre_tx_30d,
    sum(d.quantity_sold) filter(where d.bucket_start_date>=w.signal_first_at::date-30 and d.bucket_start_date<w.signal_first_at::date) as pre_qty_30d,
    sum(d.transaction_count) filter(where d.bucket_start_date>=w.signal_first_at::date and d.bucket_start_date<=least(current_date,w.signal_first_at::date+89)) as post_tx_to_date,
    sum(d.quantity_sold) filter(where d.bucket_start_date>=w.signal_first_at::date and d.bucket_start_date<=least(current_date,w.signal_first_at::date+89)) as post_qty_to_date
  from windows w left join daily d on d.user_id=w.user_id and d.card_name=w.card_name
  group by w.user_id,w.card_name,w.signal_first_at,w.evaluation_end_date,w.evaluation_window_days
), coverage as (
  select s.user_id,s.card_name,count(distinct s.sku_id)::integer as nm_english_sku_count,
    count(distinct s.sku_id) filter(where r.sales_fetched_at is not null)::integer as covered_sku_count
  from sku_set s
  left join public.marketplace_signal_nm_sales_current r on r.user_id=s.user_id and r.card_name=s.card_name and r.sku_id=s.sku_id
  group by s.user_id,s.card_name
)
select w.user_id,w.card_name,w.signal_first_at,w.signal_last_at,c.nm_english_sku_count,c.covered_sku_count,
  w.threshold_bucket_start,w.evaluation_end_date,w.evaluation_window_days,
  case when w.threshold_bucket_start is not null then greatest(1,w.evaluation_end_date-w.signal_first_at::date+1) else null end as time_to_3_transactions_days,
  coalesce(a.post_tx_to_date,0)::numeric as post_signal_transactions_to_date,
  coalesce(a.post_qty_to_date,0)::numeric as post_signal_quantity_to_date,
  coalesce(a.evidence_tx,0)::numeric as evidence_transactions,
  coalesce(a.evidence_qty,0)::numeric as evidence_quantity,
  coalesce(a.matched_pre_tx,0)::numeric as matched_pre_transactions,
  coalesce(a.matched_pre_qty,0)::numeric as matched_pre_quantity,
  coalesce(a.pre_tx_30d,0)::numeric as pre_signal_transactions_30d,
  coalesce(a.pre_qty_30d,0)::numeric as pre_signal_qty_30d,
  round(coalesce(a.evidence_tx,0)/w.evaluation_window_days::numeric,4) as evidence_daily_transactions,
  round(coalesce(a.matched_pre_tx,0)/w.evaluation_window_days::numeric,4) as matched_pre_daily_transactions,
  round(coalesce(a.pre_tx_30d,0)/30.0,4) as pre_30d_daily_transactions,
  case when coalesce(a.matched_pre_tx,0)>0 then round(((coalesce(a.evidence_tx,0)/w.evaluation_window_days::numeric)/(a.matched_pre_tx/w.evaluation_window_days::numeric)-1)*100,2) end as transaction_velocity_lift_matched_pct,
  case when coalesce(a.pre_tx_30d,0)>0 then round(((coalesce(a.evidence_tx,0)/w.evaluation_window_days::numeric)/(a.pre_tx_30d/30.0)-1)*100,2) end as transaction_velocity_lift_30d_pct,
  case when c.covered_sku_count=0 then 'unmeasured' when coalesce(a.post_tx_to_date,0)>=6 then 'strong' when coalesce(a.post_tx_to_date,0)>=3 then 'confirmed' when coalesce(a.post_tx_to_date,0)=2 then 'emerging' when coalesce(a.post_tx_to_date,0)=1 then 'anecdotal' else 'no_sales' end as evidence_level,
  case when c.covered_sku_count=0 then 'awaiting_collection' when coalesce(a.post_tx_to_date,0)>=3 then 'confirmed' when c.covered_sku_count<c.nm_english_sku_count then 'partial_coverage' else 'insufficient_sales_evidence' end as evidence_status,
  case when c.covered_sku_count=0 then 'none' when coalesce(a.post_tx_to_date,0)>=6 and coalesce(a.pre_tx_30d,0)>=3 and c.covered_sku_count=c.nm_english_sku_count then 'high' when coalesce(a.post_tx_to_date,0)>=3 then 'medium' else 'low' end as evidence_confidence,
  round((c.covered_sku_count::numeric/nullif(c.nm_english_sku_count,0))*100,1) as coverage_pct,
  case when c.covered_sku_count=0 then 'unmeasured' when c.covered_sku_count=c.nm_english_sku_count then 'complete' else 'partial' end as coverage_status
from windows w
join coverage c on c.user_id=w.user_id and c.card_name=w.card_name
left join agg a on a.user_id=w.user_id and a.card_name=w.card_name;

grant select on public.marketplace_signal_card_sales_response to authenticated,service_role;
revoke all on public.marketplace_signal_card_sales_response from anon;
