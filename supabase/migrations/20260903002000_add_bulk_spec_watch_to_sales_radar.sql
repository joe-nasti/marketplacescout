-- Distinguish broad sales acceleration from concentrated bulk/spec purchasing.
-- Bucket-level sales data cannot prove buyer identity, so this intentionally uses
-- "bulk/spec watch" rather than claiming a confirmed buyout.

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
         greatest(1,least(coalesce(p_limit,10),80)) lim,
         lower(coalesce(p_finish,'all')) finish,
         (select max(bucket_start_date) from marketplace_sku_sales_buckets) as asof
), agg as (
  select b.user_id,b.sku_id,b.product_id,max(b.finish) as finish,
    sum(b.quantity_sold) filter(where b.bucket_start_date > p.asof-p.rd) as recent_qty,
    sum(b.transaction_count) filter(where b.bucket_start_date > p.asof-p.rd) as recent_txn,
    sum(b.quantity_sold) filter(where b.bucket_start_date <= p.asof-p.rd and b.bucket_start_date > p.asof-p.bd) as baseline_qty,
    sum(b.transaction_count) filter(where b.bucket_start_date <= p.asof-p.rd and b.bucket_start_date > p.asof-p.bd) as baseline_txn,
    max(b.quantity_sold) filter(where b.bucket_start_date > p.asof-p.rd) as peak_bucket_qty,
    max(b.quantity_sold::numeric/greatest(coalesce(b.transaction_count,0),1)) filter(where b.bucket_start_date > p.asof-p.rd) as peak_bucket_units_per_txn,
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
    case when coalesce(baseline_qty,0)>0 then (coalesce(recent_qty,0)/p.rd::numeric)/nullif(coalesce(baseline_qty,0)/greatest(p.bd-p.rd,1)::numeric,0) end as velocity_multiple,
    coalesce(recent_qty,0)::numeric/nullif(coalesce(recent_txn,0),0) as recent_units_per_txn,
    coalesce(baseline_qty,0)::numeric/nullif(coalesce(baseline_txn,0),0) as baseline_units_per_txn,
    coalesce(peak_bucket_qty,0)::numeric/nullif(coalesce(recent_qty,0),0) as peak_bucket_qty_share
  from agg a cross join params p
), classified as (
  select s.*,
    case
      when coalesce(recent_qty,0)>=12
       and coalesce(peak_bucket_units_per_txn,0)>=greatest(8,coalesce(baseline_units_per_txn,1)*3)
       and coalesce(peak_bucket_qty_share,0)>=0.35 then 'high'
      when coalesce(recent_qty,0)>=8
       and (
         coalesce(recent_units_per_txn,0)>=greatest(3,coalesce(baseline_units_per_txn,1)*2)
         or coalesce(peak_bucket_units_per_txn,0)>=5
       ) then 'medium'
      else null
    end as bulk_buy_severity
  from scored s
), joined as (
  select s.*,c.product_name,c.set_name,c.set_code,c.collector_number,c.printing,c.condition,c.language,
    c.direct_low,c.sku_market_price,c.tcg_low,c.low_with_shipping,c.direct_available,c.direct_listings,c.sales_rank,c.edhrec_rank,c.demand_signal,c.opportunity_score,c.grade,
    case when s.baseline_sale_market>0 and s.recent_sale_market is not null then (s.recent_sale_market-s.baseline_sale_market)/s.baseline_sale_market*100 end as sale_market_change_pct,
    (s.bulk_buy_severity is not null) as bulk_buy_flag,
    case s.bulk_buy_severity
      when 'high' then 'Unusually concentrated purchasing; possible spec/buyout activity. Watch for follow-through before treating volume as broad demand.'
      when 'medium' then 'Some recent volume is unusually concentrated; demand may include bulk/spec purchasing.'
      else null
    end as bulk_buy_reason,
    round(greatest(0,
      least(coalesce(s.velocity_multiple,0),10)*12
      + least(greatest(s.daily_qty_delta,0),10)*6
      + least(coalesce(s.recent_txn,0),20)*2
      - case s.bulk_buy_severity when 'high' then 12 when 'medium' then 6 else 0 end
    )::numeric,1) as acceleration_score
  from classified s left join scout_opportunities_v5_cache c on c.user_id=s.user_id and c.sku_id=s.sku_id
), eligible as (
  select * from joined
  where recent_qty>=2 and recent_txn>=2 and product_name is not null
    and recent_daily_qty >= greatest(baseline_daily_qty*1.5,baseline_daily_qty+0.15)
    and (not p_only_price_lag or abs(coalesce(sale_market_change_pct,0))<=10)
)
select jsonb_build_object(
 'query_type','sales_acceleration','as_of',(select asof from params),'recent_days',(select rd from params),'baseline_days',(select bd from params),'only_price_lag',p_only_price_lag,
 'rows',coalesce((select jsonb_agg(jsonb_build_object(
    'sku_id',sku_id,'product_id',product_id,'card_name',product_name,'set_name',set_name,'set_code',set_code,'collector_number',collector_number,'finish',finish,'printing',printing,'condition',condition,'language',language,
    'recent_qty',recent_qty,'recent_txn',recent_txn,'recent_daily_qty',round(recent_daily_qty,2),'baseline_daily_qty',round(baseline_daily_qty,2),'daily_qty_delta',round(daily_qty_delta,2),'velocity_multiple',round(velocity_multiple,2),
    'recent_units_per_txn',round(recent_units_per_txn,2),'baseline_units_per_txn',round(baseline_units_per_txn,2),
    'peak_bucket_qty',peak_bucket_qty,'peak_bucket_units_per_txn',round(peak_bucket_units_per_txn,2),'peak_bucket_qty_share',round(peak_bucket_qty_share,3),
    'bulk_buy_flag',bulk_buy_flag,'bulk_buy_severity',bulk_buy_severity,'bulk_buy_reason',bulk_buy_reason,
    'sale_market_change_pct',round(sale_market_change_pct,1),'direct_low',direct_low,'market_price',sku_market_price,'tcg_low',tcg_low,'direct_available',direct_available,'sales_rank',sales_rank,'edhrec_rank',edhrec_rank,'demand_signal',demand_signal,'opportunity_score',opportunity_score,'grade',grade,'score',acceleration_score
  ) order by acceleration_score desc,recent_qty desc) from (select * from eligible order by acceleration_score desc,recent_qty desc limit (select lim from params)) q),'[]'::jsonb)
);
$$;

