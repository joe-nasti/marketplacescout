-- Keep sales-confidence parsing and the full 24h aggregation on the narrow projection.
-- Production migration: scout_projection_sales_confidence_fields

alter table public.marketplace_scan_rows_scout_projection
  add column if not exists scan_sales_history_known boolean,
  add column if not exists scan_sales_history_fetched_at timestamptz,
  add column if not exists scan_quarter_qty numeric;

update public.marketplace_scan_rows_scout_projection p
set scan_sales_history_known=coalesce((r.raw_json->>'salesHistoryAvailable')::boolean,false),
    scan_sales_history_fetched_at=nullif(r.raw_json->>'salesHistoryFetchedAt','')::timestamptz,
    scan_quarter_qty=nullif(r.raw_json->>'quarterQuantitySold','')::numeric
from public.marketplace_scan_rows r
where r.id=p.id;

create or replace function public.sync_marketplace_scan_row_scout_projection()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op='DELETE' then
    delete from public.marketplace_scan_rows_scout_projection where id=old.id;
    return old;
  end if;
  insert into public.marketplace_scan_rows_scout_projection(
    id,user_id,scan_id,sku_id,product_id,product_name,collector_number,set_name,set_code,rarity,printing,condition,language,
    direct_low,sku_market_price,tcg_low,low_with_shipping,direct_listings,direct_available,avg_daily_qty_sold,sales_rank,supply_type,
    scryfall_id,edhrec_rank,raw_demand_adjustment,raw_demand_signal,raw_demand_signal_score,base_score,structural_score,total_marketplace_listings,
    scan_sales_history_known,scan_sales_history_fetched_at,scan_quarter_qty)
  values(
    new.id,new.user_id,new.scan_id,new.sku_id,new.product_id,new.product_name,new.collector_number,new.set_name,new.set_code,new.rarity,new.printing,new.condition,new.language,
    new.direct_low,new.sku_market_price,new.tcg_low,new.low_with_shipping,new.direct_listings,new.direct_available,new.avg_daily_qty_sold,new.sales_rank,new.supply_type,
    new.scryfall_id,new.edhrec_rank,new.demand_adjustment,new.demand_signal,new.demand_signal_score,
    coalesce(new.base_opportunity_score,new.opportunity_score,0)::numeric,
    coalesce(nullif(new.raw_json->>'opportunityScore','')::numeric,coalesce(new.base_opportunity_score,new.opportunity_score,0)::numeric),
    nullif(new.raw_json->>'totalMarketplaceListings','')::numeric,
    coalesce((new.raw_json->>'salesHistoryAvailable')::boolean,false),
    nullif(new.raw_json->>'salesHistoryFetchedAt','')::timestamptz,
    nullif(new.raw_json->>'quarterQuantitySold','')::numeric)
  on conflict(id) do update set
    user_id=excluded.user_id,scan_id=excluded.scan_id,sku_id=excluded.sku_id,product_id=excluded.product_id,product_name=excluded.product_name,
    collector_number=excluded.collector_number,set_name=excluded.set_name,set_code=excluded.set_code,rarity=excluded.rarity,printing=excluded.printing,
    condition=excluded.condition,language=excluded.language,direct_low=excluded.direct_low,sku_market_price=excluded.sku_market_price,tcg_low=excluded.tcg_low,
    low_with_shipping=excluded.low_with_shipping,direct_listings=excluded.direct_listings,direct_available=excluded.direct_available,
    avg_daily_qty_sold=excluded.avg_daily_qty_sold,sales_rank=excluded.sales_rank,supply_type=excluded.supply_type,scryfall_id=excluded.scryfall_id,
    edhrec_rank=excluded.edhrec_rank,raw_demand_adjustment=excluded.raw_demand_adjustment,raw_demand_signal=excluded.raw_demand_signal,
    raw_demand_signal_score=excluded.raw_demand_signal_score,base_score=excluded.base_score,structural_score=excluded.structural_score,
    total_marketplace_listings=excluded.total_marketplace_listings,scan_sales_history_known=excluded.scan_sales_history_known,
    scan_sales_history_fetched_at=excluded.scan_sales_history_fetched_at,scan_quarter_qty=excluded.scan_quarter_qty;
  return new;
end;
$function$;

