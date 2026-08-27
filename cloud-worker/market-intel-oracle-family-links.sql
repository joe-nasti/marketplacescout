-- Expand market-intelligence card entities across all printings/reskins that share
-- the same Scryfall Oracle identity. This lets a Signal about the canonical card
-- attach to renamed Secret Lair / Universes Beyond products without treating the
-- exact SKU as having identical execution characteristics.

create index if not exists mtgjson_cards_oracle_product_idx
  on public.mtgjson_cards(scryfall_oracle_id, tcgplayer_product_id)
  where scryfall_oracle_id is not null and tcgplayer_product_id is not null;

create or replace view public.market_intel_scout_signal_links
with (security_invoker=true)
as
with entity_identity as (
  select e.intel_id,e.user_id,e.entity_name,e.scryfall_id source_scryfall_id,e.product_id source_product_id,
         coalesce(sf.oracle_id,pid.oracle_id,nm.oracle_id) oracle_id,
         coalesce(sf.canonical_name,pid.canonical_name,nm.canonical_name,e.entity_name) canonical_name
  from public.market_intel_entities e
  left join lateral (
    select c.scryfall_oracle_id oracle_id,c.name canonical_name
    from public.mtgjson_cards c
    where e.scryfall_id is not null and c.scryfall_id=e.scryfall_id and c.scryfall_oracle_id is not null
    limit 1
  ) sf on true
  left join lateral (
    select c.scryfall_oracle_id oracle_id,c.name canonical_name
    from public.mtgjson_cards c
    where sf.oracle_id is null and e.product_id is not null and c.tcgplayer_product_id=e.product_id and c.scryfall_oracle_id is not null
    limit 1
  ) pid on true
  left join lateral (
    select (array_agg(distinct c.scryfall_oracle_id))[1] oracle_id,max(c.name) canonical_name
    from public.mtgjson_cards c
    where sf.oracle_id is null and pid.oracle_id is null
      and lower(c.name)=lower(e.entity_name) and c.scryfall_oracle_id is not null
    having count(distinct c.scryfall_oracle_id)=1
  ) nm on true
  where e.entity_type='card'
)
select distinct
  ei.intel_id,ei.user_id,ei.entity_name,ei.canonical_name,ei.oracle_id,
  ei.source_scryfall_id,ei.source_product_id,
  coalesce(f.scryfall_id,ei.source_scryfall_id) matched_scryfall_id,
  coalesce(f.tcgplayer_product_id,ei.source_product_id) product_id,
  coalesce(f.name,ei.canonical_name) matched_card_name,
  (ei.oracle_id is not null and f.tcgplayer_product_id is distinct from ei.source_product_id) as family_match
from entity_identity ei
left join public.mtgjson_cards f
  on ei.oracle_id is not null
 and f.scryfall_oracle_id=ei.oracle_id
 and f.tcgplayer_product_id is not null;

grant select on public.market_intel_scout_signal_links to authenticated;
