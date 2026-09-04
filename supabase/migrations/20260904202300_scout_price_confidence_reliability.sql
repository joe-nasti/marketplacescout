create or replace function public.ask_collectish_price_confidence_reliability_v1(p_days integer default 30)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
with params as (
  select greatest(1,least(coalesce(p_days,30),365))::int d
), base as (
  select h.*
  from public.scout_price_confidence_history h,params p
  where auth.uid() is not null and h.user_id=auth.uid()
    and h.evaluated_at>=now()-make_interval(days=>p.d)
), outcomes as (
  select b.*,
    p6.observed_at price_6h_at,p6.market_price market_6h,p6.direct_low_price direct_6h,p6.low_price low_6h,
    s6.observed_at supply_6h_at,s6.coverage_state supply_6h_coverage,s6.unit_count units_6h,s6.listing_count listings_6h,s6.seller_count sellers_6h,
    case when (b.price->>'market')::numeric>0 and p6.market_price>0 then round(100*(p6.market_price/(b.price->>'market')::numeric-1),1) end market_change_6h_pct,
    case when p6.market_price>0 and p6.direct_low_price>0 then round(100*abs(p6.direct_low_price-p6.market_price)/p6.market_price,1) end direct_market_gap_6h_pct,
    case when p6.market_price>0 and p6.low_price>0 then round(100*abs(p6.low_price-p6.market_price)/p6.market_price,1) end low_market_gap_6h_pct
  from base b
  left join lateral (
    select p.* from public.tcgplayer_official_sku_price_history p
    where p.sku_id=b.sku_id and p.observed_at>=b.evaluated_at+interval '5 hours' and p.observed_at<b.evaluated_at+interval '8 hours'
    order by abs(extract(epoch from(p.observed_at-(b.evaluated_at+interval '6 hours')))) limit 1
  ) p6 on true
  left join lateral (
    select s.* from public.market_supply_snapshots s
    where s.source='tcgplayer_marketplace' and s.sku_id=b.sku_id and s.observed_at>=b.evaluated_at+interval '5 hours' and s.observed_at<b.evaluated_at+interval '8 hours'
    order by abs(extract(epoch from(s.observed_at-(b.evaluated_at+interval '6 hours')))) limit 1
  ) s6 on true
), scored as (
  select o.*,
    case when evaluated_at>now()-interval '8 hours' then null
         when price_6h_at is null then null
         when (coalesce(direct_market_gap_6h_pct,999)<=20 or coalesce(low_market_gap_6h_pct,999)<=20)
              and (supply_6h_at is null or (supply_6h_coverage='COMPLETE' and coalesce(units_6h,0)>=5 and coalesce(listings_6h,0)>=3 and coalesce(sellers_6h,0)>=3))
           then true else false end supported_6h
  from outcomes o
), agg as (
  select microstructure,confidence_label,count(*) total,
    count(*) filter(where evaluated_at<=now()-interval '8 hours') mature_6h,
    count(*) filter(where supported_6h is not null) scored_6h,
    count(*) filter(where supported_6h) supported_6h,
    avg(abs(market_change_6h_pct)) filter(where market_change_6h_pct is not null) avg_abs_market_move_6h_pct,
    avg(direct_market_gap_6h_pct) filter(where direct_market_gap_6h_pct is not null) avg_direct_market_gap_6h_pct,
    avg(units_6h) filter(where units_6h is not null) avg_units_6h,
    avg(listings_6h) filter(where listings_6h is not null) avg_listings_6h
  from scored group by microstructure,confidence_label
), packed as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'microstructure',microstructure,'confidence_label',confidence_label,'total',total,'mature_6h',mature_6h,'scored_6h',scored_6h,
    'supported_6h',supported_6h,'supported_6h_pct',case when scored_6h>0 then round(100.0*supported_6h/scored_6h,1) end,
    'avg_abs_market_move_6h_pct',round(avg_abs_market_move_6h_pct::numeric,1),
    'avg_direct_market_gap_6h_pct',round(avg_direct_market_gap_6h_pct::numeric,1),
    'avg_units_6h',round(avg_units_6h::numeric,1),'avg_listings_6h',round(avg_listings_6h::numeric,1),
    'claimable',scored_6h>=20
  ) order by case microstructure when 'ROBUST' then 1 when 'MIXED' then 2 else 3 end),'[]'::jsonb) cohorts from agg
), coverage as (
  select count(*) total_snapshots,
    count(*) filter(where coalesce((coverage->>'market_depth_observed')::boolean,false)) with_entry_depth,
    count(*) filter(where evaluated_at<=now()-interval '8 hours') mature_6h,
    count(distinct microstructure) filter(where evaluated_at<=now()-interval '8 hours') mature_microstructure_classes
  from base
)
select jsonb_build_object(
  'available',true,'version','price_confidence_reliability_v1','days',(select d from params),
  'coverage',jsonb_build_object('snapshots',c.total_snapshots,'with_entry_market_depth',c.with_entry_depth,'entry_depth_coverage_pct',case when c.total_snapshots>0 then round(100.0*c.with_entry_depth/c.total_snapshots,1) end,'mature_6h',c.mature_6h,'mature_microstructure_classes',c.mature_microstructure_classes),
  'readiness',case when c.mature_microstructure_classes>=3 and c.mature_6h>=60 then 'INITIAL_COMPARATIVE_CALIBRATION' when c.mature_6h>=20 then 'SINGLE_COHORT_EARLY' else 'INSUFFICIENT_SAMPLE' end,
  'cohorts',p.cohorts,
  'interpretation','A 6h snapshot is supported when official Market remains corroborated by Direct or TCG Low within 20%, and any available exact-SKU market-depth observation remains complete with at least 5 units, 3 listings, and 3 sellers. This measures forward reference integrity/executability, not price direction or realized return. Cohorts are not compared until multiple microstructure classes have adequate mature samples.',
  'historical_limit','Older reconstructed episodes frequently lack entry-time market-depth evidence because that collector did not yet exist. Missing entry depth lowers historical confidence and is never filled with later observations.',
  'generated_at',now()
) from coverage c cross join packed p;
$$;
revoke all on function public.ask_collectish_price_confidence_reliability_v1(integer) from public,anon;
grant execute on function public.ask_collectish_price_confidence_reliability_v1(integer) to authenticated,service_role;

create or replace function public.ask_collectish_price_confidence_history_v1(p_sku_id text,p_days integer default 30)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
with p as (select greatest(1,least(coalesce(p_days,30),365))::int d), rows as (
  select h.* from public.scout_price_confidence_history h,p
  where auth.uid() is not null and h.user_id=auth.uid() and h.sku_id=p_sku_id and h.evaluated_at>=now()-make_interval(days=>p.d)
  order by h.evaluated_at desc,h.id desc limit 100
)
select jsonb_build_object('available',true,'sku_id',p_sku_id,'days',(select d from p),'events',coalesce(jsonb_agg(jsonb_build_object(
  'evaluated_at',evaluated_at,'capture_kind',capture_kind,'confidence_score',confidence_score,'confidence_label',confidence_label,'microstructure',microstructure,
  'components',components,'fragility_flags',to_jsonb(fragility_flags),'coverage',coverage,'price',price,'depth',depth,'sales',sales,'stability',stability
) order by evaluated_at desc),'[]'::jsonb),'generated_at',now()) from rows;
$$;
revoke all on function public.ask_collectish_price_confidence_history_v1(text,integer) from public,anon;
grant execute on function public.ask_collectish_price_confidence_history_v1(text,integer) to authenticated,service_role;
