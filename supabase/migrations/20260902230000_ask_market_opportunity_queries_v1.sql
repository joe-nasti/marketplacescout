-- Deterministic seller-market query primitives for Delvin.

create or replace function public.ask_sales_acceleration_v1(
  p_recent_days integer default 3,
  p_baseline_days integer default 28,
  p_limit integer default 10,
  p_finish text default 'all',
  p_only_price_lag boolean default false
) returns jsonb
language sql stable security definer set search_path=public
as $$
with params as (
  select greatest(1,least(coalesce(p_recent_days,3),7)) rd,
         greatest(7,least(coalesce(p_baseline_days,28),90)) bd,
         greatest(1,least(coalesce(p_limit,10),30)) lim,
         lower(coalesce(p_finish,'all')) finish,
         (select max(bucket_start_date) from marketplace_sku_sales_buckets) as asof
), agg as (
  select b.user_id,b.sku_id,b.product_id,max(b.finish) as finish,
    sum(b.quantity_sold) filter(where b.bucket_start_date > p.asof-p.rd) as recent_qty,
    sum(b.transaction_count) filter(where b.bucket_start_date > p.asof-p.rd) as recent_txn,
    sum(b.quantity_sold) filter(where b.bucket_start_date <= p.asof-p.rd and b.bucket_start_date > p.asof-p.bd) as baseline_qty,
    sum(b.transaction_count) filter(where b.bucket_start_date <= p.asof-p.rd and b.bucket_start_date > p.asof-p.bd) as baseline_txn,
    avg(b.market_price) filter(where b.bucket_start_date > p.asof-p.rd) as recent_sale_market,
    avg(b.market_price) filter(where b.bucket_start_date <= p.asof-p.rd and b.bucket_start_date > p.asof-p.bd) as baseline_sale_market
  from marketplace_sku_sales_buckets b cross join params p
  where b.bucket_start_date > p.asof-p.bd
    and (p.finish='all' or lower(coalesce(b.finish,b.printing,'')) like case when p.finish='foil' then '%foil%' else '%nonfoil%' end)
  group by b.user_id,b.sku_id,b.product_id
), scored as (
  select a.*,p.asof,p.rd,p.bd,
    coalesce(recent_qty,0)/p.rd::numeric as recent_daily_qty,
    coalesce(baseline_qty,0)/greatest(p.bd-p.rd,1)::numeric as baseline_daily_qty,
    (coalesce(recent_qty,0)/p.rd::numeric)-(coalesce(baseline_qty,0)/greatest(p.bd-p.rd,1)::numeric) as daily_qty_delta,
    case when coalesce(baseline_qty,0)>0 then (coalesce(recent_qty,0)/p.rd::numeric)/nullif(coalesce(baseline_qty,0)/greatest(p.bd-p.rd,1)::numeric,0) end as velocity_multiple
  from agg a cross join params p
), joined as (
  select s.*,c.product_name,c.set_name,c.set_code,c.collector_number,c.printing,c.condition,c.language,
    c.direct_low,c.sku_market_price,c.tcg_low,c.low_with_shipping,c.direct_available,c.direct_listings,c.sales_rank,c.edhrec_rank,c.demand_signal,c.opportunity_score,c.grade,
    case when s.baseline_sale_market>0 and s.recent_sale_market is not null then (s.recent_sale_market-s.baseline_sale_market)/s.baseline_sale_market*100 end as sale_market_change_pct,
    round((least(coalesce(s.velocity_multiple,0),10)*12 + least(greatest(s.daily_qty_delta,0),10)*6 + least(coalesce(s.recent_txn,0),20)*2)::numeric,1) as acceleration_score
  from scored s left join scout_opportunities_v5_cache c on c.user_id=s.user_id and c.sku_id=s.sku_id
), eligible as (
  select * from joined
  where recent_qty>=2 and recent_txn>=2 and product_name is not null
    and recent_daily_qty >= greatest(baseline_daily_qty*1.5,baseline_daily_qty+0.15)
    and (not p_only_price_lag or abs(coalesce(sale_market_change_pct,0))<=10)
)
select jsonb_build_object('query_type','sales_acceleration','as_of',(select asof from params),'recent_days',(select rd from params),'baseline_days',(select bd from params),'only_price_lag',p_only_price_lag,
 'rows',coalesce((select jsonb_agg(jsonb_build_object(
    'sku_id',sku_id,'product_id',product_id,'card_name',product_name,'set_name',set_name,'set_code',set_code,'collector_number',collector_number,'finish',finish,'printing',printing,'condition',condition,'language',language,
    'recent_qty',recent_qty,'recent_txn',recent_txn,'recent_daily_qty',round(recent_daily_qty,2),'baseline_daily_qty',round(baseline_daily_qty,2),'daily_qty_delta',round(daily_qty_delta,2),'velocity_multiple',round(velocity_multiple,2),
    'sale_market_change_pct',round(sale_market_change_pct,1),'direct_low',direct_low,'market_price',sku_market_price,'tcg_low',tcg_low,'direct_available',direct_available,'sales_rank',sales_rank,'edhrec_rank',edhrec_rank,'demand_signal',demand_signal,'opportunity_score',opportunity_score,'grade',grade,'score',acceleration_score
  ) order by acceleration_score desc,recent_qty desc) from (select * from eligible order by acceleration_score desc,recent_qty desc limit (select lim from params)) q),'[]'::jsonb));
