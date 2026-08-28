create or replace view public.market_intel_catalyst_shadow_backtest
with (security_invoker = true)
as
select s.*,
 p0.market_price baseline_market_price,p1.market_price market_price_1d,p3.market_price market_price_3d,p7.market_price market_price_7d,p30.market_price market_price_30d,
 round(100*(p1.market_price-p0.market_price)/nullif(p0.market_price,0),2) market_change_1d_pct,
 round(100*(p3.market_price-p0.market_price)/nullif(p0.market_price,0),2) market_change_3d_pct,
 round(100*(p7.market_price-p0.market_price)/nullif(p0.market_price,0),2) market_change_7d_pct,
 round(100*(p30.market_price-p0.market_price)/nullif(p0.market_price,0),2) market_change_30d_pct,
 coalesce(sa.tx_1d,0) transactions_1d,coalesce(sa.tx_3d,0) transactions_3d,coalesce(sa.tx_7d,0) transactions_7d,coalesce(sa.tx_30d,0) transactions_30d,
 coalesce(sa.qty_1d,0) quantity_1d,coalesce(sa.qty_3d,0) quantity_3d,coalesce(sa.qty_7d,0) quantity_7d,coalesce(sa.qty_30d,0) quantity_30d,
 now()>=s.captured_at+interval '1 day' matured_1d,now()>=s.captured_at+interval '3 days' matured_3d,now()>=s.captured_at+interval '7 days' matured_7d,now()>=s.captured_at+interval '30 days' matured_30d
from public.market_intel_catalyst_shadow_snapshots s
left join lateral (select market_price from public.tcgplayer_official_sku_price_history h where h.sku_id=s.sku_id::text and h.observed_at<=s.captured_at and h.market_price is not null order by h.observed_at desc limit 1) p0 on true
left join lateral (select market_price from public.tcgplayer_official_sku_price_history h where h.sku_id=s.sku_id::text and h.observed_at>=s.captured_at+interval '1 day' and h.market_price is not null order by h.observed_at limit 1) p1 on true
left join lateral (select market_price from public.tcgplayer_official_sku_price_history h where h.sku_id=s.sku_id::text and h.observed_at>=s.captured_at+interval '3 days' and h.market_price is not null order by h.observed_at limit 1) p3 on true
left join lateral (select market_price from public.tcgplayer_official_sku_price_history h where h.sku_id=s.sku_id::text and h.observed_at>=s.captured_at+interval '7 days' and h.market_price is not null order by h.observed_at limit 1) p7 on true
left join lateral (select market_price from public.tcgplayer_official_sku_price_history h where h.sku_id=s.sku_id::text and h.observed_at>=s.captured_at+interval '30 days' and h.market_price is not null order by h.observed_at limit 1) p30 on true
left join lateral (select
 coalesce(sum(b.transaction_count) filter(where b.bucket_start_date<=(s.captured_at+interval '1 day')::date),0) tx_1d,
 coalesce(sum(b.transaction_count) filter(where b.bucket_start_date<=(s.captured_at+interval '3 days')::date),0) tx_3d,
 coalesce(sum(b.transaction_count) filter(where b.bucket_start_date<=(s.captured_at+interval '7 days')::date),0) tx_7d,
 coalesce(sum(b.transaction_count) filter(where b.bucket_start_date<=(s.captured_at+interval '30 days')::date),0) tx_30d,
 coalesce(sum(b.quantity_sold) filter(where b.bucket_start_date<=(s.captured_at+interval '1 day')::date),0) qty_1d,
 coalesce(sum(b.quantity_sold) filter(where b.bucket_start_date<=(s.captured_at+interval '3 days')::date),0) qty_3d,
 coalesce(sum(b.quantity_sold) filter(where b.bucket_start_date<=(s.captured_at+interval '7 days')::date),0) qty_7d,
 coalesce(sum(b.quantity_sold) filter(where b.bucket_start_date<=(s.captured_at+interval '30 days')::date),0) qty_30d
 from public.marketplace_sku_sales_buckets b where b.user_id=s.user_id and b.sku_id=s.sku_id::text and b.bucket_start_date>s.captured_at::date and b.bucket_start_date<=(s.captured_at+interval '30 days')::date) sa on true;
grant select on public.market_intel_catalyst_shadow_backtest to authenticated;
