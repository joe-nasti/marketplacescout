-- Enrich demand-aware opportunity rows with sourced pull-rarity economics.
-- Comparisons are only among rows with explicit sourced odds in the same set.
create or replace function public.ask_collectish_family_printing_opportunity_v3(p_sku_ids text[])
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
with base as (
  select public.ask_collectish_family_printing_opportunity_v2(p_sku_ids) as payload
), opp_rows as (
  select x.value as row
  from base b cross join lateral jsonb_array_elements(coalesce(b.payload->'rows','[]'::jsonb)) x
), enriched as (
  select
    r.row,
    o.treatment_name,
    o.probability_per_pack,
    o.packs_per_hit,
    o.odds_scope,
    o.source_kind,
    o.source_url,
    o.source_title,
    o.source_published_at,
    o.confidence as pull_odds_confidence
  from opp_rows r
  left join public.printing_pull_odds_sources o
    on o.set_code=upper(r.row->>'set_code')
   and o.collector_number=r.row->>'collector_number'
   and o.finish_scope=r.row->>'finish'
   and o.language_scope='ENGLISH'
), sourced_baselines as (
  select
    row->>'set_code' set_code,
    min(packs_per_hit) baseline_packs_per_hit
  from enriched
  where packs_per_hit is not null and packs_per_hit>0
  group by row->>'set_code'
), baseline_prices as (
  select distinct on (e.row->>'set_code')
    e.row->>'set_code' set_code,
    e.packs_per_hit baseline_packs_per_hit,
    nullif(e.row->>'market_price','')::numeric baseline_market_price,
    e.row->>'collector_number' baseline_collector_number,
    e.row->>'finish' baseline_finish
  from enriched e
  join sourced_baselines b
    on b.set_code=e.row->>'set_code' and b.baseline_packs_per_hit=e.packs_per_hit
  order by e.row->>'set_code',nullif(e.row->>'market_price','')::numeric nulls last
), scored as (
  select e.*,
    bp.baseline_packs_per_hit,
    bp.baseline_market_price,
    bp.baseline_collector_number,
    bp.baseline_finish,
    case when e.packs_per_hit>0 and bp.baseline_packs_per_hit>0
      then round(e.packs_per_hit/bp.baseline_packs_per_hit,2) end as pull_rarity_multiple_vs_sourced_peer,
    case when nullif(e.row->>'market_price','')::numeric>0 and bp.baseline_market_price>0
      then round((nullif(e.row->>'market_price','')::numeric)/bp.baseline_market_price,2) end as price_multiple_vs_sourced_peer,
    case when e.packs_per_hit>0 and bp.baseline_packs_per_hit>0 and nullif(e.row->>'market_price','')::numeric>0 and bp.baseline_market_price>0
      then round((e.packs_per_hit/bp.baseline_packs_per_hit)/((nullif(e.row->>'market_price','')::numeric)/bp.baseline_market_price),2) end as pull_rarity_price_gap
  from enriched e
  left join baseline_prices bp on bp.set_code=e.row->>'set_code'
), classified as (
  select s.*,
    case
      when packs_per_hit is null then 'PULL_ODDS_UNAVAILABLE'
      when pull_rarity_multiple_vs_sourced_peer=1 then 'SOURCED_ODDS_BASELINE'
      when pull_rarity_price_gap>=1.5 and coalesce(row->>'demand_status','UNKNOWN')='CONFIRMED' then 'UNDERPRICED_FOR_PULL_RARITY_CANDIDATE'
      when pull_rarity_price_gap>=1.5 and coalesce(row->>'demand_status','UNKNOWN')<>'CONFIRMED' then 'PULL_RARITY_VALUE_SIGNAL_DEMAND_UNCONFIRMED'
      when pull_rarity_price_gap<=0.8 then 'PULL_RARITY_PREMIUM_ALREADY_PRICED'
      else 'PULL_RARITY_PRICE_ALIGNED'
    end as pull_value_status
  from scored s
), rows as (
  select coalesce(jsonb_agg(
    row || jsonb_build_object(
      'sourced_pull_odds_available',(packs_per_hit is not null),
      'treatment_name',treatment_name,
      'probability_per_pack',probability_per_pack,
      'packs_per_hit',packs_per_hit,
      'pull_odds_scope',odds_scope,
      'pull_odds_source_kind',source_kind,
      'pull_odds_source_url',source_url,
      'pull_odds_source_title',source_title,
      'pull_odds_source_published_at',source_published_at,
      'pull_odds_confidence',pull_odds_confidence,
      'sourced_peer_packs_per_hit',baseline_packs_per_hit,
      'sourced_peer_market_price',baseline_market_price,
      'sourced_peer_collector_number',baseline_collector_number,
      'sourced_peer_finish',baseline_finish,
      'pull_rarity_multiple_vs_sourced_peer',pull_rarity_multiple_vs_sourced_peer,
      'price_multiple_vs_sourced_peer',price_multiple_vs_sourced_peer,
      'pull_rarity_price_gap',pull_rarity_price_gap,
      'pull_value_status',pull_value_status
    )
    order by
      case pull_value_status
        when 'UNDERPRICED_FOR_PULL_RARITY_CANDIDATE' then 1
        when 'PULL_RARITY_VALUE_SIGNAL_DEMAND_UNCONFIRMED' then 2
        when 'SOURCED_ODDS_BASELINE' then 3
        when 'PULL_RARITY_PRICE_ALIGNED' then 4
        when 'PULL_RARITY_PREMIUM_ALREADY_PRICED' then 5
        else 6 end,
      pull_rarity_price_gap desc nulls last,
      nullif(row->>'unit_count','')::numeric asc nulls last
  ),'[]'::jsonb) data
  from classified
)
select case
  when auth.uid() is null and coalesce(auth.role(),'')<>'service_role' then jsonb_build_object('available',false,'error','authentication required')
  when coalesce(array_length(p_sku_ids,1),0)=0 then jsonb_build_object('available',false,'error','sku ids required')
  else jsonb_build_object(
    'available',true,
    'scope','CARD_FAMILY_PRINTING_OPPORTUNITY_WITH_SOURCED_PULL_ODDS',
    'model_version','printing-opportunity-v3',
    'rows',(select data from rows),
    'note','Pull-rarity value comparisons only use explicitly sourced per-printing pack odds. UNDERPRICED_FOR_PULL_RARITY_CANDIDATE additionally requires demand confirmation, but remains a research candidate rather than a buy recommendation. Missing odds or sales coverage remain unknown.'
  ) end
$$;
revoke all on function public.ask_collectish_family_printing_opportunity_v3(text[]) from public,anon;
grant execute on function public.ask_collectish_family_printing_opportunity_v3(text[]) to authenticated,service_role;
notify pgrst,'reload schema';
