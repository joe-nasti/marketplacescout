create or replace function public.ask_collectish_public_card_lookup_v1(p_query text, p_limit integer default 20)
returns table(card_name text, product_id text, sku_id text, scryfall_id uuid, set_code text, collector_number text, printing text, condition text, language text, source text, match_rank integer)
language sql
security definer
set search_path to 'public'
as $function$
with raw as (
  select trim(regexp_replace(trim(coalesce(p_query,'')), '\s+cards?\s*$', '', 'i')) as value
), command_prefix as (
  select trim(regexp_replace(value, '^/ask\s+question\s*:\s*', '', 'i')) as value
  from raw
), conversational as (
  select trim(regexp_replace(value, '^(please\s+)?(show|give|find|get|open)\s+(me\s+)?', '', 'i')) as value
  from command_prefix
), parsed as (
  select value,
         (regexp_match(value, '\s+([A-Za-z0-9]{2,8})\s*#?\s*([A-Za-z0-9-]+)\s*$'))[1] as maybe_set,
         (regexp_match(value, '\s+([A-Za-z0-9]{2,8})\s*#?\s*([A-Za-z0-9-]+)\s*$'))[2] as maybe_collector
  from conversational
), scoped as (
  select p.*,
         exists(
           select 1 from public.scout_card_catalog c
           where upper(coalesce(c.set_code,''))=upper(coalesce(p.maybe_set,''))
             and lower(coalesce(c.collector_number,''))=lower(coalesce(p.maybe_collector,''))
           union all
           select 1 from public.marketplace_scan_rows m
           where upper(coalesce(m.set_code,''))=upper(coalesce(p.maybe_set,''))
             and lower(coalesce(m.collector_number,''))=lower(coalesce(p.maybe_collector,''))
           limit 1
         ) as valid_scope
  from parsed p
), q as (
  select trim(case when valid_scope
                   then regexp_replace(value, '\s+[A-Za-z0-9]{2,8}\s*#?\s*[A-Za-z0-9-]+\s*$', '', 'i')
                   else value end) as needle,
         case when valid_scope then maybe_set end as set_code,
         case when valid_scope then maybe_collector end as collector_number
  from scoped
), rows as (
  select c.card_name,c.product_id,c.sku_id,c.scryfall_id,c.set_code,c.collector_number,c.printing,c.condition,c.language,
         'scout_card_catalog'::text as source,
         case when lower(c.card_name)=lower(q.needle) then 0
              when lower(split_part(c.card_name,' // ',1))=lower(q.needle) then 1
              when c.card_name ilike q.needle || '%' then 2 else 3 end as match_rank
  from public.scout_card_catalog c cross join q
  where q.needle<>'' and c.card_name ilike '%' || q.needle || '%'
    and (q.set_code is null or upper(coalesce(c.set_code,''))=upper(q.set_code))
    and (q.collector_number is null or lower(coalesce(c.collector_number,''))=lower(q.collector_number))
  union all
  select m.product_name,m.product_id,m.sku_id,m.scryfall_id,m.set_code,m.collector_number,m.printing,m.condition,m.language,
         'marketplace_scan_rows'::text as source,
         case when lower(m.product_name)=lower(q.needle) then 0
              when m.product_name ilike q.needle || '%' then 2 else 3 end as match_rank
  from public.marketplace_scan_rows m cross join q
  where q.needle<>'' and m.product_name ilike '%' || q.needle || '%'
    and (q.set_code is null or upper(coalesce(m.set_code,''))=upper(q.set_code))
    and (q.collector_number is null or lower(coalesce(m.collector_number,''))=lower(q.collector_number))
), dedup as (
  select distinct on (product_id,sku_id,coalesce(scryfall_id::text,'')) *
  from rows
  order by product_id,sku_id,coalesce(scryfall_id::text,''),match_rank,source
)
select card_name,product_id,sku_id,scryfall_id,set_code,collector_number,printing,condition,language,source,match_rank
from dedup
order by match_rank,
         case when upper(coalesce(condition,''))='NEAR MINT' then 0 else 1 end,
         case when upper(coalesce(language,''))='ENGLISH' then 0 else 1 end,
         case when upper(coalesce(printing,'')) in ('NON FOIL','NORMAL') then 0 else 1 end,
         card_name,set_code,collector_number,printing,sku_id
limit greatest(1,least(coalesce(p_limit,20),50));
$function$;