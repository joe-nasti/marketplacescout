-- Printing-level opportunity signal: compare observed scarcity with price premium
-- without inventing pull odds. Exact pull odds remain unresolved unless a sourced
-- booster/collation model is available separately.
create or replace function public.ask_collectish_family_printing_opportunity_v1(p_sku_ids text[])
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
with requested as (
  select distinct x as sku_id
  from unnest(coalesce(p_sku_ids,array[]::text[])) x
  where coalesce(x,'')<>''
), targets as (
  select distinct
    s.sku_id::text,
    s.product_id::text,
    c.uuid,
    c.name as card_name,
    c.set_code,
    c.collector_number,
    lower(coalesce(c.rarity,'unknown')) as rarity,
    upper(coalesce(s.condition,'')) as condition,
    case
      when upper(coalesce(s.printing,s.finish,'')) like '%FOIL%'
       and upper(coalesce(s.printing,s.finish,'')) not like '%NON%FOIL%'
      then 'FOIL' else 'NON FOIL'
    end as finish_scope
  from requested r
  join public.mtgjson_tcgplayer_skus s on s.sku_id=r.sku_id
  join public.mtgjson_cards c on c.uuid=s.uuid
), priced as (
  select t.*,
    p.market_price,
    p.observed_at as price_observed_at,
    m.unit_count,
    m.listing_count,
    m.coverage_state,
    m.observed_at as supply_observed_at
  from targets t
  left join public.tcgplayer_official_sku_price_current p on p.sku_id=t.sku_id
  left join public.market_supply_current m
    on m.source='tcgplayer_marketplace' and m.sku_id=t.sku_id
), grouped as (
  select
    product_id,
    finish_scope,
    min(card_name) as card_name,
    min(set_code) as set_code,
    min(collector_number) as collector_number,
    min(rarity) as rarity,
    count(*)::int as sku_count,
    count(*) filter(where condition in ('NEAR MINT','NM'))::int as nm_sku_count,
    count(*) filter(where condition in ('LIGHTLY PLAYED','LP'))::int as lp_sku_count,
    coalesce(sum(unit_count),0)::int as unit_count,
    coalesce(sum(listing_count),0)::int as listing_count,
    bool_and(coalesce(coverage_state,'MISSING')='COMPLETE') as supply_complete,
    coalesce(
      max(market_price) filter(where condition in ('NEAR MINT','NM') and market_price>0),
      max(market_price) filter(where market_price>0)
    ) as market_price,
    max(price_observed_at) as price_observed_at,
    max(supply_observed_at) as supply_observed_at
  from priced
  group by product_id,finish_scope
), enriched as (
  select g.*,
    coalesce((select count(*) from public.mtgjson_set_booster_configs b where upper(b.set_code)=upper(g.set_code)),0)::int as booster_config_count,
    case
      when exists(select 1 from public.mtgjson_set_booster_configs b where upper(b.set_code)=upper(g.set_code))
      then 'BOOSTER_CONFIG_AVAILABLE_EXACT_VARIANT_ODDS_UNRESOLVED'
      else 'NO_SOURCED_VARIANT_PULL_ODDS'
    end as pull_odds_status
  from grouped g
), base_ranked as (
  select e.*,
    row_number() over(
      partition by set_code
      order by case when finish_scope='NON FOIL' then 0 else 1 end,
               unit_count desc,
               case when collector_number ~ '^[0-9]+$' then collector_number::int else 2147483647 end,
               product_id
    ) as baseline_rank
  from enriched e
), baselines as (
  select set_code,
         product_id as baseline_product_id,
         finish_scope as baseline_finish,
         collector_number as baseline_collector_number,
         unit_count as baseline_units,
         market_price as baseline_market_price
  from base_ranked
  where baseline_rank=1
), scored as (
  select e.*,
    b.baseline_product_id,
    b.baseline_finish,
    b.baseline_collector_number,
    b.baseline_units,
    b.baseline_market_price,
    case when e.unit_count>0 and b.baseline_units>0
      then round(b.baseline_units::numeric/e.unit_count,2) end as scarcity_multiple_vs_base,
    case when e.market_price>0 and b.baseline_market_price>0
      then round(e.market_price/b.baseline_market_price,2) end as price_premium_vs_base,
    case when e.unit_count>0 and b.baseline_units>0 and e.market_price>0 and b.baseline_market_price>0
      then round((b.baseline_units::numeric/e.unit_count)/(e.market_price/b.baseline_market_price),2) end as scarcity_price_gap,
    (e.product_id=b.baseline_product_id and e.finish_scope=b.baseline_finish) as is_baseline
  from enriched e
  join baselines b using(set_code)
), classified as (
  select s.*,
    case
      when is_baseline then 'BASELINE'
      when market_price is null or baseline_market_price is null or unit_count<=0 or baseline_units<=0 then 'UNPROVEN'
      when price_premium_vs_base>=10 then 'SCARCE_ALREADY_PRICED'
      when scarcity_price_gap>=3 and scarcity_multiple_vs_base>=3 and unit_count<=250 then 'WORTH_INVESTIGATING'
      when scarcity_price_gap>=1.5 and scarcity_multiple_vs_base>=2 then 'WATCH'
      else 'FAIRLY_PRICED'
    end as opportunity_classification,
    case
      when not supply_complete then 'LOW'
      when market_price is null or baseline_market_price is null then 'LOW'
      else 'MEDIUM'
    end as opportunity_confidence,
    case
      when is_baseline then 'Deepest nonfoil/set baseline for relative comparison.'
      when market_price is null or baseline_market_price is null then 'Price evidence is incomplete.'
      when price_premium_vs_base>=10 then 'Supply is scarce, but the market already charges a large premium versus the base printing.'
      when scarcity_price_gap>=3 and scarcity_multiple_vs_base>=3 and unit_count<=250 then 'Observed supply is much thinner than the current price premium would imply; worth investigating before buying.'
      when scarcity_price_gap>=1.5 and scarcity_multiple_vs_base>=2 then 'Observed scarcity is somewhat stronger than the current price premium; watch for demand confirmation.'
      else 'Current price premium broadly tracks observed scarcity versus the base printing.'
    end as rationale
  from scored s
), rows as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id',product_id,
    'finish',finish_scope,
    'card_name',card_name,
    'set_code',set_code,
    'collector_number',collector_number,
    'rarity',rarity,
    'sku_count',sku_count,
    'nm_sku_count',nm_sku_count,
    'lp_sku_count',lp_sku_count,
    'unit_count',unit_count,
    'listing_count',listing_count,
    'market_price',market_price,
    'supply_complete',supply_complete,
    'booster_config_count',booster_config_count,
    'pull_odds_status',pull_odds_status,
    'baseline_product_id',baseline_product_id,
    'baseline_finish',baseline_finish,
    'baseline_collector_number',baseline_collector_number,
    'baseline_units',baseline_units,
    'baseline_market_price',baseline_market_price,
    'scarcity_multiple_vs_base',scarcity_multiple_vs_base,
    'price_premium_vs_base',price_premium_vs_base,
    'scarcity_price_gap',scarcity_price_gap,
    'opportunity_classification',opportunity_classification,
    'opportunity_confidence',opportunity_confidence,
    'rationale',rationale,
    'price_observed_at',price_observed_at,
    'supply_observed_at',supply_observed_at
  ) order by
    case opportunity_classification when 'WORTH_INVESTIGATING' then 1 when 'WATCH' then 2 when 'FAIRLY_PRICED' then 3 when 'SCARCE_ALREADY_PRICED' then 4 when 'BASELINE' then 5 else 6 end,
    scarcity_price_gap desc nulls last,
    unit_count asc),'[]'::jsonb) as data
  from classified
)
select case
  when auth.uid() is null and coalesce(auth.role(),'')<>'service_role' then jsonb_build_object('available',false,'error','authentication required')
  when coalesce(array_length(p_sku_ids,1),0)=0 then jsonb_build_object('available',false,'error','sku ids required')
  else jsonb_build_object(
    'available',exists(select 1 from classified),
    'scope','CARD_FAMILY_NM_LP_PRINTING_OPPORTUNITY',
    'model_version','printing-opportunity-v1',
    'rows',(select data from rows),
    'note','Opportunity compares observed NM/LP market scarcity with NM market-price premium versus the deepest nonfoil printing in the same set. Card rarity is factual metadata only and is not converted into invented pull odds. WORTH_INVESTIGATING is a research flag, not a buy recommendation. Exact packs-per-hit remains unavailable unless a sourced variant-level collation model is present.'
  )
end
$$;
revoke all on function public.ask_collectish_family_printing_opportunity_v1(text[]) from public,anon;
grant execute on function public.ask_collectish_family_printing_opportunity_v1(text[]) to authenticated,service_role;
notify pgrst,'reload schema';