create or replace function public.ask_delvin_market_radar_v1(p_limit integer default 15)
returns jsonb language sql stable security definer set search_path='public' as $function$
with p as(select greatest(1,least(coalesce(p_limit,15),30)) lim),source_rows as(
  select 'sales_acceleration' source,x,
    26::numeric+least(24,coalesce((x->>'velocity_multiple')::numeric,0)*2)
      -case coalesce(x->>'bulk_buy_severity','') when 'high' then 8 when 'medium' then 4 else 0 end score
    from delvin_query_cache c cross join lateral jsonb_array_elements(coalesce(c.payload->'rows','[]'::jsonb)) x where c.query_key='sales_acceleration'
  union all select 'direct_pressure',x,30+least(25,abs(coalesce((x->>'availability_drop_pct')::numeric,0))/4)+least(10,greatest(coalesce((x->>'direct_premium_pct')::numeric,0),0)/5) from delvin_query_cache c cross join lateral jsonb_array_elements(coalesce(c.payload->'rows','[]'::jsonb)) x where c.query_key='direct_pressure_7d'
  union all select 'cross_market',x,24+least(26,coalesce((x->>'best_roi_pct')::numeric,0)/20) from delvin_query_cache c cross join lateral jsonb_array_elements(coalesce(c.payload->'rows','[]'::jsonb)) x where c.query_key='cross_market_dislocations'
  union all select 'tcgplayer_climbing',x,20+least(20,abs(coalesce((x->>'pct_change')::numeric,0))/10) from delvin_query_cache c cross join lateral jsonb_array_elements(coalesce(c.payload->'vetted','[]'::jsonb)) x where c.query_key='tcgplayer_climbing'
  union all select 'mtgstocks',x,22+least(20,coalesce((x->>'action_score')::numeric,0)/5) from delvin_query_cache c cross join lateral jsonb_array_elements(coalesce(c.payload->'early_movers','[]'::jsonb)) x where c.query_key='mtgstocks_interests_both'
  union all select 'syp',x,22+least(28,coalesce((x->>'importance_score')::numeric,0)/4) from delvin_query_cache c cross join lateral jsonb_array_elements(coalesce(c.payload->'rows','[]'::jsonb)) x where c.query_key='syp_pressure_7d' and coalesce(x->>'syp_direction','')='appetite_up'
),normalized as(
  select source,x,score,coalesce(nullif(x->>'sku_id',''),nullif(x->>'product_id',''),lower(coalesce(x->>'card_name',''))||'|'||lower(coalesce(x->>'set_code',x->>'set_name',''))) entity_key,x->>'card_name' card_name from source_rows where coalesce(x->>'card_name','')<>''
),grouped as(
  select entity_key,max(card_name) card_name,max(nullif(x->>'sku_id','')) sku_id,max(nullif(x->>'product_id','')) product_id,max(nullif(x->>'set_code','')) set_code,max(nullif(x->>'set_name','')) set_name,max(nullif(x->>'printing','')) printing,
    count(distinct source) source_count,array_agg(distinct source order by source) sources,
    bool_or(source='sales_acceleration' and coalesce((x->>'bulk_buy_flag')::boolean,false)) bulk_spec_watch,
    max(case when source='sales_acceleration' then nullif(x->>'bulk_buy_severity','') end) bulk_spec_severity,
    max(case when source='sales_acceleration' then nullif(x->>'bulk_buy_reason','') end) bulk_spec_reason,
    round(least(100,sum(score)+case when count(distinct source)>=2 then 18 else 0 end)::numeric,1) radar_score,
    jsonb_agg(jsonb_build_object('source',source,'score',round(score,1),'data',x) order by score desc) evidence
  from normalized group by entity_key
),ranked as(select * from grouped order by source_count desc,radar_score desc limit(select lim from p))
select jsonb_build_object('query_type','market_radar','generated_from_cache_at',now(),'rows',coalesce(jsonb_agg(jsonb_build_object(
  'card_name',card_name,'sku_id',sku_id,'product_id',product_id,'set_code',set_code,'set_name',set_name,'printing',printing,
  'source_count',source_count,'sources',to_jsonb(sources),'radar_score',radar_score,'bulk_spec_watch',bulk_spec_watch,'bulk_spec_severity',bulk_spec_severity,'bulk_spec_reason',bulk_spec_reason,'evidence',evidence
) order by source_count desc,radar_score desc),'[]'::jsonb)) from ranked;
$function$;

grant execute on function public.ask_sales_acceleration_v1(integer,integer,integer,text,boolean) to service_role;
grant execute on function public.ask_delvin_market_radar_v1(integer) to anon,authenticated,service_role;

-- Refresh the dependent cached surfaces immediately when the migration is applied.
select public.refresh_delvin_query_cache_v1('sales_acceleration',true);
select public.refresh_delvin_query_cache_v1('sales_acceleration_price_lag',true);
select public.refresh_delvin_query_cache_v1('market_radar',true);