create or replace function public.annotate_scout_sales_confidence()
returns integer
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '30s'
as $function$
declare n integer;
begin
  with latest_scan as (
    select distinct on (r.user_id,r.sku_id)
      r.user_id,r.sku_id,
      coalesce(r.scan_sales_history_known,false) as scan_known,
      r.scan_sales_history_fetched_at as scan_fetched_at,
      r.avg_daily_qty_sold as scan_sales_day,
      r.scan_quarter_qty
    from public.marketplace_scan_rows_scout_projection r
    join public.marketplace_scans s on s.user_id=r.user_id and s.scan_id=r.scan_id
    where s.captured_at>=now()-interval '24 hours' and r.sku_id is not null
    order by r.user_id,r.sku_id,s.captured_at desc,r.id desc
  ), latest_sales as (
    select distinct on (m.user_id,m.sku_id)
      m.user_id,m.sku_id,m.captured_at,
      m.average_daily_quantity_sold,
      m.average_daily_transaction_count,
      m.quarter_quantity_sold,
      m.quarter_transaction_count
    from public.marketplace_sku_sales_observations m
    where m.sku_id is not null
    order by m.user_id,m.sku_id,m.captured_at desc
  ), merged as (
    select o.user_id,o.sku_id,
      (ls.sku_id is not null or coalesce(sc.scan_known,false)) as known,
      coalesce(ls.captured_at,sc.scan_fetched_at) as fetched_at,
      case
        when ls.average_daily_quantity_sold is not null and ls.average_daily_quantity_sold > 0 then ls.average_daily_quantity_sold
        when ls.quarter_quantity_sold is not null then ls.quarter_quantity_sold/90.0
        when sc.scan_sales_day is not null and sc.scan_sales_day > 0 then sc.scan_sales_day
        when sc.scan_quarter_qty is not null then sc.scan_quarter_qty/90.0
        when ls.average_daily_quantity_sold is not null then ls.average_daily_quantity_sold
        when sc.scan_sales_day is not null then sc.scan_sales_day
        else null
      end as measured_sales_day,
      ls.average_daily_transaction_count,
      ls.quarter_quantity_sold,
      ls.quarter_transaction_count
    from public.scout_opportunities_24h o
    left join latest_scan sc on sc.user_id=o.user_id and sc.sku_id=o.sku_id
    left join latest_sales ls on ls.user_id=o.user_id and ls.sku_id=o.sku_id
  )
  update public.scout_opportunities_24h o set
    avg_daily_qty_sold=m.measured_sales_day,
    score_components=coalesce(o.score_components,'{}'::jsonb) || jsonb_build_object(
      'sales_history_known',m.known,
      'sales_history_fetched_at',m.fetched_at,
      'sales_history_status',case when not m.known then 'unknown' when m.fetched_at is null then 'measured' when m.fetched_at<now()-interval '24 hours' then 'stale' else 'measured' end,
      'effective_sales_per_day',m.measured_sales_day,
      'average_daily_transaction_count',m.average_daily_transaction_count,
      'quarter_quantity_sold',m.quarter_quantity_sold,
      'quarter_transaction_count',m.quarter_transaction_count
    )
  from merged m where o.user_id=m.user_id and o.sku_id=m.sku_id;
  get diagnostics n=row_count;
  return n;
end;
$function$;

