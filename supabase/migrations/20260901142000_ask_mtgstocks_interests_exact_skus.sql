alter function public.ask_mtgstocks_interests_vetted_v1(text,text,text,text,integer) rename to ask_mtgstocks_interests_vetted_base_v1;

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
  raw_rows jsonb;
  mover_rows jsonb;
begin
  d := public.ask_mtgstocks_interests_vetted_base_v1(p_source_date,p_finish,p_price_type,p_window,p_limit);
  select coalesce(jsonb_agg(
    case when coalesce(x->>'sku_id','')<>'' or coalesce(x->>'product_id','')='' then x
    else x || jsonb_build_object('sku_id',(
      select s.sku_id::text from mtgjson_tcgplayer_skus s
      where s.product_id=(x->>'product_id')
        and upper(coalesce(s.condition,''))='NEAR MINT'
        and upper(coalesce(s.language,''))='ENGLISH'
        and (case when p_finish='foil'
          then upper(coalesce(s.printing,'')) like '%FOIL%' and upper(coalesce(s.printing,'')) not like '%NON FOIL%'
          else upper(coalesce(s.printing,'')) like '%NON FOIL%'
        end)
      order by s.sku_id limit 1
    )) end
  ),'[]'::jsonb) into raw_rows
  from jsonb_array_elements(coalesce(d->'raw','[]'::jsonb)) x;

  select coalesce(jsonb_agg(
    case when coalesce(x->>'sku_id','')<>'' or coalesce(x->>'product_id','')='' then x
    else x || jsonb_build_object('sku_id',(
      select s.sku_id::text from mtgjson_tcgplayer_skus s
      where s.product_id=(x->>'product_id')
        and upper(coalesce(s.condition,''))='NEAR MINT'
        and upper(coalesce(s.language,''))='ENGLISH'
        and (case when p_finish='foil'
          then upper(coalesce(s.printing,'')) like '%FOIL%' and upper(coalesce(s.printing,'')) not like '%NON FOIL%'
          else upper(coalesce(s.printing,'')) like '%NON FOIL%'
        end)
      order by s.sku_id limit 1
    )) end
  ),'[]'::jsonb) into mover_rows
  from jsonb_array_elements(coalesce(d->'early_movers','[]'::jsonb)) x;

  return jsonb_set(jsonb_set(d,'{raw}',raw_rows,true),'{early_movers}',mover_rows,true);
end;
$$;
revoke all on function public.ask_mtgstocks_interests_vetted_v1(text,text,text,text,integer) from public;
grant execute on function public.ask_mtgstocks_interests_vetted_v1(text,text,text,text,integer) to service_role;
revoke all on function public.ask_mtgstocks_interests_vetted_base_v1(text,text,text,text,integer) from public;
grant execute on function public.ask_mtgstocks_interests_vetted_base_v1(text,text,text,text,integer) to service_role;
