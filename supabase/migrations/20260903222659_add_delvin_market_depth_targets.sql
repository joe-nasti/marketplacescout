create or replace function public.ask_delvin_market_depth_targets_v1(
  p_card_name text,
  p_set_name text,
  p_limit integer default 12
)
returns table(
  product_id text,
  sku_id text,
  card_name text,
  set_code text,
  set_name text,
  condition text,
  printing text,
  collector_number text
)
language sql
stable
security definer
set search_path='public'
as $function$
with set_match as (
  select code,name,tcgplayer_name
  from public.magic_set_catalog
  where lower(coalesce(tcgplayer_name,name))=lower(trim(coalesce(p_set_name,'')))
     or lower(name)=lower(trim(coalesce(p_set_name,'')))
  order by case when lower(coalesce(tcgplayer_name,name))=lower(trim(coalesce(p_set_name,''))) then 0 else 1 end
  limit 1
), base as (
  select public.delvin_base_card_name_v1(p_card_name) card_name
), candidates as (
  select distinct on (c.sku_id)
    c.product_id,c.sku_id,c.card_name,c.set_code,
    coalesce(sm.tcgplayer_name,sm.name,p_set_name) set_name,
    c.condition,c.printing,c.collector_number
  from public.scout_card_catalog c
  join set_match sm on sm.code=c.set_code
  cross join base b
  where lower(c.card_name)=lower(b.card_name)
    and upper(coalesce(c.language,''))='ENGLISH'
    and upper(coalesce(c.condition,'')) in ('NEAR MINT','LIGHTLY PLAYED')
    and c.product_id ~ '^\\d+$'
    and c.sku_id ~ '^\\d+$'
  order by c.sku_id,
    case upper(coalesce(c.condition,'')) when 'NEAR MINT' then 0 else 1 end,
    case upper(coalesce(c.printing,'')) when 'NON FOIL' then 0 when 'FOIL' then 1 else 2 end
)
select * from candidates
order by
  case upper(coalesce(condition,'')) when 'NEAR MINT' then 0 else 1 end,
  case upper(coalesce(printing,'')) when 'NON FOIL' then 0 when 'FOIL' then 1 else 2 end,
  product_id,sku_id
limit greatest(1,least(coalesce(p_limit,12),20))
$function$;

revoke all on function public.ask_delvin_market_depth_targets_v1(text,text,integer) from public,anon,authenticated;
grant execute on function public.ask_delvin_market_depth_targets_v1(text,text,integer) to service_role;