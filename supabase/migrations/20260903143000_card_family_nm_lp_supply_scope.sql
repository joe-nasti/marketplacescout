-- Resolve a named card to every English paper TCGplayer product that shares its
-- Oracle identity. The Edge Function then discovers only NM/LP SKUs for these
-- products and fetches each product's live listings once.
create or replace function public.ask_collectish_supply_family_products_v1(
  p_scryfall_id text default null,
  p_card_name text default null
) returns table(
  product_id text,
  card_name text,
  set_code text,
  collector_number text,
  scryfall_id uuid,
  oracle_id uuid,
  product_kind text
)
language sql
stable
security definer
set search_path=public
as $$
  with seed as (
    select c.scryfall_oracle_id
    from public.mtgjson_cards c
    where c.scryfall_oracle_id is not null
      and (
        (nullif(trim(p_scryfall_id),'') is not null and c.scryfall_id::text=trim(p_scryfall_id))
        or (nullif(trim(p_scryfall_id),'') is null and nullif(trim(p_card_name),'') is not null and lower(c.name)=lower(trim(p_card_name)))
      )
    order by case when c.scryfall_id::text=trim(coalesce(p_scryfall_id,'')) then 0 else 1 end
    limit 1
  ), cards as (
    select c.*
    from public.mtgjson_cards c join seed s on s.scryfall_oracle_id=c.scryfall_oracle_id
    where upper(coalesce(c.language,''))='ENGLISH'
      and c.availability::text ilike '%paper%'
      and lower(coalesce(c.type_line,'')) not like '%token%'
  ), products as (
    select c.name,c.set_code,c.collector_number,c.scryfall_id,c.scryfall_oracle_id,
           v.product_id,v.product_kind
    from cards c
    cross join lateral (values
      (c.tcgplayer_product_id,'standard'),
      (c.tcgplayer_etched_product_id,'etched'),
      (c.tcgplayer_alt_foil_product_id,'alternate_foil')
    ) v(product_id,product_kind)
    where v.product_id ~ '^\d+$'
  )
  select distinct on (p.product_id)
         p.product_id,p.name,p.set_code,p.collector_number,p.scryfall_id,p.scryfall_oracle_id,p.product_kind
  from products p
  order by p.product_id,p.set_code,p.collector_number,p.product_kind;
$$;

revoke all on function public.ask_collectish_supply_family_products_v1(text,text) from public,anon;
grant execute on function public.ask_collectish_supply_family_products_v1(text,text) to authenticated,service_role;

comment on function public.ask_collectish_supply_family_products_v1(text,text) is
  'Returns English paper TCGplayer products sharing one Oracle identity. Used for on-demand NM/LP card-family supply depth; excludes unrelated same-name cards and non-paper rows.';

notify pgrst,'reload schema';
