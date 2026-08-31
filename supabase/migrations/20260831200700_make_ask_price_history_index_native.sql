create or replace function public.ask_card_price_history_v1(p_product_id bigint default null, p_sku_id bigint default null, p_days integer default 180)
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
with params as (
  select case when p_sku_id is null then null else p_sku_id::text end as sku_key,
         case when p_product_id is null then null else p_product_id::text end as product_key,
         greatest(1, least(coalesce(p_days,180),730)) as days
), target_candidates as (
  select c.sku_id,
         c.product_id,
         c.card_name,
         c.set_code,
         c.collector_number,
         c.printing,
         c.condition,
         c.language,
         0 as source_rank
  from public.scout_card_catalog c cross join params p
  where (p.sku_key is not null and c.sku_id = p.sku_key)
     or (p.sku_key is null and p.product_key is not null and c.product_id = p.product_key)
  union all
  select m.sku_id,
         m.product_id,
         m.product_name,
         m.set_code,
         m.collector_number,
         m.printing,
         m.condition,
         m.language,
         1 as source_rank
  from public.marketplace_scan_rows m cross join params p
  where (p.sku_key is not null and m.sku_id = p.sku_key)
     or (p.sku_key is null and p.product_key is not null and m.product_id = p.product_key)
), target as (
  select sku_id,product_id,card_name,set_code,collector_number,printing,condition,language
  from target_candidates
  order by
    case when upper(coalesce(condition,''))='NEAR MINT' then 0 else 1 end,
    case when upper(coalesce(language,''))='ENGLISH' then 0 else 1 end,
    source_rank,
    case when upper(coalesce(printing,'')) in ('NON FOIL','NORMAL') then 0 else 1 end
  limit 1
), hist as (
  select h.sku_id,
         h.product_id,
         h.market_price,
         h.low_price,
         h.lowest_listing_price,
         h.direct_low_price,
         h.observed_at
  from public.tcgplayer_official_sku_price_history h
  join target t on h.sku_id = t.sku_id
  cross join params p
  where h.observed_at >= now() - make_interval(days => p.days)
), sales as (
  select b.sku_id,
         b.product_id,
         b.bucket_start_date,
         b.market_price,
         b.low_sale_price,
         b.high_sale_price,
         b.low_sale_price_with_shipping,
         b.high_sale_price_with_shipping,
         b.quantity_sold,
         b.transaction_count,
         b.source
  from public.marketplace_sku_sales_buckets b
  join target t on b.sku_id = t.sku_id
  cross join params p
  where b.user_id = auth.uid()
    and b.bucket_start_date >= current_date - p.days
)
select jsonb_build_object(
  'available', exists(select 1 from target),
  'days', (select days from params),
  'card', coalesce((select jsonb_build_object(
      'sku_id', t.sku_id::bigint,
      'product_id', t.product_id::bigint,
      'card_name', t.card_name,
      'set_code', t.set_code,
      'collector_number', t.collector_number,
      'printing', t.printing,
      'condition', t.condition,
      'language', t.language
    ) from target t), '{}'::jsonb),
  'price_points', coalesce((select jsonb_agg(jsonb_build_object(
      'sku_id', h.sku_id::bigint,
      'product_id', h.product_id::bigint,
      'market_price', h.market_price,
      'low_price', h.low_price,
      'lowest_listing_price', h.lowest_listing_price,
      'direct_low_price', h.direct_low_price,
      'observed_at', h.observed_at
    ) order by h.observed_at) from hist h), '[]'::jsonb),
  'sales_points', coalesce((select jsonb_agg(jsonb_build_object(
      'sku_id', s.sku_id::bigint,
      'product_id', s.product_id::bigint,
      'bucket_start_date', s.bucket_start_date,
      'market_price', s.market_price,
      'low_sale_price', s.low_sale_price,
      'high_sale_price', s.high_sale_price,
      'low_sale_price_with_shipping', s.low_sale_price_with_shipping,
      'high_sale_price_with_shipping', s.high_sale_price_with_shipping,
      'quantity_sold', s.quantity_sold,
      'transaction_count', s.transaction_count,
      'source', s.source
    ) order by s.bucket_start_date) from sales s), '[]'::jsonb),
  'price_point_count', (select count(*) from hist),
  'sales_point_count', (select count(*) from sales),
  'sales_source', case when exists(select 1 from sales) then 'tcgplayer_marketplace' else null end
);
$function$;

revoke all on function public.ask_card_price_history_v1(bigint,bigint,integer) from public, anon;
grant execute on function public.ask_card_price_history_v1(bigint,bigint,integer) to authenticated, service_role;
