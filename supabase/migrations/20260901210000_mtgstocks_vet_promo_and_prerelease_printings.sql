alter function public.ask_mtgstocks_interests_vetted_v1(text,text,text,text,integer)
  rename to ask_mtgstocks_interests_vetted_v2_core;

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
  kept_movers jsonb;
  promo_noise jsonb;
  merged_noise jsonb;
begin
  d := public.ask_mtgstocks_interests_vetted_v2_core(
    p_source_date,p_finish,p_price_type,p_window,p_limit
  );

  select coalesce(jsonb_agg(x order by ord),'[]'::jsonb)
  into kept_movers
  from jsonb_array_elements(coalesce(d->'early_movers','[]'::jsonb)) with ordinality as a(x,ord)
  where coalesce(x->>'set_name','') !~* '(^|:| )Promo Pack(:| |$)|Prerelease|Pre-Release';

  select coalesce(jsonb_agg(
    jsonb_set(
      jsonb_set(x,'{vet_class}',to_jsonb('promo_printing'::text),true),
      '{reasons}',
      to_jsonb(array['promo/prerelease printing omitted from early-mover ranking']::text[]),
      true
    ) order by ord
  ),'[]'::jsonb)
  into promo_noise
  from jsonb_array_elements(coalesce(d->'early_movers','[]'::jsonb)) with ordinality as a(x,ord)
  where coalesce(x->>'set_name','') ~* '(^|:| )Promo Pack(:| |$)|Prerelease|Pre-Release';

  merged_noise := coalesce(d->'noise','[]'::jsonb) || promo_noise;
  d := jsonb_set(d,'{early_movers}',kept_movers,true);
  d := jsonb_set(d,'{noise}',merged_noise,true);
  return d;
end;
$$;

grant execute on function public.ask_mtgstocks_interests_vetted_v1(text,text,text,text,integer)
  to authenticated, service_role;