$$;

create or replace function public.ask_cross_market_dislocations_v1(
  p_limit integer default 10,p_min_sales_day numeric default 0.25,p_min_profit numeric default 1,p_min_roi_pct numeric default 10
) returns jsonb
language sql stable security definer set search_path=public
as $$
with p as (select greatest(1,least(coalesce(p_limit,10),30)) lim), candidates as (
 select c.*,
   greatest(coalesce(direct_net_est-cheapest_buy,-999999),coalesce(ck_buylist-cheapest_buy,-999999)) as best_profit,
   greatest(coalesce(case when cheapest_buy>0 then (direct_net_est-cheapest_buy)/cheapest_buy*100 end,-999999),coalesce(case when cheapest_buy>0 and ck_buylist is not null then (ck_buylist-cheapest_buy)/cheapest_buy*100 end,-999999)) as best_roi
 from scout_opportunities_v5_cache c
 where cheapest_buy is not null and cheapest_buy>0 and product_name is not null
   and coalesce(avg_daily_qty_sold,0)>=coalesce(p_min_sales_day,0.25)
   and confidence_label in ('market_confirmed','buylist_backed','market_mixed')
), ranked as (
 select *,case when coalesce(ck_buylist-cheapest_buy,-999999)>coalesce(direct_net_est-cheapest_buy,-999999) then 'Card Kingdom buylist' else 'TCG Direct' end as best_exit
 from candidates where best_profit>=coalesce(p_min_profit,1) and best_roi>=coalesce(p_min_roi_pct,10)
 order by best_roi desc,best_profit desc,avg_daily_qty_sold desc limit (select lim from p)
)
select jsonb_build_object('query_type','cross_market_dislocations','rows',coalesce(jsonb_agg(jsonb_build_object(
 'sku_id',sku_id,'product_id',product_id,'card_name',product_name,'set_name',set_name,'set_code',set_code,'collector_number',collector_number,'printing',printing,'cheapest_buy',cheapest_buy,'buy_source',cheapest_source,
 'best_exit',best_exit,'best_profit',round(best_profit,2),'best_roi_pct',round(best_roi,1),'direct_net_est',direct_net_est,'direct_low',direct_low,'direct_available',direct_available,'ck_buylist',ck_buylist,'manapool_retail',manapool_retail,'cardmarket_retail',cardmarket_retail,
 'avg_daily_qty_sold',avg_daily_qty_sold,'opportunity_score',opportunity_score,'grade',grade,'confidence',confidence_label
 ) order by best_roi desc,best_profit desc),'[]'::jsonb)) from ranked;
$$;

