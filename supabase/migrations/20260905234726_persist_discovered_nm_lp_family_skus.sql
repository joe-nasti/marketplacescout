create or replace function public.ask_collectish_supply_family_skus_v1(
  p_card_name text default null,
  p_scryfall_id text default null
) returns table(
  product_id text, sku_id text, card_name text, set_code text, collector_number text,
  printing text, condition text, language text, scryfall_id uuid, oracle_id uuid
)
language sql stable security definer set search_path=public
as $$
with seed as (
  select c.scryfall_oracle_id
  from public.mtgjson_cards c
  where c.scryfall_oracle_id is not null and (
    (nullif(trim(p_scryfall_id),'') is not null and c.scryfall_id::text=trim(p_scryfall_id)) or
    (nullif(trim(p_scryfall_id),'') is null and nullif(trim(p_card_name),'') is not null and lower(c.name)=lower(trim(p_card_name)))
  )
  order by case when c.scryfall_id::text=trim(coalesce(p_scryfall_id,'')) then 0 else 1 end
  limit 1
), cards as (
  select c.*
  from public.mtgjson_cards c
  join seed s on s.scryfall_oracle_id=c.scryfall_oracle_id
  where upper(coalesce(c.language,''))='ENGLISH'
    and c.availability::text ilike '%paper%'
    and lower(coalesce(c.type_line,'')) not like '%token%'
), rows as (
  select s.product_id::text,s.sku_id::text,c.name card_name,c.set_code,c.collector_number,
    upper(coalesce(nullif(s.printing,''),nullif(s.finish,''),'UNKNOWN')) printing,
    upper(coalesce(s.condition,'')) condition,c.scryfall_id,c.scryfall_oracle_id oracle_id,0 source_rank
  from cards c
  join public.mtgjson_tcgplayer_skus s on s.uuid=c.uuid
  where s.product_id ~ '^\d+$' and s.sku_id ~ '^\d+$'
    and upper(coalesce(s.language,'ENGLISH'))='ENGLISH'
    and upper(coalesce(s.condition,'')) in ('NEAR MINT','LIGHTLY PLAYED','NM','LP')
  union all
  select d.product_id,d.sku_id,c.name,c.set_code,c.collector_number,
    upper(coalesce(nullif(d.printing,''),nullif(d.variant,''),'UNKNOWN')),
    upper(coalesce(d.condition,'')),c.scryfall_id,c.scryfall_oracle_id,1
  from cards c
  join public.scout_tcgplayer_sku_discovery_cache d
    on d.mtgjson_uuid=c.uuid
    or (d.mtgjson_uuid is null and d.scryfall_id=c.scryfall_id)
  where d.product_id ~ '^\d+$' and d.sku_id ~ '^\d+$'
    and d.source <> 'discovery_negative'
    and upper(coalesce(d.language,'ENGLISH'))='ENGLISH'
    and upper(coalesce(d.condition,'')) in ('NEAR MINT','LIGHTLY PLAYED','NM','LP')
)
select distinct on (sku_id) product_id,sku_id,card_name,set_code,collector_number,printing,
  case when condition='NM' then 'NEAR MINT' when condition='LP' then 'LIGHTLY PLAYED' else condition end,
  'ENGLISH'::text,scryfall_id,oracle_id
from rows
order by sku_id,source_rank,product_id,printing;
$$;

revoke all on function public.ask_collectish_supply_family_skus_v1(text,text) from public,anon;
grant execute on function public.ask_collectish_supply_family_skus_v1(text,text) to authenticated,service_role;
comment on function public.ask_collectish_supply_family_skus_v1(text,text) is
  'Canonical English paper NM/LP Oracle-family TCGplayer SKU resolver backed by MTGJSON plus verified discovered SKU identities.';
notify pgrst,'reload schema';
