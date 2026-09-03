create or replace function public.ask_delvin_tcgplayer_top_selling_month_v1(
  p_month date,
  p_limit integer default 10
)
returns table(
  sales_window_start date,
  sales_window_end date,
  price_bucket text,
  rank integer,
  card_name text,
  set_name text,
  average_sale_price numeric,
  source_url text,
  article_title text
)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select distinct
      (sc.payload_json->>'report_window_start')::date as window_start,
      (sc.payload_json->>'report_window_end')::date as window_end,
      sc.payload_json->'criteria'->>'prior_month_average_sale_price_bucket' as bucket,
      nullif(split_part(split_part(i.summary, 'rank #', 2), ';', 1), '')::integer as sales_rank,
      e.entity_name as card_name,
      nullif(split_part(split_part(i.summary, ' [', 2), '] among', 1), '') as set_name,
      case when position('average sale price $' in i.summary) > 0 then
        nullif(regexp_replace(split_part(split_part(i.summary, 'average sale price $', 2), ';', 1), '[^0-9.]', '', 'g'), '')::numeric
      else null end as avg_price,
      i.source_url,
      sc.payload_json->>'parent_article_title' as article_title
    from public.source_captures sc
    join public.market_intel_items i
      on i.user_id = sc.user_id
     and i.source_name = 'TCGplayer Top Selling Report'
     and i.source_url = sc.source_key
    join public.market_intel_entities e on e.intel_id = i.intel_id
    where sc.source = 'TCGplayer Top Selling Report'
      and sc.capture_type = 'data_report'
      and sc.metadata_json->>'status' = 'saved'
      and date_trunc('month', (sc.payload_json->>'report_window_start')::date) = date_trunc('month', p_month)
      and position('rank #' in i.summary) > 0
  ), ranked as (
    select b.*, row_number() over (partition by b.bucket order by b.sales_rank, b.card_name) as rn
    from base b
    where b.sales_rank is not null
  )
  select r.window_start, r.window_end, r.bucket, r.sales_rank, r.card_name, r.set_name,
         r.avg_price, r.source_url, r.article_title
  from ranked r
  where r.rn <= greatest(1, least(coalesce(p_limit,10), 50))
  order by case when r.bucket = '$50+' then 0 else 1 end, r.sales_rank, r.card_name;
$$;

revoke all on function public.ask_delvin_tcgplayer_top_selling_month_v1(date, integer) from public, anon, authenticated;
grant execute on function public.ask_delvin_tcgplayer_top_selling_month_v1(date, integer) to service_role;
