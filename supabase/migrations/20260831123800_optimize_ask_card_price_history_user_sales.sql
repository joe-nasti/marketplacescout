create or replace function public.ask_card_price_history_v1(p_product_id bigint default null::bigint, p_sku_id bigint default null::bigint, p_days integer default 180)
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
with target_candidates as (
  select c.sku_id::bigint as sku_id,
         c.product_id::bigint as product_id,
         c.card_name,
         c.set_code,
         c.collector_number,
         c.printing,
         c.condition,
         c.language,
         0 as source_rank
  from public.scout_card_catalog c
  where (p_sku_id is not null and c.sku_id::bigint = p_sku_id)
     or (p_sku_id is null and p_product_id is not null and c.product_id::bigint = p_product_id)
  union all
  select m.sku_id::bigint,
         m.product_id::bigint,
         m.product_name,
         m.set_code,
         m.collector_number,
         m.printing,
         m.condition,
         m.language,
         1 as source_rank
  from public.marketplace_scan_rows m
  where (p_sku_id is not null and m.sku_id::bigint = p_sku_id)
     or (p_sku_id is null and p_product_id is not null and m.product_id::bigint = p_product_id)
), target as (
  select sku_id,product_id,card_name,set_code,collector_number,printing,condition,language
  from target_candidates
  order by
    case when upper(coalesce(condition,''))='NEAR MINT' then 0 else 1 end,
    case when upper(coalesce(language,''))='ENGLISH' then 0 else 1 end,
    source_rank,
    case when upper(coalesce(printing,'')) in ('NON FOIL','NORMAL') then 0 else 1 end
  limit 1
), hist_ranked as (
  select h.sku_id::bigint,
         h.product_id::bigint,
         h.market_price,
         h.low_price,
         h.lowest_listing_price,
         h.direct_low_price,
         h.observed_at,
         row_number() over (
           partition by h.sku_id::bigint, date_trunc('hour',h.observed_at)
           order by h.observed_at desc
         ) as rn
  from public.tcgplayer_official_sku_price_history h
  join target t on t.sku_id = h.sku_id::bigint
  where h.observed_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days,180), 730)))
), hist as (
  select sku_id,product_id,market_price,low_price,lowest_listing_price,direct_low_price,observed_at
  from hist_ranked where rn=1
), sales_ranked as (
  select b.sku_id::bigint,
         b.product_id::bigint,
         b.bucket_start_date,
         b.market_price,
         b.low_sale_price,
         b.high_sale_price,
         b.low_sale_price_with_shipping,
         b.high_sale_price_with_shipping,
         b.quantity_sold,
         b.transaction_count,
         b.source,
         b.observed_at,
         row_number() over (
           partition by b.sku_id::bigint,b.bucket_start_date
           order by b.observed_at desc
         ) as rn
  from public.marketplace_sku_sales_buckets b
  join target t on t.sku_id = b.sku_id::bigint
  where b.user_id = auth.uid()
    and b.bucket_start_date >= current_date - greatest(1, least(coalesce(p_days,180),730))
), sales as (
  select sku_id,product_id,bucket_start_date,market_price,low_sale_price,high_sale_price,
         low_sale_price_with_shipping,high_sale_price_with_shipping,quantity_sold,transaction_count,source
  from sales_ranked where rn=1
)
select jsonb_build_object(
  'available', exists(select 1 from target),
  'days', greatest(1, least(coalesce(p_days,180),730)),
  'card', coalesce((select to_jsonb(t) from target t), '{}'::jsonb),
  'price_points', coalesce((select jsonb_agg(to_jsonb(h) order by h.observed_at) from hist h), '[]'::jsonb),
  'sales_points', coalesce((select jsonb_agg(to_jsonb(s) order by s.bucket_start_date) from sales s), '[]'::jsonb),
  'price_point_count', (select count(*) from hist),
  'sales_point_count', (select count(*) from sales),
  'sales_source', case when exists(select 1 from sales) then 'tcgplayer_marketplace' else null end
);
$function$;
