-- Historical 3-day TCGplayer sales buckets layered onto the shared Marketplace sales subsystem.
-- Production migration: normalize_marketplace_sales_buckets

create table if not exists public.marketplace_sku_sales_buckets (
  user_id uuid not null,
  product_id text not null,
  sku_id text not null,
  bucket_start_date date not null,
  condition text,
  language text,
  finish text,
  printing text,
  market_price numeric,
  low_sale_price numeric,
  high_sale_price numeric,
  low_sale_price_with_shipping numeric,
  high_sale_price_with_shipping numeric,
  quantity_sold numeric,
  transaction_count numeric,
  source text not null default 'tcgplayer_infinite_detailed_quarter',
  observed_at timestamptz not null default now(),
  primary key(user_id,product_id,sku_id,bucket_start_date)
);
create index if not exists marketplace_sku_sales_buckets_sku_date_idx
  on public.marketplace_sku_sales_buckets(user_id,sku_id,bucket_start_date desc);
create index if not exists marketplace_sku_sales_buckets_product_date_idx
  on public.marketplace_sku_sales_buckets(user_id,product_id,bucket_start_date desc);
alter table public.marketplace_sku_sales_buckets enable row level security;

drop policy if exists "Users read own marketplace sales buckets" on public.marketplace_sku_sales_buckets;
create policy "Users read own marketplace sales buckets"
  on public.marketplace_sku_sales_buckets for select to authenticated
  using ((select auth.uid())=user_id);
grant select on public.marketplace_sku_sales_buckets to authenticated;
revoke insert,update,delete on public.marketplace_sku_sales_buckets from authenticated;
revoke all on public.marketplace_sku_sales_buckets from anon;

-- apply_marketplace_sales_history also upserts every raw `buckets[]` item from each SKU result into
-- marketplace_sku_sales_buckets. Production function definition is managed with the shared schema.

create or replace view public.marketplace_signal_sales_response
with (security_invoker=true) as
select
  n.user_id,n.card_name,n.set_code,n.product_id,n.sku_id,n.finish,n.printing,
  n.signal_first_at,n.signal_last_at,n.sales_fetched_at,
  n.average_daily_quantity_sold,n.average_daily_transaction_count,n.quarter_quantity_sold,n.quarter_transaction_count,
  coalesce(a.pre_qty_30d,0) as pre_signal_qty_30d,
  coalesce(a.pre_tx_30d,0) as pre_signal_transactions_30d,
  coalesce(a.post_qty,0) as post_signal_qty,
  coalesce(a.post_tx,0) as post_signal_transactions,
  round(coalesce(a.pre_qty_30d,0)/30.0,4) as pre_signal_daily_qty,
  round(coalesce(a.post_qty,0)/greatest(1,least(30,(current_date-n.signal_first_at::date)+1))::numeric,4) as post_signal_daily_qty,
  case when coalesce(a.pre_qty_30d,0)>0 then
    round((((coalesce(a.post_qty,0)/greatest(1,least(30,(current_date-n.signal_first_at::date)+1))::numeric)/(a.pre_qty_30d/30.0))-1)*100,2)
  else null end as velocity_lift_pct,
  a.signal_market_price,a.latest_market_price,
  case when a.signal_market_price>0 and a.latest_market_price is not null
    then round(((a.latest_market_price/a.signal_market_price)-1)*100,2) else null end as market_price_change_pct,
  a.latest_low_sale_price,a.latest_high_sale_price,
  a.latest_low_sale_price_with_shipping,a.latest_high_sale_price_with_shipping,a.latest_bucket_date
from public.marketplace_signal_nm_sales_current n
left join lateral (
  select
    sum(b.quantity_sold) filter(where b.bucket_start_date>=n.signal_first_at::date-30 and b.bucket_start_date<n.signal_first_at::date) as pre_qty_30d,
    sum(b.transaction_count) filter(where b.bucket_start_date>=n.signal_first_at::date-30 and b.bucket_start_date<n.signal_first_at::date) as pre_tx_30d,
    sum(b.quantity_sold) filter(where b.bucket_start_date>=n.signal_first_at::date and b.bucket_start_date<=current_date) as post_qty,
    sum(b.transaction_count) filter(where b.bucket_start_date>=n.signal_first_at::date and b.bucket_start_date<=current_date) as post_tx,
    (array_agg(b.market_price order by b.bucket_start_date desc) filter(where b.bucket_start_date<=n.signal_first_at::date and b.market_price>0))[1] as signal_market_price,
    (array_agg(b.market_price order by b.bucket_start_date desc) filter(where b.market_price>0))[1] as latest_market_price,
    (array_agg(b.low_sale_price order by b.bucket_start_date desc) filter(where b.quantity_sold>0))[1] as latest_low_sale_price,
    (array_agg(b.high_sale_price order by b.bucket_start_date desc) filter(where b.quantity_sold>0))[1] as latest_high_sale_price,
    (array_agg(b.low_sale_price_with_shipping order by b.bucket_start_date desc) filter(where b.quantity_sold>0))[1] as latest_low_sale_price_with_shipping,
    (array_agg(b.high_sale_price_with_shipping order by b.bucket_start_date desc) filter(where b.quantity_sold>0))[1] as latest_high_sale_price_with_shipping,
    max(b.bucket_start_date) as latest_bucket_date
  from public.marketplace_sku_sales_buckets b
  where b.user_id=n.user_id and b.product_id=n.product_id and b.sku_id=n.sku_id
) a on true;
grant select on public.marketplace_signal_sales_response to authenticated,service_role;
revoke all on public.marketplace_signal_sales_response from anon;
