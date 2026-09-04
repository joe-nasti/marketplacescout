-- Align Scout opportunity episodes with exact-SKU supply, price and sales outcomes.
-- Post-entry supply observations are retained for forward outcome measurement but never
-- represented as evidence Scout knew at episode open.

create or replace function public.ask_collectish_scout_episode_supply_context_v1(
  p_sku_id text default null,
  p_days integer default 365,
  p_limit integer default 100
) returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
with params as (
  select greatest(7,least(coalesce(p_days,365),3650))::int d,
         greatest(1,least(coalesce(p_limit,100),250))::int lim
), hist as (
  select h.*,
    (coalesce(h.flag,'PASS')='HOT' or (h.promoted_grade in ('A','B') and coalesce(h.flag,'PASS')<>'PASS')) actionable,
    lag(coalesce(h.flag,'PASS')='HOT' or (h.promoted_grade in ('A','B') and coalesce(h.flag,'PASS')<>'PASS'))
      over(partition by h.user_id,h.sku_id order by h.evaluated_at,h.id) prev_actionable
  from public.scout_evaluation_history h,params p
  where auth.uid() is not null and h.user_id=auth.uid()
    and (p_sku_id is null or h.sku_id=p_sku_id)
    and h.evaluated_at>=now()-make_interval(days=>p.d)
), starts as (
  select *,sum(case when actionable and not coalesce(prev_actionable,false) then 1 else 0 end)
    over(partition by user_id,sku_id order by evaluated_at,id) episode_no
  from hist
), entries as (
  select distinct on(user_id,sku_id,episode_no)
    user_id,sku_id,episode_no,product_id,product_name,set_code,collector_number,printing,condition,language,
    evaluated_at opened_at,promoted_grade entry_grade,promoted_score entry_score,flag entry_flag,
    confidence_label entry_confidence,sku_market_price entry_market,direct_low entry_direct,
    avg_daily_qty_sold entry_velocity,direct_available entry_direct_available
  from starts where actionable and episode_no>0
  order by user_id,sku_id,episode_no,evaluated_at,id
), closed as (
  select e.*,c.evaluated_at closed_at from entries e
  left join lateral (
    select h.evaluated_at from hist h
    where h.user_id=e.user_id and h.sku_id=e.sku_id and h.evaluated_at>e.opened_at and not h.actionable
    order by h.evaluated_at,h.id limit 1
  ) c on true
), ctx as (
  select e.*,
    b.observed_at supply_baseline_at,
    round((extract(epoch from(b.observed_at-e.opened_at))/3600.0)::numeric,2) supply_baseline_offset_hours,
    case when b.observed_at is null then 'MISSING' when b.observed_at<=e.opened_at then 'AT_OR_BEFORE_ENTRY' else 'AFTER_ENTRY' end supply_baseline_timing,
    b.unit_count supply_baseline_units,b.listing_count supply_baseline_listings,b.seller_count supply_baseline_sellers,
    b.direct_unit_count supply_baseline_direct_units,b.direct_listing_count supply_baseline_direct_listings,
    h6.observed_at supply_6h_at,h6.unit_count supply_6h_units,h6.direct_unit_count supply_6h_direct_units,
    h24.observed_at supply_24h_at,h24.unit_count supply_24h_units,h24.direct_unit_count supply_24h_direct_units,
    h72.observed_at supply_72h_at,h72.unit_count supply_72h_units,h72.direct_unit_count supply_72h_direct_units,
    h168.observed_at supply_7d_at,h168.unit_count supply_7d_units,h168.direct_unit_count supply_7d_direct_units,
    p24.observed_at price_24h_at,p24.market_price market_24h,p24.direct_low_price direct_24h,
    p72.observed_at price_72h_at,p72.market_price market_72h,p72.direct_low_price direct_72h,
    p168.observed_at price_7d_at,p168.market_price market_7d,p168.direct_low_price direct_7d,
    pre.quantity_sold sales_pre7d,post24.quantity_sold sales_post24h,post72.quantity_sold sales_post72h,
    eo.event_count supply_event_count,eo.events supply_events
  from closed e
  left join lateral (
    select s.* from public.market_supply_snapshots s
    where s.source='tcgplayer_marketplace' and s.coverage_state='COMPLETE' and s.sku_id=e.sku_id
      and s.observed_at between e.opened_at-interval '24 hours' and e.opened_at+interval '24 hours'
    order by abs(extract(epoch from(s.observed_at-e.opened_at))),s.observed_at desc limit 1
  ) b on true
  left join lateral (
    select s.* from public.market_supply_snapshots s where s.source='tcgplayer_marketplace' and s.coverage_state='COMPLETE' and s.sku_id=e.sku_id
      and s.observed_at>=e.opened_at+interval '6 hours' and s.observed_at<e.opened_at+interval '14 hours' order by s.observed_at limit 1
  ) h6 on true
  left join lateral (
    select s.* from public.market_supply_snapshots s where s.source='tcgplayer_marketplace' and s.coverage_state='COMPLETE' and s.sku_id=e.sku_id
      and s.observed_at>=e.opened_at+interval '24 hours' and s.observed_at<e.opened_at+interval '32 hours' order by s.observed_at limit 1
  ) h24 on true
  left join lateral (
    select s.* from public.market_supply_snapshots s where s.source='tcgplayer_marketplace' and s.coverage_state='COMPLETE' and s.sku_id=e.sku_id
      and s.observed_at>=e.opened_at+interval '72 hours' and s.observed_at<e.opened_at+interval '80 hours' order by s.observed_at limit 1
  ) h72 on true
  left join lateral (
    select s.* from public.market_supply_snapshots s where s.source='tcgplayer_marketplace' and s.coverage_state='COMPLETE' and s.sku_id=e.sku_id
      and s.observed_at>=e.opened_at+interval '168 hours' and s.observed_at<e.opened_at+interval '180 hours' order by s.observed_at limit 1
  ) h168 on true
  left join lateral (
    select p.* from public.tcgplayer_official_sku_price_history p where p.sku_id=e.sku_id and p.observed_at>=e.opened_at+interval '24 hours' and p.observed_at<e.opened_at+interval '28 hours' order by p.observed_at limit 1
  ) p24 on true
  left join lateral (
    select p.* from public.tcgplayer_official_sku_price_history p where p.sku_id=e.sku_id and p.observed_at>=e.opened_at+interval '72 hours' and p.observed_at<e.opened_at+interval '76 hours' order by p.observed_at limit 1
  ) p72 on true
  left join lateral (
    select p.* from public.tcgplayer_official_sku_price_history p where p.sku_id=e.sku_id and p.observed_at>=e.opened_at+interval '168 hours' and p.observed_at<e.opened_at+interval '172 hours' order by p.observed_at limit 1
  ) p168 on true
  left join lateral (
    select sum(coalesce(b.quantity_sold,0)) quantity_sold from public.marketplace_sku_sales_buckets b
    where b.user_id=e.user_id and b.sku_id=e.sku_id and b.bucket_start_date between (e.opened_at::date-7) and (e.opened_at::date-1)
  ) pre on true
  left join lateral (
    select sum(coalesce(b.quantity_sold,0)) quantity_sold from public.marketplace_sku_sales_buckets b
    where b.user_id=e.user_id and b.sku_id=e.sku_id and b.bucket_start_date=e.opened_at::date
  ) post24 on true
  left join lateral (
    select sum(coalesce(b.quantity_sold,0)) quantity_sold from public.marketplace_sku_sales_buckets b
    where b.user_id=e.user_id and b.sku_id=e.sku_id and b.bucket_start_date between e.opened_at::date and e.opened_at::date+2
  ) post72 on true
  left join lateral (
    select count(*)::int event_count,coalesce(jsonb_agg(jsonb_build_object(
      'event_at',o.event_at,'event_type',o.event_type,'significance',o.significance,'outcome_state',o.outcome_state,
      'baseline',o.baseline,'horizon_6h',o.horizon_6h,'horizon_24h',o.horizon_24h,'horizon_72h',o.horizon_72h
    ) order by o.event_at),'[]'::jsonb) events
    from public.market_supply_event_outcomes o
    where o.sku_id=e.sku_id and o.event_at between e.opened_at-interval '24 hours' and coalesce(e.closed_at,e.opened_at+interval '7 days')
  ) eo on true
), shaped as (
  select c.*,
    case when supply_baseline_units>0 and supply_24h_units is not null and supply_baseline_at<=opened_at+interval '2 hours' then round((supply_24h_units::numeric/supply_baseline_units-1)*100,1) end supply_change_24h_pct,
    case when supply_baseline_units>0 and supply_72h_units is not null and supply_baseline_at<=opened_at+interval '2 hours' then round((supply_72h_units::numeric/supply_baseline_units-1)*100,1) end supply_change_72h_pct,
    case when supply_baseline_units>0 and supply_7d_units is not null and supply_baseline_at<=opened_at+interval '2 hours' then round((supply_7d_units::numeric/supply_baseline_units-1)*100,1) end supply_change_7d_pct,
    case when entry_market>0 and market_24h>0 then round((market_24h/entry_market-1)*100,1) end market_change_24h_pct,
    case when entry_market>0 and market_72h>0 then round((market_72h/entry_market-1)*100,1) end market_change_72h_pct,
    case when entry_market>0 and market_7d>0 then round((market_7d/entry_market-1)*100,1) end market_change_7d_pct,
    case when coalesce(sales_pre7d,0)>0 and opened_at<=now()-interval '72 hours' then round((coalesce(sales_post72h,0)/3.0)/(sales_pre7d/7.0),2) end velocity_ratio_72h
  from ctx c
), agg as (
  select count(*) total_episodes,
    count(*) filter(where supply_baseline_at is not null) supply_observed_episodes,
    count(*) filter(where supply_baseline_timing='AT_OR_BEFORE_ENTRY') supply_entry_known_episodes,
    count(*) filter(where supply_baseline_timing='AFTER_ENTRY') supply_post_entry_baseline_episodes,
    count(*) filter(where supply_24h_at is not null and supply_baseline_at<=opened_at+interval '2 hours') matured_supply_24h,
    count(*) filter(where supply_72h_at is not null and supply_baseline_at<=opened_at+interval '2 hours') matured_supply_72h,
    count(*) filter(where supply_7d_at is not null and supply_baseline_at<=opened_at+interval '2 hours') matured_supply_7d,
    count(*) filter(where supply_change_24h_pct<=-20) supply_tightened_24h,
    count(*) filter(where supply_change_24h_pct>=20) supply_loosened_24h,
    count(*) filter(where market_change_24h_pct>=5) market_up_5pct_24h,
    avg(supply_change_24h_pct) filter(where supply_change_24h_pct is not null) avg_supply_change_24h_pct,
    avg(market_change_24h_pct) filter(where market_change_24h_pct is not null) avg_market_change_24h_pct,
    avg(velocity_ratio_72h) filter(where velocity_ratio_72h is not null) avg_velocity_ratio_72h
  from shaped
), ranked_rows as (
  select *,row_number() over(order by (supply_baseline_at is not null) desc,opened_at desc) rn from shaped
), rows as (
  select jsonb_build_object(
    'episode_id',sku_id||':'||episode_no,'sku_id',sku_id,'product_id',product_id,'product_name',product_name,'set_code',set_code,
    'opened_at',opened_at,'closed_at',closed_at,
    'entry',jsonb_build_object('grade',entry_grade,'score',entry_score,'flag',entry_flag,'confidence',entry_confidence,'market_price',entry_market,'direct_low',entry_direct,'velocity',entry_velocity,'direct_available',entry_direct_available),
    'coverage',jsonb_build_object('supply_observed',supply_baseline_at is not null,'supply_known_at_entry',supply_baseline_timing='AT_OR_BEFORE_ENTRY','supply_6h',supply_6h_at is not null,'supply_24h',supply_24h_at is not null,'supply_72h',supply_72h_at is not null,'supply_7d',supply_7d_at is not null,'price_24h',price_24h_at is not null,'price_72h',price_72h_at is not null,'price_7d',price_7d_at is not null),
    'supply',jsonb_build_object(
      'baseline',jsonb_build_object('observed_at',supply_baseline_at,'offset_hours',supply_baseline_offset_hours,'timing',supply_baseline_timing,'units',supply_baseline_units,'listings',supply_baseline_listings,'sellers',supply_baseline_sellers,'direct_units',supply_baseline_direct_units,'direct_listings',supply_baseline_direct_listings),
      '6h',jsonb_build_object('observed_at',supply_6h_at,'units',supply_6h_units,'direct_units',supply_6h_direct_units),
      '24h',jsonb_build_object('observed_at',supply_24h_at,'units',supply_24h_units,'direct_units',supply_24h_direct_units,'change_pct',supply_change_24h_pct),
      '72h',jsonb_build_object('observed_at',supply_72h_at,'units',supply_72h_units,'direct_units',supply_72h_direct_units,'change_pct',supply_change_72h_pct),
      '7d',jsonb_build_object('observed_at',supply_7d_at,'units',supply_7d_units,'direct_units',supply_7d_direct_units,'change_pct',supply_change_7d_pct)
    ),
    'price_response',jsonb_build_object(
      '24h',jsonb_build_object('observed_at',price_24h_at,'market_price',market_24h,'direct_low',direct_24h,'market_change_pct',market_change_24h_pct),
      '72h',jsonb_build_object('observed_at',price_72h_at,'market_price',market_72h,'direct_low',direct_72h,'market_change_pct',market_change_72h_pct),
      '7d',jsonb_build_object('observed_at',price_7d_at,'market_price',market_7d,'direct_low',direct_7d,'market_change_pct',market_change_7d_pct)
    ),
    'velocity_response',jsonb_build_object('sales_pre7d',sales_pre7d,'sales_post24h',case when opened_at<=now()-interval '24 hours' then sales_post24h end,'sales_post72h',case when opened_at<=now()-interval '72 hours' then sales_post72h end,'velocity_ratio_72h',velocity_ratio_72h),
    'supply_events',coalesce(supply_events,'[]'::jsonb),'supply_event_count',coalesce(supply_event_count,0)
  ) j,opened_at,rn
  from ranked_rows where rn<=(select lim from params)
), packed as (
  select coalesce(jsonb_agg(j order by rn),'[]'::jsonb) episodes from rows
)
select jsonb_build_object(
  'available',true,'version','episode_supply_context_v1','days',(select d from params),
  'coverage',jsonb_build_object('episodes',a.total_episodes,'supply_observed_episodes',a.supply_observed_episodes,'observed_coverage_pct',case when a.total_episodes>0 then round(a.supply_observed_episodes*100.0/a.total_episodes,1) end,'supply_entry_known_episodes',a.supply_entry_known_episodes,'supply_post_entry_baseline_episodes',a.supply_post_entry_baseline_episodes,'matured_supply_24h',a.matured_supply_24h,'matured_supply_72h',a.matured_supply_72h,'matured_supply_7d',a.matured_supply_7d),
  'summary',jsonb_build_object('supply_tightened_24h',a.supply_tightened_24h,'supply_loosened_24h',a.supply_loosened_24h,'market_up_5pct_24h',a.market_up_5pct_24h,'avg_supply_change_24h_pct',round(a.avg_supply_change_24h_pct::numeric,1),'avg_market_change_24h_pct',round(a.avg_market_change_24h_pct::numeric,1),'avg_velocity_ratio_72h',round(a.avg_velocity_ratio_72h::numeric,2)),
  'readiness',case when a.matured_supply_72h>=30 then 'INITIAL_CALIBRATION' when a.matured_supply_24h>=20 then 'EARLY_DIRECTIONAL' else 'INSUFFICIENT_SAMPLE' end,
  'interpretation','Supply baselines observed after episode open are retained for future outcome alignment but never treated as evidence Scout knew at entry. Supply-change statistics require a baseline at or within 2h after entry. Price/velocity relationships are descriptive forward outcomes, not causal estimates or realized trade returns.',
  'episodes',p.episodes,'generated_at',now()
) from agg a cross join packed p;
$$;

revoke all on function public.ask_collectish_scout_episode_supply_context_v1(text,integer,integer) from public,anon;
grant execute on function public.ask_collectish_scout_episode_supply_context_v1(text,integer,integer) to authenticated,service_role;
notify pgrst,'reload schema';
