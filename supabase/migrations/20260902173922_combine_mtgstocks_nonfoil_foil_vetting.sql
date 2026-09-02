create or replace function public.ask_mtgstocks_interests_vetted_all_v1(
  p_source_date text default null,
  p_price_type text default 'average',
  p_window text default '24h',
  p_scan_per_finish integer default 80
) returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  r jsonb;
  f jsonb;
  raw_rows jsonb;
  mover_rows jsonb;
  noise_rows jsonb;
  scan_n integer := greatest(10,least(coalesce(p_scan_per_finish,80),80));
begin
  r := public.ask_mtgstocks_interests_vetted_v1(p_source_date,'regular',p_price_type,p_window,scan_n);
  f := public.ask_mtgstocks_interests_vetted_v1(p_source_date,'foil',p_price_type,p_window,scan_n);

  with all_raw as (
    select x, ord, 0 lane from jsonb_array_elements(coalesce(r->'raw','[]'::jsonb)) with ordinality a(x,ord)
    union all
    select x, ord, 1 lane from jsonb_array_elements(coalesce(f->'raw','[]'::jsonb)) with ordinality a(x,ord)
  ), dedup as (
    select distinct on (
      coalesce(x->>'finish',''),
      coalesce(nullif(x->>'print_id',''),nullif(x->>'sku_id',''),(x->>'card_name')||'|'||coalesce(x->>'set_code',x->>'set_name',''))
    ) x
    from all_raw
    order by coalesce(x->>'finish',''),
      coalesce(nullif(x->>'print_id',''),nullif(x->>'sku_id',''),(x->>'card_name')||'|'||coalesce(x->>'set_code',x->>'set_name','')),
      abs(coalesce(nullif(x->>'pct_change','')::numeric,0)) desc,
      lane, ord
  ), ranked as (
    select x from dedup
    order by abs(coalesce(nullif(x->>'pct_change','')::numeric,0)) desc
    limit scan_n * 2
  )
  select coalesce(jsonb_agg(x order by abs(coalesce(nullif(x->>'pct_change','')::numeric,0)) desc),'[]'::jsonb)
  into raw_rows from ranked;

  with all_movers as (
    select x from jsonb_array_elements(coalesce(r->'early_movers','[]'::jsonb)) x
    union all
    select x from jsonb_array_elements(coalesce(f->'early_movers','[]'::jsonb)) x
  )
  select coalesce(jsonb_agg(x order by coalesce(nullif(x->>'action_score','')::numeric,0) desc, coalesce(nullif(x->>'pct_change','')::numeric,0) desc),'[]'::jsonb)
  into mover_rows from all_movers;

  with all_noise as (
    select x from jsonb_array_elements(coalesce(r->'noise','[]'::jsonb)) x
    union all
    select x from jsonb_array_elements(coalesce(f->'noise','[]'::jsonb)) x
  ), dedup as (
    select distinct on (
      coalesce(x->>'finish',''),
      coalesce(nullif(x->>'print_id',''),nullif(x->>'sku_id',''),(x->>'card_name')||'|'||coalesce(x->>'set_code',x->>'set_name','')),
      coalesce(x->>'vet_class','')
    ) x
    from all_noise
    order by coalesce(x->>'finish',''),
      coalesce(nullif(x->>'print_id',''),nullif(x->>'sku_id',''),(x->>'card_name')||'|'||coalesce(x->>'set_code',x->>'set_name','')),
      coalesce(x->>'vet_class',''),
      abs(coalesce(nullif(x->>'pct_change','')::numeric,0)) desc
  )
  select coalesce(jsonb_agg(x order by abs(coalesce(nullif(x->>'pct_change','')::numeric,0)) desc),'[]'::jsonb)
  into noise_rows from dedup;

  return jsonb_build_object(
    'observed_date', greatest(coalesce(r->>'observed_date',''),coalesce(f->>'observed_date','')),
    'source_dates', jsonb_build_object('nonfoil',r->>'observed_date','foil',f->>'observed_date'),
    'finish','all',
    'price_type',p_price_type,
    'window',p_window,
    'scan_per_finish',scan_n,
    'raw',raw_rows,
    'early_movers',mover_rows,
    'noise',noise_rows
  );
end;
$function$;

grant execute on function public.ask_mtgstocks_interests_vetted_all_v1(text,text,text,integer) to anon, authenticated, service_role;