create or replace function public.refresh_scout_opportunities_24h_unlocked()
returns integer
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '60s'
as $function$
declare n integer;
begin
  truncate table public.scout_opportunities_24h;
  insert into public.scout_opportunities_24h (
    user_id,sku_id,product_id,product_name,collector_number,set_name,set_code,rarity,printing,condition,language,
    latest_scan_at,first_scan_at,observation_count,
    base_score_latest,base_score_avg,base_score_median,base_score_24h,demand_adjustment,trend_adjustment,opportunity_score,grade,flag,
    direct_low,sku_market_price,tcg_low,low_with_shipping,direct_listings,direct_available,avg_daily_qty_sold,sales_rank,supply_type,
    scryfall_id,edhrec_rank,demand_signal,demand_signal_score,demand_sources,score_components,computed_at,
    structural_score_latest,raw_demand_adjustment_latest,raw_demand_signal_latest,raw_demand_signal_score_latest
  )
  with recent as materialized (
    select r.*,s.captured_at
    from public.marketplace_scan_rows_scout_projection r
    join public.marketplace_scans s on s.user_id=r.user_id and s.scan_id=r.scan_id
    where s.captured_at>=now()-interval '24 hours' and r.sku_id is not null
  ),
  latest as (
    select distinct on(user_id,sku_id) * from recent order by user_id,sku_id,captured_at desc,id desc
  ),
  earliest as (
    select distinct on(user_id,sku_id) user_id,sku_id,sku_market_price,total_marketplace_listings
    from recent order by user_id,sku_id,captured_at asc,id asc
  ),
  demand as (
    select user_id,product_name,demand_adjustment,demand_signal,demand_signal_score,demand_sources,edhrec_rank,demand_observed_at
    from public.marketplace_product_demand_current
  ),
  agg as (
    select user_id,sku_id,min(captured_at) first_scan_at,max(captured_at) latest_scan_at,count(*)::integer observation_count,
      avg(base_score) base_score_avg,percentile_cont(0.5) within group(order by base_score) base_score_median,
      avg(direct_available) direct_available_avg,percentile_cont(0.5) within group(order by direct_available) filter(where direct_available is not null) direct_available_median,
      avg(direct_low) direct_low_avg,percentile_cont(0.5) within group(order by direct_low) filter(where direct_low is not null) direct_low_median
    from recent group by user_id,sku_id
  ),
  scored as (
    select l.*,a.first_scan_at,a.latest_scan_at,a.observation_count,a.base_score_avg,a.base_score_median,
      round((0.60*a.base_score_median+0.40*a.base_score_avg)::numeric,2) base_score_24h,
      coalesce(d.demand_adjustment,0)::numeric joined_demand_adjustment,
      d.demand_signal joined_demand_signal,d.demand_signal_score joined_demand_signal_score,coalesce(d.demand_sources,'{}'::jsonb) joined_demand_sources,
      coalesce(d.edhrec_rank,l.edhrec_rank) joined_edhrec_rank,
      case when a.observation_count<2 then 0::numeric else greatest(-15::numeric,least(15::numeric,
        round((10*greatest(-1::numeric,least(1::numeric,case when coalesce(e.sku_market_price,0)>0 and l.sku_market_price is not null then ((l.sku_market_price-e.sku_market_price)/e.sku_market_price)/0.20 else 0 end))
        +5*greatest(-1::numeric,least(1::numeric,case when coalesce(e.total_marketplace_listings,0)>0 and l.total_marketplace_listings is not null then ((e.total_marketplace_listings-l.total_marketplace_listings)/e.total_marketplace_listings)/0.30 else 0 end)))::numeric,2))) end as trend_adj,
      jsonb_build_object(
        'base_latest',l.base_score,'base_average_24h',round(a.base_score_avg::numeric,2),'base_median_24h',round(a.base_score_median::numeric,2),'observations',a.observation_count,
        'direct_available_average_24h',round(a.direct_available_avg::numeric,2),'direct_available_median_24h',round(a.direct_available_median::numeric,2),
        'direct_low_average_24h',round(a.direct_low_avg::numeric,2),'direct_low_median_24h',round(a.direct_low_median::numeric,2),
        'demand_adjustment',coalesce(d.demand_adjustment,0),'market_price_first_24h',e.sku_market_price,'market_price_latest_24h',l.sku_market_price,
        'marketplace_listings_first_24h',e.total_marketplace_listings,'marketplace_listings_latest_24h',l.total_marketplace_listings,
        'direct_listings_latest',l.direct_listings,'non_direct_listings_latest',greatest(0,coalesce(l.total_marketplace_listings,0)-coalesce(l.direct_listings,0)),
        'copies_per_direct_listing_latest',case when coalesce(l.direct_listings,0)>0 then round((coalesce(l.direct_available,0)::numeric/l.direct_listings)::numeric,3) else 0 end
      ) as components
    from latest l
    join earliest e using(user_id,sku_id)
    join agg a using(user_id,sku_id)
    left join demand d on d.user_id=l.user_id and d.product_name=l.product_name
  ), final as (
    select *,greatest(0,least(100,round(base_score_24h+joined_demand_adjustment+trend_adj)))::integer final_score from scored
  )
  select user_id,sku_id,product_id,product_name,collector_number,set_name,set_code,rarity,printing,condition,language,
    latest_scan_at,first_scan_at,observation_count,base_score,base_score_avg,base_score_median,base_score_24h,joined_demand_adjustment,trend_adj,final_score,
    case when final_score>=90 then 'S' when final_score>=80 then 'A' when final_score>=70 then 'B' when final_score>=60 then 'C' when final_score>=50 then 'D' else 'F' end,
    case when final_score>=75 then 'HOT' when final_score>=55 then 'WATCH' else 'PASS' end,
    direct_low,sku_market_price,tcg_low,low_with_shipping,direct_listings,direct_available,avg_daily_qty_sold,sales_rank,supply_type,
    scryfall_id,joined_edhrec_rank,joined_demand_signal,joined_demand_signal_score,joined_demand_sources,
    components||jsonb_build_object('trend_adjustment',trend_adj),now(),structural_score,coalesce(raw_demand_adjustment,0),raw_demand_signal,raw_demand_signal_score
  from final;
  get diagnostics n=row_count;
  return n;
end;
$function$;