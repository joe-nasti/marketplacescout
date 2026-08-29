-- Shadow audit layer for acquisition-price freshness/actionability.
-- Does not mutate Scout's official grade.
create or replace view public.scout_price_actionability_audit
with (security_invoker = true) as
with base as (
  select s.*,
    o.low_price as official_low_price,
    o.lowest_shipping as official_lowest_shipping,
    o.lowest_listing_price as official_landed_low,
    o.market_price as official_market_price,
    o.direct_low_price as official_direct_low_price,
    o.observed_at as official_observed_at,
    m.uuid as mtgjson_uuid,
    v.observed_on as vendor_observed_on,
    v.manapool_retail,
    v.cardkingdom_buylist as vendor_ck_buylist,
    v.refreshed_at as vendor_cache_refreshed_at
  from public.scout_opportunity_context s
  left join public.tcgplayer_official_sku_price_current o on o.sku_id=s.sku_id
  left join public.mtgjson_tcgplayer_skus m on m.sku_id=s.sku_id
  left join public.scout_vendor_price_current_cache v
    on v.mtgjson_uuid=m.uuid
   and lower(v.finish)=lower(case when s.printing='Foil' then 'foil' else 'normal' end)
), hist as (
  select sku_id,
    count(*) filter (where observed_at >= now()-interval '24 hours') as snapshots_24h,
    min(lowest_listing_price) filter (where observed_at >= now()-interval '24 hours') as min_landed_24h,
    max(lowest_listing_price) filter (where observed_at >= now()-interval '24 hours') as max_landed_24h,
    percentile_cont(0.5) within group (order by lowest_listing_price)
      filter (where observed_at >= now()-interval '24 hours') as median_landed_24h
  from public.tcgplayer_official_sku_price_history
  group by sku_id
)
select b.*,h.snapshots_24h,h.min_landed_24h,h.max_landed_24h,h.median_landed_24h,
  extract(epoch from (now()-b.official_observed_at))/3600.0 as official_age_hours,
  current_date-b.vendor_observed_on as vendor_age_days,
  case when b.cheapest_source='TCG Lowest Listing' and b.official_landed_low is not null
      and abs(b.cheapest_buy-b.official_landed_low)<=0.02
      and b.official_observed_at>=now()-interval '3 hours' then true else false end as acquisition_price_current,
  case when b.cheapest_source='TCG Lowest Listing' and h.snapshots_24h>=4
      and h.min_landed_24h<h.median_landed_24h*0.75 then true else false end as recent_transient_low_detected,
  case
    when b.cheapest_source='TCG Lowest Listing' and b.official_landed_low is not null
      and abs(b.cheapest_buy-b.official_landed_low)<=0.02 and b.official_observed_at>=now()-interval '3 hours' then 'confirmed_current'
    when b.cheapest_source='TCG Lowest Listing' and b.official_observed_at<now()-interval '3 hours' then 'tcg_source_stale'
    when b.cheapest_source='TCG Lowest Listing' then 'tcg_price_mismatch'
    when b.cheapest_source='Mana Pool' and b.vendor_observed_on>=current_date then 'confirmed_current'
    when b.cheapest_source='Mana Pool' and b.vendor_observed_on=current_date-1 then 'alternate_source_1d_old'
    when b.cheapest_source='Mana Pool' and b.vendor_observed_on<current_date-1 then 'alternate_source_stale'
    else 'needs_review' end as actionability_status,
  case
    when b.promoted_grade='A' and b.cheapest_source='Mana Pool' and b.vendor_observed_on<current_date then 'B'
    when b.promoted_grade='A' and b.cheapest_source='TCG Lowest Listing' and not (
      b.official_landed_low is not null and abs(b.cheapest_buy-b.official_landed_low)<=0.02 and b.official_observed_at>=now()-interval '3 hours') then 'B'
    else b.promoted_grade end as actionability_shadow_grade,
  case when b.cheapest_source='TCG Lowest Listing' and b.official_landed_low is not null then b.official_landed_low
       when b.cheapest_source='Mana Pool' then b.manapool_retail else b.cheapest_buy end as actionability_reference_buy
from base b left join hist h on h.sku_id=b.sku_id;

grant select on public.scout_price_actionability_audit to authenticated,service_role;
revoke all on public.scout_price_actionability_audit from anon,public;