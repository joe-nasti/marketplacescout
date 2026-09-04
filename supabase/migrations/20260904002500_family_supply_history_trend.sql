-- Observation-driven family supply history. No missing-day interpolation or carry-forward.
create or replace function public.ask_collectish_family_supply_trend_v1(
  p_sku_ids text[],
  p_days integer default 90
) returns jsonb
language sql
stable
security definer
set search_path=public
as $$
with params as (
  select greatest(1,least(coalesce(p_days,90),730))::int as days
), requested as (
  select distinct x as sku_id from unnest(coalesce(p_sku_ids,array[]::text[])) x where coalesce(x,'')<>''
), target as (select count(*)::int as sku_count from requested),
daily_sku as (
  select distinct on (s.sku_id,(s.observed_at at time zone 'UTC')::date)
    s.sku_id,s.product_id,(s.observed_at at time zone 'UTC')::date as observed_date,
    s.observed_at,s.unit_count,s.listing_count,s.direct_unit_count,s.non_direct_unit_count,
    s.coverage_state,s.metadata,
    case when upper(coalesce(s.metadata->>'printing','')) like '%FOIL%'
              and upper(coalesce(s.metadata->>'printing','')) not like '%NON FOIL%'
      then 'FOIL' else 'NON FOIL' end as finish_scope
  from public.market_supply_snapshots s
  join requested r on r.sku_id=s.sku_id cross join params p
  where s.source='tcgplayer_marketplace' and s.observed_at>=now()-(p.days||' days')::interval
  order by s.sku_id,(s.observed_at at time zone 'UTC')::date,s.observed_at desc,s.snapshot_id desc
), family_days as (
  select d.observed_date,count(*)::int observed_skus,
    count(*) filter(where d.coverage_state='COMPLETE')::int complete_skus,
    sum(coalesce(d.unit_count,0))::int unit_count,sum(coalesce(d.listing_count,0))::int listing_count,
    sum(coalesce(d.direct_unit_count,0))::int direct_unit_count,sum(coalesce(d.non_direct_unit_count,0))::int non_direct_unit_count,
    min(d.observed_at) oldest_snapshot_at,max(d.observed_at) newest_snapshot_at
  from daily_sku d group by d.observed_date
  having count(*)=(select sku_count from target)
     and count(*) filter(where d.coverage_state='COMPLETE')=(select sku_count from target)
), numbered as (
  select f.*,row_number() over(order by observed_date) first_rank,row_number() over(order by observed_date desc) last_rank from family_days f
), endpoints as (
  select max(observed_date) filter(where first_rank=1) first_date,max(observed_date) filter(where last_rank=1) last_date,
    max(unit_count) filter(where first_rank=1) first_units,max(unit_count) filter(where last_rank=1) last_units,
    max(listing_count) filter(where first_rank=1) first_listings,max(listing_count) filter(where last_rank=1) last_listings,
    max(direct_unit_count) filter(where first_rank=1) first_direct_units,max(direct_unit_count) filter(where last_rank=1) last_direct_units,
    max(non_direct_unit_count) filter(where first_rank=1) first_non_direct_units,max(non_direct_unit_count) filter(where last_rank=1) last_non_direct_units,
    count(*)::int complete_points from numbered
), family_changes as (
  select e.*,coalesce(last_units,0)-coalesce(first_units,0) unit_change,
    case when coalesce(first_units,0)>0 then round(100.0*(last_units-first_units)/first_units,1) end unit_change_pct,
    coalesce(last_listings,0)-coalesce(first_listings,0) listing_change,
    case when coalesce(first_listings,0)>0 then round(100.0*(last_listings-first_listings)/first_listings,1) end listing_change_pct,
    coalesce(last_direct_units,0)-coalesce(first_direct_units,0) direct_unit_change,
    case when coalesce(first_direct_units,0)>0 then round(100.0*(last_direct_units-first_direct_units)/first_direct_units,1) end direct_unit_change_pct,
    case when first_date is not null and last_date is not null then last_date-first_date end observed_span_days
  from endpoints e
), printing_days as (
  select d.observed_date,d.product_id,d.finish_scope,min(coalesce(d.metadata->>'card_name','')) card_name,
    min(coalesce(d.metadata->>'set_code','')) set_code,min(coalesce(d.metadata->>'collector_number','')) collector_number,
    sum(coalesce(d.unit_count,0))::int unit_count,sum(coalesce(d.listing_count,0))::int listing_count,
    sum(coalesce(d.direct_unit_count,0))::int direct_unit_count
  from daily_sku d join family_days f using(observed_date)
  group by d.observed_date,d.product_id,d.finish_scope
), printing_numbered as (
  select p.*,row_number() over(partition by product_id,finish_scope order by observed_date) first_rank,
    row_number() over(partition by product_id,finish_scope order by observed_date desc) last_rank
  from printing_days p
), printing_endpoints as (
  select product_id,finish_scope,min(card_name) card_name,min(set_code) set_code,min(collector_number) collector_number,
    max(observed_date) filter(where first_rank=1) first_date,max(observed_date) filter(where last_rank=1) last_date,
    max(unit_count) filter(where first_rank=1) first_units,max(unit_count) filter(where last_rank=1) last_units,
    max(listing_count) filter(where first_rank=1) first_listings,max(listing_count) filter(where last_rank=1) last_listings,
    max(direct_unit_count) filter(where first_rank=1) first_direct_units,max(direct_unit_count) filter(where last_rank=1) last_direct_units,
    count(*)::int observation_points
  from printing_numbered group by product_id,finish_scope
), printing_changes as (
  select p.*,coalesce(last_units,0)-coalesce(first_units,0) unit_change,
    case when coalesce(first_units,0)>0 then round(100.0*(last_units-first_units)/first_units,1) end unit_change_pct,
    case when first_units is null or last_units is null or observation_points<2 then 'UNPROVEN'
      when first_units>0 and 100.0*(last_units-first_units)/first_units<=-30 then 'TIGHTENING_FAST'
      when first_units>0 and 100.0*(last_units-first_units)/first_units<=-10 then 'TIGHTENING'
      when first_units>0 and 100.0*(last_units-first_units)/first_units>=30 then 'LOOSENING_FAST'
      when first_units>0 and 100.0*(last_units-first_units)/first_units>=10 then 'LOOSENING'
      else 'STABLE' end trend
  from printing_endpoints p
), daily_json as (
  select coalesce(jsonb_agg(jsonb_build_object('date',observed_date,'unit_count',unit_count,'listing_count',listing_count,
    'direct_unit_count',direct_unit_count,'non_direct_unit_count',non_direct_unit_count,
    'oldest_snapshot_at',oldest_snapshot_at,'newest_snapshot_at',newest_snapshot_at) order by observed_date),'[]'::jsonb) rows
  from family_days
), print_json as (
  select coalesce(jsonb_agg(jsonb_build_object('product_id',product_id,'finish',finish_scope,'card_name',nullif(card_name,''),
    'set_code',nullif(set_code,''),'collector_number',nullif(collector_number,''),'first_date',first_date,'last_date',last_date,
    'first_units',first_units,'last_units',last_units,'unit_change',unit_change,'unit_change_pct',unit_change_pct,
    'first_listings',first_listings,'last_listings',last_listings,'first_direct_units',first_direct_units,
    'last_direct_units',last_direct_units,'observation_points',observation_points,'trend',trend)
    order by unit_change_pct nulls last,product_id,finish_scope),'[]'::jsonb) rows from printing_changes
)
select case
 when auth.uid() is null then jsonb_build_object('available',false,'error','authentication required')
 when (select sku_count from target)=0 then jsonb_build_object('available',false,'error','sku ids required')
 else jsonb_build_object(
  'available',(select complete_points>0 from family_changes),'scope','CARD_FAMILY_NM_LP_OBSERVED_HISTORY',
  'requested_days',(select days from params),'target_sku_count',(select sku_count from target),
  'complete_observation_points',(select complete_points from family_changes),
  'coverage_state',case when (select complete_points from family_changes)>=2 then 'MULTI_POINT_COMPLETE'
    when (select complete_points from family_changes)=1 then 'SINGLE_COMPLETE_POINT' else 'NO_COMPLETE_POINT' end,
  'first_date',(select first_date from family_changes),'last_date',(select last_date from family_changes),
  'observed_span_days',(select observed_span_days from family_changes),'first_units',(select first_units from family_changes),
  'last_units',(select last_units from family_changes),'unit_change',(select unit_change from family_changes),
  'unit_change_pct',(select unit_change_pct from family_changes),'listing_change',(select listing_change from family_changes),
  'listing_change_pct',(select listing_change_pct from family_changes),'direct_unit_change',(select direct_unit_change from family_changes),
  'direct_unit_change_pct',(select direct_unit_change_pct from family_changes),
  'trend',case when (select complete_points from family_changes)<2 then 'UNPROVEN'
    when (select first_units from family_changes)>0 and 100.0*((select last_units from family_changes)-(select first_units from family_changes))/(select first_units from family_changes)<=-30 then 'TIGHTENING_FAST'
    when (select first_units from family_changes)>0 and 100.0*((select last_units from family_changes)-(select first_units from family_changes))/(select first_units from family_changes)<=-10 then 'TIGHTENING'
    when (select first_units from family_changes)>0 and 100.0*((select last_units from family_changes)-(select first_units from family_changes))/(select first_units from family_changes)>=30 then 'LOOSENING_FAST'
    when (select first_units from family_changes)>0 and 100.0*((select last_units from family_changes)-(select first_units from family_changes))/(select first_units from family_changes)>=10 then 'LOOSENING'
    else 'STABLE' end,
  'daily_points',(select rows from daily_json),'printing_changes',(select rows from print_json),
  'note','Observed history uses only UTC dates on which every requested exact NM/LP SKU has a COMPLETE TCGplayer snapshot. Missing days are not filled or carried forward. Trend therefore describes measured changes between complete family observations, not continuous market inventory.'
 ) end
$$;
revoke all on function public.ask_collectish_family_supply_trend_v1(text[],integer) from public,anon;
grant execute on function public.ask_collectish_family_supply_trend_v1(text[],integer) to authenticated,service_role;
notify pgrst,'reload schema';