create or replace function public.ask_direct_pressure_v1(
 p_lookback_days integer default 7,p_limit integer default 10,p_min_sales_day numeric default 0.25
) returns jsonb
language sql stable security definer set search_path=public
as $$
with p as (select greatest(1,least(coalesce(p_lookback_days,7),30)) days,greatest(1,least(coalesce(p_limit,10),30)) lim), hist as (
 select r.user_id,r.sku_id,s.captured_at,r.direct_available,r.direct_low,
        row_number() over(partition by r.user_id,r.sku_id order by s.captured_at desc) rn_latest,
        row_number() over(partition by r.user_id,r.sku_id order by s.captured_at asc) rn_oldest
 from marketplace_scan_rows r join marketplace_scans s on s.user_id=r.user_id and s.scan_id=r.scan_id cross join p
 where s.captured_at>=now()-(p.days||' days')::interval and r.direct_available is not null
), changes as (
 select user_id,sku_id,max(direct_available) filter(where rn_latest=1) latest_available,max(direct_available) filter(where rn_oldest=1) old_available,
   max(direct_low) filter(where rn_latest=1) latest_direct_low,max(direct_low) filter(where rn_oldest=1) old_direct_low,max(captured_at) latest_at,min(captured_at) old_at
 from hist group by user_id,sku_id
), joined as (
 select c.*,x.old_available,x.latest_available,x.old_direct_low,x.latest_direct_low,x.old_at,x.latest_at,x.old_available-x.latest_available as availability_drop,
   case when x.old_available>0 then (x.old_available-x.latest_available)::numeric/x.old_available*100 end as availability_drop_pct,
   case when coalesce(c.avg_daily_qty_sold,0)>0 then x.latest_available/coalesce(c.avg_daily_qty_sold,0) end as days_of_direct_cover,
   case when c.sku_market_price>0 and c.direct_low is not null then (c.direct_low-c.sku_market_price)/c.sku_market_price*100 end as direct_premium_pct
 from changes x join scout_opportunities_v5_cache c on c.user_id=x.user_id and c.sku_id=x.sku_id
 where x.old_available is not null and x.latest_available is not null and x.old_available>x.latest_available and coalesce(c.avg_daily_qty_sold,0)>=coalesce(p_min_sales_day,0.25)
), ranked as (
 select *,round((least(coalesce(availability_drop_pct,0),100)*0.45 + least(coalesce(avg_daily_qty_sold,0),10)*4 + greatest(0,20-least(coalesce(days_of_direct_cover,20),20))*1.5)::numeric,1) pressure_score
 from joined order by pressure_score desc,availability_drop desc limit (select lim from p)
)
select jsonb_build_object('query_type','direct_pressure','lookback_days',(select days from p),'rows',coalesce(jsonb_agg(jsonb_build_object(
 'sku_id',sku_id,'product_id',product_id,'card_name',product_name,'set_name',set_name,'set_code',set_code,'collector_number',collector_number,'printing',printing,'old_direct_available',old_available,'direct_available',latest_available,
 'availability_drop',availability_drop,'availability_drop_pct',round(availability_drop_pct,1),'avg_daily_qty_sold',avg_daily_qty_sold,'days_of_direct_cover',round(days_of_direct_cover,1),'direct_low',direct_low,'market_price',sku_market_price,'direct_premium_pct',round(direct_premium_pct,1),
 'old_direct_low',old_direct_low,'pressure_score',pressure_score,'old_at',old_at,'latest_at',latest_at,'opportunity_score',opportunity_score,'grade',grade
 ) order by pressure_score desc,availability_drop desc),'[]'::jsonb)) from ranked;
$$;

revoke all on function public.ask_sales_acceleration_v1(integer,integer,integer,text,boolean) from public,anon,authenticated;
revoke all on function public.ask_cross_market_dislocations_v1(integer,numeric,numeric,numeric) from public,anon,authenticated;
revoke all on function public.ask_direct_pressure_v1(integer,integer,numeric) from public,anon,authenticated;
grant execute on function public.ask_sales_acceleration_v1(integer,integer,integer,text,boolean) to service_role;
grant execute on function public.ask_cross_market_dislocations_v1(integer,numeric,numeric,numeric) to service_role;
grant execute on function public.ask_direct_pressure_v1(integer,integer,numeric) to service_role;
