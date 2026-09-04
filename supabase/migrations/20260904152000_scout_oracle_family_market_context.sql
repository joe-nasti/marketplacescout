-- Shared Oracle-family market context for Discord -> Scout drill-down and Scout family search.
create or replace function public.scout_oracle_family_market_context_v1(p_oracle_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
with allowed as (
  select coalesce(auth.role(),'') in ('authenticated','service_role') ok
), cards as (
  select c.uuid,c.scryfall_id,c.name,c.set_code,c.collector_number,c.scryfall_oracle_id
  from public.mtgjson_cards c, allowed a
  where a.ok
    and p_oracle_id is not null
    and c.scryfall_oracle_id=p_oracle_id
    and upper(coalesce(c.language,''))='ENGLISH'
    and c.availability::text ilike '%paper%'
    and lower(coalesce(c.type_line,'')) not like '%token%'
), targets as (
  select distinct on (s.sku_id)
    s.sku_id::text,
    s.product_id::text,
    c.name as card_name,
    c.set_code,
    c.collector_number,
    c.scryfall_id,
    upper(coalesce(s.condition,'')) as condition,
    upper(coalesce(s.printing,s.finish,'')) as printing,
    case when upper(coalesce(s.printing,s.finish,'')) like '%FOIL%' and upper(coalesce(s.printing,s.finish,'')) not like '%NON%FOIL%' then 'foil' else 'nonfoil' end finish_scope
  from cards c
  join public.mtgjson_tcgplayer_skus s on s.uuid=c.uuid
  where upper(coalesce(s.language,'ENGLISH'))='ENGLISH'
    and upper(coalesce(s.condition,'')) in ('NEAR MINT','LIGHTLY PLAYED','NM','LP')
    and s.sku_id ~ '^[0-9]+$'
    and s.product_id ~ '^[0-9]+$'
  order by s.sku_id
), price as (
  select t.sku_id,p.market_price,p.lowest_listing_price,p.direct_low_price,p.observed_at price_observed_at
  from targets t
  left join public.tcgplayer_official_sku_price_current p on p.sku_id=t.sku_id
), tcg as (
  select t.sku_id,m.unit_count,m.listing_count,m.direct_unit_count,m.non_direct_unit_count,m.coverage_state,m.observed_at supply_observed_at
  from targets t
  left join public.market_supply_current m on m.source='tcgplayer_marketplace' and m.sku_id=t.sku_id
), mp_ids as (
  select distinct t.sku_id,i.source_item_key
  from targets t
  join public.vendor_item_identities i on i.source='manapool' and i.tcgplayer_sku_id=t.sku_id
), mp as (
  select coalesce(sum(d.quantity),0)::bigint quantity,
         count(distinct i.sku_id)::int covered_skus,
         max(d.observed_at) observed_at
  from mp_ids i
  join public.vendor_depth_current d on d.source='manapool' and d.lane='retail_supply' and d.source_item_key=i.source_item_key
), ck_ids as (
  select distinct t.scryfall_id,t.finish_scope,i.source_item_key
  from targets t
  join public.vendor_item_identities i
    on i.source='cardkingdom'
   and i.scryfall_id=t.scryfall_id
   and (case when upper(coalesce(i.finish,'')) like '%FOIL%' and upper(coalesce(i.finish,'')) not like '%NON%FOIL%' then 'foil' else 'nonfoil' end)=t.finish_scope
   and upper(coalesce(i.language,'ENGLISH')) in ('','EN','ENGLISH')
), ck as (
  select coalesce(sum(d.quantity),0)::bigint quantity,
         count(distinct i.source_item_key)::int mapped_items,
         max(d.observed_at) observed_at
  from ck_ids i
  join public.vendor_depth_current d on d.source='cardkingdom' and d.lane='retail_supply' and d.source_item_key=i.source_item_key
  where upper(coalesce(d.condition,'')) in ('NM','EX')
    and upper(coalesce(d.language,'ENGLISH')) in ('','EN','ENGLISH')
), by_sku as (
  select jsonb_agg(jsonb_build_object(
    'sku_id',t.sku_id,
    'product_id',t.product_id,
    'set_code',t.set_code,
    'collector_number',t.collector_number,
    'printing',t.printing,
    'condition',t.condition,
    'market_price',p.market_price,
    'lowest_listing_price',p.lowest_listing_price,
    'direct_low_price',p.direct_low_price,
    'price_observed_at',p.price_observed_at,
    'unit_count',coalesce(m.unit_count,0),
    'listing_count',coalesce(m.listing_count,0),
    'direct_unit_count',coalesce(m.direct_unit_count,0),
    'non_direct_unit_count',coalesce(m.non_direct_unit_count,0),
    'coverage_state',coalesce(m.coverage_state,'MISSING'),
    'supply_observed_at',m.supply_observed_at
  ) order by t.set_code,t.collector_number,t.printing,t.condition,t.sku_id) rows
  from targets t
  left join price p on p.sku_id=t.sku_id
  left join tcg m on m.sku_id=t.sku_id
)
select jsonb_build_object(
  'available',exists(select 1 from targets),
  'oracle_id',p_oracle_id,
  'card_name',(select card_name from targets limit 1),
  'target_skus',(select count(*) from targets),
  'tcg_complete_skus',(select count(*) from tcg where coverage_state='COMPLETE'),
  'market_price_min',(select min(market_price) from price where market_price>0),
  'market_price_max',(select max(market_price) from price where market_price>0),
  'market_price_median',(select percentile_cont(0.5) within group(order by market_price) from price where market_price>0),
  'tcg_unit_count',(select coalesce(sum(unit_count),0) from tcg),
  'tcg_listing_count',(select coalesce(sum(listing_count),0) from tcg),
  'tcg_direct_unit_count',(select coalesce(sum(direct_unit_count),0) from tcg),
  'tcg_non_direct_unit_count',(select coalesce(sum(non_direct_unit_count),0) from tcg),
  'tcg_observed_at',(select max(supply_observed_at) from tcg),
  'manapool_quantity',(select quantity from mp),
  'manapool_covered_skus',(select covered_skus from mp),
  'manapool_observed_at',(select observed_at from mp),
  'cardkingdom_quantity',(select quantity from ck),
  'cardkingdom_mapped_items',(select mapped_items from ck),
  'cardkingdom_observed_at',(select observed_at from ck),
  'by_sku',coalesce((select rows from by_sku),'[]'::jsonb),
  'note','English NM/LP Oracle-family context. TCG Direct is a subset of TCGplayer. ManaPool and Card Kingdom are independent retailer observations and are not added to TCG totals.'
);
$$;

revoke all on function public.scout_oracle_family_market_context_v1(uuid) from public,anon;
grant execute on function public.scout_oracle_family_market_context_v1(uuid) to authenticated,service_role;

comment on function public.scout_oracle_family_market_context_v1(uuid) is
  'Shared printing-aware market price and supply context for Scout Oracle-family search and Delvin family-stock drill-down.';

notify pgrst,'reload schema';
