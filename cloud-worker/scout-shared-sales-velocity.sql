-- Shared TCGplayer sales-history normalization used by Scout, Signals, and Ask.
-- Production backfill completed 2026-08-26. Re-running apply_marketplace_sales_history
-- is idempotent for the cache, hourly SKU observations, and daily sales buckets.

create or replace function public.apply_marketplace_sales_history(
  p_user_id uuid,
  p_product_id text,
  p_result jsonb,
  p_source text default 'shared_sales_worker'::text
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n integer:=0;
  v_now timestamptz:=now();
  v_hour timestamptz:=date_trunc('hour',now());
begin
  insert into public.marketplace_product_sales_cache(user_id,product_id,fetched_at,source,raw_result,sku_count)
  values(p_user_id,p_product_id,v_now,coalesce(nullif(p_source,''),'shared_sales_worker'),coalesce(p_result,'[]'::jsonb),jsonb_array_length(coalesce(p_result,'[]'::jsonb)))
  on conflict(user_id,product_id) do update set fetched_at=excluded.fetched_at,source=excluded.source,raw_result=excluded.raw_result,sku_count=excluded.sku_count;

  insert into public.scout_product_sales_cache(user_id,product_id,fetched_at,source,raw_result,sku_count)
  values(p_user_id,p_product_id,v_now,coalesce(nullif(p_source,''),'shared_sales_worker'),coalesce(p_result,'[]'::jsonb),jsonb_array_length(coalesce(p_result,'[]'::jsonb)))
  on conflict(user_id,product_id) do update set fetched_at=excluded.fetched_at,source=excluded.source,raw_result=excluded.raw_result,sku_count=excluded.sku_count;

  insert into public.marketplace_sku_sales_observations(
    user_id,product_id,sku_id,captured_at,captured_hour,condition,language,finish,printing,
    average_daily_quantity_sold,average_daily_transaction_count,quarter_quantity_sold,quarter_transaction_count,
    source,raw_json
  )
  select p_user_id,p_product_id,x.j->>'skuId',v_now,v_hour,s.condition,s.language,s.finish,s.printing,
         nullif(x.j->>'averageDailyQuantitySold','')::numeric,
         nullif(x.j->>'averageDailyTransactionCount','')::numeric,
         nullif(x.j->>'totalQuantitySold','')::numeric,
         nullif(x.j->>'totalTransactionCount','')::numeric,
         coalesce(nullif(p_source,''),'shared_sales_worker'),x.j
  from jsonb_array_elements(coalesce(p_result,'[]'::jsonb)) x(j)
  left join public.mtgjson_tcgplayer_skus s on s.sku_id=x.j->>'skuId'
  where nullif(x.j->>'skuId','') is not null
  on conflict(user_id,product_id,sku_id,captured_hour) do update set
    captured_at=excluded.captured_at,condition=excluded.condition,language=excluded.language,finish=excluded.finish,printing=excluded.printing,
    average_daily_quantity_sold=excluded.average_daily_quantity_sold,average_daily_transaction_count=excluded.average_daily_transaction_count,
    quarter_quantity_sold=excluded.quarter_quantity_sold,quarter_transaction_count=excluded.quarter_transaction_count,
    source=excluded.source,raw_json=excluded.raw_json;
  get diagnostics n=row_count;

  insert into public.marketplace_sku_sales_buckets(
    user_id,product_id,sku_id,bucket_start_date,condition,language,finish,printing,
    market_price,low_sale_price,high_sale_price,low_sale_price_with_shipping,high_sale_price_with_shipping,
    quantity_sold,transaction_count,source,observed_at
  )
  select p_user_id,p_product_id,x.j->>'skuId',(b.j->>'bucketStartDate')::date,
         s.condition,s.language,s.finish,s.printing,
         nullif(b.j->>'marketPrice','')::numeric,
         nullif(b.j->>'lowSalePrice','')::numeric,
         nullif(b.j->>'highSalePrice','')::numeric,
         nullif(b.j->>'lowSalePriceWithShipping','')::numeric,
         nullif(b.j->>'highSalePriceWithShipping','')::numeric,
         nullif(b.j->>'quantitySold','')::numeric,
         nullif(b.j->>'transactionCount','')::numeric,
         coalesce(nullif(p_source,''),'shared_sales_worker'),v_now
  from jsonb_array_elements(coalesce(p_result,'[]'::jsonb)) x(j)
  cross join lateral jsonb_array_elements(coalesce(x.j->'buckets','[]'::jsonb)) b(j)
  left join public.mtgjson_tcgplayer_skus s on s.sku_id=x.j->>'skuId'
  where nullif(x.j->>'skuId','') is not null and nullif(b.j->>'bucketStartDate','') is not null
  on conflict(user_id,product_id,sku_id,bucket_start_date) do update set
    condition=excluded.condition,language=excluded.language,finish=excluded.finish,printing=excluded.printing,
    market_price=excluded.market_price,low_sale_price=excluded.low_sale_price,high_sale_price=excluded.high_sale_price,
    low_sale_price_with_shipping=excluded.low_sale_price_with_shipping,high_sale_price_with_shipping=excluded.high_sale_price_with_shipping,
    quantity_sold=excluded.quantity_sold,transaction_count=excluded.transaction_count,source=excluded.source,observed_at=excluded.observed_at;

  update public.marketplace_scan_rows r set
    avg_daily_qty_sold=nullif(x.j->>'averageDailyQuantitySold','')::numeric,
    raw_json=coalesce(r.raw_json,'{}'::jsonb)||jsonb_build_object(
      'avgDailyQtySold',nullif(x.j->>'averageDailyQuantitySold','')::numeric,
      'avgDailyTransactions',nullif(x.j->>'averageDailyTransactionCount','')::numeric,
      'quarterQuantitySold',nullif(x.j->>'totalQuantitySold','')::numeric,
      'quarterTransactions',nullif(x.j->>'totalTransactionCount','')::numeric,
      'salesHistoryAvailable',true,'salesHistoryFetchedAt',v_now,
      'salesHistorySource',coalesce(nullif(p_source,''),'shared_sales_worker'))
  from jsonb_array_elements(coalesce(p_result,'[]'::jsonb)) x(j)
  join public.marketplace_scans s on s.user_id=p_user_id and s.captured_at>=now()-interval '48 hours'
  where r.user_id=p_user_id and r.scan_id=s.scan_id and r.product_id=p_product_id and r.sku_id=x.j->>'skuId';

  return n;
end;
$function$;

create or replace function public.annotate_scout_sales_confidence()
returns integer
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '30s'
as $function$
declare n integer;
begin
  with latest_scan as (
    select distinct on (r.user_id,r.sku_id)
      r.user_id,r.sku_id,
      coalesce((r.raw_json->>'salesHistoryAvailable')::boolean,false) as scan_known,
      nullif(r.raw_json->>'salesHistoryFetchedAt','')::timestamptz as scan_fetched_at,
      r.avg_daily_qty_sold as scan_sales_day,
      nullif(r.raw_json->>'quarterQuantitySold','')::numeric as scan_quarter_qty
    from marketplace_scan_rows r
    join marketplace_scans s on s.user_id=r.user_id and s.scan_id=r.scan_id
    where s.captured_at>=now()-interval '24 hours' and r.sku_id is not null
    order by r.user_id,r.sku_id,s.captured_at desc,r.id desc
  ), latest_sales as (
    select distinct on (m.user_id,m.sku_id)
      m.user_id,m.sku_id,m.captured_at,
      m.average_daily_quantity_sold,m.average_daily_transaction_count,
      m.quarter_quantity_sold,m.quarter_transaction_count
    from marketplace_sku_sales_observations m
    where m.sku_id is not null
    order by m.user_id,m.sku_id,m.captured_at desc
  ), merged as (
    select o.user_id,o.sku_id,
      (ls.sku_id is not null or coalesce(sc.scan_known,false)) as known,
      coalesce(ls.captured_at,sc.scan_fetched_at) as fetched_at,
      case
        when ls.average_daily_quantity_sold is not null and ls.average_daily_quantity_sold > 0 then ls.average_daily_quantity_sold
        when ls.quarter_quantity_sold is not null then ls.quarter_quantity_sold/90.0
        when sc.scan_sales_day is not null and sc.scan_sales_day > 0 then sc.scan_sales_day
        when sc.scan_quarter_qty is not null then sc.scan_quarter_qty/90.0
        when ls.average_daily_quantity_sold is not null then ls.average_daily_quantity_sold
        when sc.scan_sales_day is not null then sc.scan_sales_day
        else null
      end as measured_sales_day,
      ls.average_daily_transaction_count,ls.quarter_quantity_sold,ls.quarter_transaction_count
    from scout_opportunities_24h o
    left join latest_scan sc on sc.user_id=o.user_id and sc.sku_id=o.sku_id
    left join latest_sales ls on ls.user_id=o.user_id and ls.sku_id=o.sku_id
  )
  update scout_opportunities_24h o set
    avg_daily_qty_sold=m.measured_sales_day,
    score_components=coalesce(o.score_components,'{}'::jsonb) || jsonb_build_object(
      'sales_history_known',m.known,
      'sales_history_fetched_at',m.fetched_at,
      'sales_history_status',case when not m.known then 'unknown' when m.fetched_at is null then 'measured' when m.fetched_at<now()-interval '24 hours' then 'stale' else 'measured' end,
      'effective_sales_per_day',m.measured_sales_day,
      'average_daily_transaction_count',m.average_daily_transaction_count,
      'quarter_quantity_sold',m.quarter_quantity_sold,
      'quarter_transaction_count',m.quarter_transaction_count
    )
  from merged m where o.user_id=m.user_id and o.sku_id=m.sku_id;
  get diagnostics n=row_count;
  return n;
end;
$function$;
