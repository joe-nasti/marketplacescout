create or replace function public.ask_delvin_card_family_supply_targets_v1(
  p_card_name text,
  p_limit integer default 80
)
returns table(
  product_id text,
  sku_id text,
  card_name text,
  set_code text,
  collector_number text,
  printing text,
  condition text,
  language text,
  scryfall_id text
)
language sql
stable
security definer
set search_path='public'
as $function$
  select distinct on (c.sku_id)
    c.product_id,
    c.sku_id,
    c.card_name,
    c.set_code,
    c.collector_number,
    c.printing,
    c.condition,
    c.language,
    c.scryfall_id
  from public.scout_card_catalog c
  where lower(c.card_name)=lower(trim(coalesce(p_card_name,'')))
    and upper(coalesce(c.language,''))='ENGLISH'
    and upper(coalesce(c.condition,'')) in ('NEAR MINT','LIGHTLY PLAYED')
    and c.product_id ~ '^[0-9]+$'
    and c.sku_id ~ '^[0-9]+$'
  order by c.sku_id,
    case upper(coalesce(c.condition,'')) when 'NEAR MINT' then 0 else 1 end,
    case upper(coalesce(c.printing,'')) when 'NON FOIL' then 0 when 'FOIL' then 1 else 2 end
  limit greatest(1,least(coalesce(p_limit,80),120))
$function$;

revoke all on function public.ask_delvin_card_family_supply_targets_v1(text,integer) from public,anon,authenticated;
grant execute on function public.ask_delvin_card_family_supply_targets_v1(text,integer) to service_role;
