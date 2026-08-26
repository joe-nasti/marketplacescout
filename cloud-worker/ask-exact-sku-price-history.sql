-- Exact-SKU price history for Ask comparisons. Product-only history can mix variants/conditions.
create or replace function public.ask_collectish_get_sku_price_history(
  p_product_id text default null,
  p_sku_id text default null
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_product_id is null and p_sku_id is null then raise exception 'product_id or sku_id required'; end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.captured_at),'[]'::jsonb)
  into result
  from (
    select sc.captured_at, r.sku_id, r.product_id, r.sku_market_price, r.tcg_low,
           r.low_with_shipping, r.direct_low, r.direct_available, r.direct_listings,
           r.opportunity_score
    from public.marketplace_scan_rows r
    join public.marketplace_scans sc on sc.scan_id=r.scan_id and sc.user_id=r.user_id
    where r.user_id=auth.uid()
      and (p_product_id is null or r.product_id=p_product_id)
      and (p_sku_id is null or r.sku_id=p_sku_id)
    order by sc.captured_at desc
    limit 240
  ) x;

  return jsonb_build_object(
    'product_id',p_product_id,
    'sku_id',p_sku_id,
    'scope',case when p_sku_id is not null then 'exact_sku' else 'product' end,
    'observations',result,
    'count',jsonb_array_length(result)
  );
end
$function$;
