-- Keep every MTGStocks Interests card clickable without pretending an unresolved
-- printing has a real TCGplayer SKU. Existing resolved rows retain their SKU;
-- unresolved rows get a lookup: token consumed only by the Collectish web router.

alter function public.ask_mtgstocks_interests_vetted_v1(text,text,text,text,integer)
  rename to ask_mtgstocks_interests_vetted_core_v1;

create function public.ask_mtgstocks_interests_vetted_v1(
  p_source_date text default null,
  p_finish text default 'regular',
  p_price_type text default 'average',
  p_window text default '24h',
  p_limit integer default 40
) returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  d jsonb;
  raw_links jsonb;
  mover_links jsonb;
begin
  d := public.ask_mtgstocks_interests_vetted_core_v1(
    p_source_date,p_finish,p_price_type,p_window,p_limit
  );

  select coalesce(jsonb_agg(
    case when coalesce(x->>'sku_id','')='' then
      jsonb_set(
        x,
        '{sku_id}',
        to_jsonb(
          'lookup:' || coalesce(x->>'card_name','') || '|' ||
          coalesce(x->>'set_code',x->>'set_name','') || '|' ||
          coalesce(x->>'finish','regular')
        ),
        true
      )
    else x end
    order by ord
  ),'[]'::jsonb)
  into raw_links
  from jsonb_array_elements(coalesce(d->'raw','[]'::jsonb))
       with ordinality as a(x,ord);

  select coalesce(jsonb_agg(
    case when coalesce(x->>'sku_id','')='' then
      jsonb_set(
        x,
        '{sku_id}',
        to_jsonb(
          'lookup:' || coalesce(x->>'card_name','') || '|' ||
          coalesce(x->>'set_code',x->>'set_name','') || '|' ||
          coalesce(x->>'finish','regular')
        ),
        true
      )
    else x end
    order by ord
  ),'[]'::jsonb)
  into mover_links
  from jsonb_array_elements(coalesce(d->'early_movers','[]'::jsonb))
       with ordinality as a(x,ord);

  d := jsonb_set(d,'{raw}',raw_links,true);
  d := jsonb_set(d,'{early_movers}',mover_links,true);
  return d;
end;
$$;

grant execute on function public.ask_mtgstocks_interests_vetted_v1(text,text,text,text,integer)
  to authenticated, service_role;
