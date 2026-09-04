-- Lifecycle-normalized Collector Booster Display trajectory forecasts.
-- TCGCSV Market and TCGplayer items sold are historical trajectory evidence only.
-- They never replace executable acquisition, liquidation EV, or Scout grades.

create or replace view public.collector_booster_structural_features_v1
with (security_invoker=true) as
with collector_sets as (
  select distinct upper(p.set_code) set_code,
    coalesce(p.release_date,s.released_at) release_date,
    coalesce(s.scryfall_name,s.name,p.set_code) set_name,
    coalesce(s.set_type,'unknown') set_type
  from public.mtgjson_sealed_products p
  left join public.magic_set_catalog s on upper(s.code)=upper(p.set_code)
  where p.category='booster_box' and p.subtype='collector'
    and p.name not ilike '%case%'
    and coalesce(p.release_date,s.released_at) is not null
), dated as (
  select c.*,
    c.release_date-lag(c.release_date) over(order by c.release_date,c.set_code) release_gap_days
  from collector_sets c
), initial_cards as (
  select d.set_code,c.tcgplayer_product_id::bigint product_id,
    coalesce(c.scryfall_oracle_id::text,c.uuid::text) oracle_key,
    coalesce(jsonb_array_length(c.finishes),0) finish_count,
    (coalesce(c.is_full_art,false)
      or coalesce(jsonb_array_length(c.frame_effects),0)>0
      or coalesce(jsonb_array_length(c.promo_types),0)>0) premium_treatment
  from dated d
  join public.mtgjson_cards c on upper(c.set_code)=d.set_code
  where c.tcgplayer_product_id~'^[0-9]+$'
    and (c.release_date is null or c.release_date<=d.release_date+30)
)
select d.set_code,d.set_name,d.set_type,d.release_date,d.release_gap_days,
  count(distinct c.product_id)::integer catalog_products,
  count(distinct c.oracle_key)::integer distinct_cards,
  round(100.0*(count(distinct c.product_id)-count(distinct c.oracle_key))
    /nullif(count(distinct c.product_id),0),2) variant_density_pct,
  round(100.0*count(*) filter(where c.finish_count>1)/nullif(count(*),0),2)
    multi_finish_card_pct,
  round(100.0*count(*) filter(where c.premium_treatment)/nullif(count(*),0),2)
    premium_treatment_pct
from dated d join initial_cards c using(set_code)
group by d.set_code,d.set_name,d.set_type,d.release_date,d.release_gap_days;

revoke all on public.collector_booster_structural_features_v1 from public,anon,authenticated;
grant select on public.collector_booster_structural_features_v1 to service_role;

comment on view public.collector_booster_structural_features_v1 is
  'Release-window structural features for Collector Booster trajectory matching. No future price outcome is included.';

create or replace view public.collector_booster_card_basket_features_v1
with (security_invoker=true) as
with card_map as (
  select f.set_code,c.tcgplayer_product_id::bigint product_id,
    min(coalesce(c.scryfall_oracle_id::text,c.uuid::text)) oracle_key
  from public.collector_booster_structural_features_v1 f
  join public.mtgjson_cards c on upper(c.set_code)=f.set_code
  where c.tcgplayer_product_id~'^[0-9]+$'
    and (c.release_date is null or c.release_date<=f.release_date+30)
  group by f.set_code,c.tcgplayer_product_id::bigint
), price_rows as (
  select c.set_code,h.observed_on,h.product_id,c.oracle_key,h.sub_type_name,h.market_price,
    row_number() over(partition by c.set_code,h.observed_on
      order by h.market_price desc,h.product_id,h.sub_type_name) value_rank
  from card_map c
  join public.modeled_booster_card_price_history h on h.product_id=c.product_id
  where h.market_price>0
)
select set_code,observed_on,count(*)::integer priced_points,
  count(distinct product_id)::integer priced_products,
  count(distinct oracle_key)::integer distinct_priced_cards,
  round(sum(market_price),2) basket_market_value,
  round(100.0*sum(market_price) filter(where value_rank<=10)
    /nullif(sum(market_price),0),2) top10_share_pct,
  round(100.0*count(*) filter(where lower(sub_type_name)<>'normal')
    /nullif(count(*),0),2) premium_price_point_pct
from price_rows group by set_code,observed_on;

revoke all on public.collector_booster_card_basket_features_v1 from public,anon,authenticated;
grant select on public.collector_booster_card_basket_features_v1 to service_role;

comment on view public.collector_booster_card_basket_features_v1 is
  'As-of-date card-value concentration for Collector Booster matching. TCGCSV Market is trajectory evidence only.';

create or replace view public.collector_booster_sales_daily_v1
with (security_invoker=true) as
with deduplicated as (
  select product_id,sku_id,bucket_start_date,
    max(coalesce(quantity_sold,0)) quantity_sold,
    max(coalesce(transaction_count,0)) transaction_count
  from public.marketplace_sku_sales_buckets
  group by product_id,sku_id,bucket_start_date
)
select product_id,bucket_start_date,sum(quantity_sold) quantity_sold,
  sum(transaction_count) transaction_count
from deduplicated group by product_id,bucket_start_date;

revoke all on public.collector_booster_sales_daily_v1 from public,anon,authenticated;
grant select on public.collector_booster_sales_daily_v1 to service_role;

create table if not exists public.collector_booster_card_basket_features_history (
  set_code text not null,
  observed_on date not null,
  priced_points integer not null,
  priced_products integer not null,
  distinct_priced_cards integer not null,
  basket_market_value numeric not null,
  top10_share_pct numeric not null,
  premium_price_point_pct numeric not null,
  refreshed_at timestamptz not null default now(),
  primary key(set_code,observed_on)
);

create table if not exists public.collector_booster_sales_daily_history (
  product_id text not null,
  bucket_start_date date not null,
  quantity_sold numeric not null,
  transaction_count numeric not null,
  refreshed_at timestamptz not null default now(),
  primary key(product_id,bucket_start_date)
);

alter table public.collector_booster_card_basket_features_history enable row level security;
alter table public.collector_booster_sales_daily_history enable row level security;
revoke all on public.collector_booster_card_basket_features_history from public,anon,authenticated;
revoke all on public.collector_booster_sales_daily_history from public,anon,authenticated;
grant select,insert,update,delete on public.collector_booster_card_basket_features_history to service_role;
grant select,insert,update,delete on public.collector_booster_sales_daily_history to service_role;

create or replace function public.refresh_collector_booster_support_features_v1()
returns integer language plpgsql set search_path='' as $$
declare written integer;
begin
  with upserted as (
    insert into public.collector_booster_card_basket_features_history(
      set_code,observed_on,priced_points,priced_products,distinct_priced_cards,
      basket_market_value,top10_share_pct,premium_price_point_pct,refreshed_at
    )
    select set_code,observed_on,priced_points,priced_products,distinct_priced_cards,
      basket_market_value,top10_share_pct,premium_price_point_pct,now()
    from public.collector_booster_card_basket_features_v1
    on conflict(set_code,observed_on) do update set
      priced_points=excluded.priced_points,priced_products=excluded.priced_products,
      distinct_priced_cards=excluded.distinct_priced_cards,
      basket_market_value=excluded.basket_market_value,
      top10_share_pct=excluded.top10_share_pct,
      premium_price_point_pct=excluded.premium_price_point_pct,
      refreshed_at=excluded.refreshed_at
    returning 1
  ) select count(*) into written from upserted;

  insert into public.collector_booster_sales_daily_history(
    product_id,bucket_start_date,quantity_sold,transaction_count,refreshed_at
  )
  select product_id,bucket_start_date,quantity_sold,transaction_count,now()
  from public.collector_booster_sales_daily_v1
  on conflict(product_id,bucket_start_date) do update set
    quantity_sold=excluded.quantity_sold,transaction_count=excluded.transaction_count,
    refreshed_at=excluded.refreshed_at;
  return written;
end $$;

revoke all on function public.refresh_collector_booster_support_features_v1()
  from public,anon,authenticated;
grant execute on function public.refresh_collector_booster_support_features_v1()
  to service_role;

create or replace view public.collector_booster_checkpoint_features_v2
with (security_invoker=true) as
with path as (
  select b.*,(b.checkpoint_date-b.release_date)::integer signed_age_days,
    min(b.checkpoint_market_price) over(partition by b.sealed_uuid order by b.checkpoint_date
      rows between unbounded preceding and current row) market_low_to_date,
    max(b.checkpoint_market_price) over(partition by b.sealed_uuid order by b.checkpoint_date
      rows between unbounded preceding and current row) market_high_to_date
  from public.sealed_product_trajectory_backtest_points_current b
), enriched as (
  select p.*,s.set_name,s.set_type,s.release_gap_days,s.catalog_products,
    s.distinct_cards,s.variant_density_pct,s.multi_finish_card_pct,
    s.premium_treatment_pct,
    basket.observed_on basket_observed_on,basket.priced_products,
    basket.basket_market_value,basket.top10_share_pct,
    basket.premium_price_point_pct,
    sales.units_sold_30d,sales.transactions_30d
  from path p
  join public.collector_booster_structural_features_v1 s using(set_code,release_date)
  left join lateral (
    select b.* from public.collector_booster_card_basket_features_history b
    where b.set_code=p.set_code and b.observed_on<=p.checkpoint_date
      and b.observed_on>=p.checkpoint_date-10
    order by b.observed_on desc limit 1
  ) basket on true
  left join lateral (
    select sum(d.quantity_sold) units_sold_30d,
      sum(d.transaction_count) transactions_30d
    from public.collector_booster_sales_daily_history d
    where d.product_id=p.product_id::text
      and d.bucket_start_date between p.checkpoint_date-29 and p.checkpoint_date
  ) sales on true
)
select e.*,
  case
    when signed_age_days<0 then 'PRE_RELEASE'
    when change_30d_pct<=-8 and change_90d_pct>5 then 'REVERSAL'
    when signed_age_days<=180 and coalesce(change_90d_pct,change_30d_pct,0)<=-8
      then 'LAUNCH_COMPRESSION'
    when signed_age_days>=365 and change_90d_pct>=0
      and checkpoint_market_price>=market_low_to_date*1.30 then 'APPRECIATION'
    when change_90d_pct>=10 and checkpoint_market_price>=market_low_to_date*1.20
      then 'SCARCITY_TURN'
    when abs(coalesce(change_30d_pct,0))<=5 and abs(coalesce(change_90d_pct,0))<=10
      then 'STABILIZATION'
    else 'MIXED'
  end lifecycle_stage,
  jsonb_strip_nulls(jsonb_build_object(
    'age_days',signed_age_days,'market_price',checkpoint_market_price,
    'change_30d_pct',change_30d_pct,'change_90d_pct',change_90d_pct,
    'catalog_products',catalog_products,'variant_density_pct',variant_density_pct,
    'multi_finish_card_pct',multi_finish_card_pct,
    'premium_treatment_pct',premium_treatment_pct,'release_gap_days',release_gap_days,
    'set_type',set_type,'basket_market_value',basket_market_value,
    'top10_share_pct',top10_share_pct,
    'premium_price_point_pct',premium_price_point_pct,
    'units_sold_30d',units_sold_30d
  )) feature_vector
from enriched e;

revoke all on public.collector_booster_checkpoint_features_v2 from public,anon,authenticated;
grant select on public.collector_booster_checkpoint_features_v2 to service_role;

create or replace view public.collector_booster_checkpoint_outcomes_v2
with (security_invoker=true) as
select f.*,hz.horizon_days,o.observed_on horizon_outcome_date,
  (o.observed_on-f.checkpoint_date)::integer actual_days,
  o.market_price horizon_outcome_market_price,
  round(100*(o.market_price/nullif(f.checkpoint_market_price,0)-1),2) actual_return_pct
from public.collector_booster_checkpoint_features_v2 f
cross join (values (90::smallint),(180::smallint),(365::smallint)) hz(horizon_days)
join lateral (
  select h.observed_on,h.market_price
  from public.sealed_product_market_history h
  where h.product_id=f.product_id and h.sub_type_name='Normal' and h.market_price>0
    and h.observed_on between f.checkpoint_date+hz.horizon_days-7
      and f.checkpoint_date+hz.horizon_days+14
  order by abs(h.observed_on-(f.checkpoint_date+hz.horizon_days)),h.observed_on
  limit 1
) o on true;

revoke all on public.collector_booster_checkpoint_outcomes_v2 from public,anon,authenticated;
grant select on public.collector_booster_checkpoint_outcomes_v2 to service_role;

comment on view public.collector_booster_checkpoint_outcomes_v2 is
  'Observed 90/180/365-day Collector Booster outcomes. Outcomes may be at most seven days early and are never inferred.';

create or replace function public.collector_booster_similarity_score_v2(
  p_target jsonb,p_analog jsonb
)
returns numeric language sql immutable parallel safe set search_path='' as $$
  select round(greatest(0,100
    -least(18,abs(coalesce((p_target->>'age_days')::numeric,0)
      -coalesce((p_analog->>'age_days')::numeric,0))*.10)
    -least(14,abs(ln(greatest(coalesce((p_target->>'market_price')::numeric,1),1)
      /greatest(coalesce((p_analog->>'market_price')::numeric,1),1)))*10)
    -least(12,abs(coalesce((p_target->>'change_30d_pct')::numeric,0)
      -coalesce((p_analog->>'change_30d_pct')::numeric,0))*.30)
    -least(12,abs(coalesce((p_target->>'change_90d_pct')::numeric,0)
      -coalesce((p_analog->>'change_90d_pct')::numeric,0))*.18)
    -least(9,abs(coalesce((p_target->>'catalog_products')::numeric,0)
      -coalesce((p_analog->>'catalog_products')::numeric,0))
      /greatest(coalesce((p_target->>'catalog_products')::numeric,1),1)*18)
    -least(8,abs(coalesce((p_target->>'variant_density_pct')::numeric,0)
      -coalesce((p_analog->>'variant_density_pct')::numeric,0))*.20)
    -least(7,abs(coalesce((p_target->>'premium_treatment_pct')::numeric,0)
      -coalesce((p_analog->>'premium_treatment_pct')::numeric,0))*.14)
    -least(6,abs(coalesce((p_target->>'release_gap_days')::numeric,49)
      -coalesce((p_analog->>'release_gap_days')::numeric,49))/6)
    -case when coalesce(p_target->>'set_type','unknown')=coalesce(p_analog->>'set_type','unknown')
      then 0 else 6 end
    -case when p_target->>'basket_market_value' is not null
          and p_analog->>'basket_market_value' is not null
      then least(6,abs(ln(greatest((p_target->>'basket_market_value')::numeric,1)
        /greatest((p_analog->>'basket_market_value')::numeric,1)))*4) else 2 end
    -case when p_target->>'top10_share_pct' is not null
          and p_analog->>'top10_share_pct' is not null
      then least(6,abs((p_target->>'top10_share_pct')::numeric
        -(p_analog->>'top10_share_pct')::numeric)*.15) else 2 end
    -case when p_target->>'units_sold_30d' is not null
          and p_analog->>'units_sold_30d' is not null
      then least(8,abs(ln((greatest((p_target->>'units_sold_30d')::numeric,0)+.25)
        /(greatest((p_analog->>'units_sold_30d')::numeric,0)+.25)))*5) else 3 end
  ),2)
$$;

revoke all on function public.collector_booster_similarity_score_v2(jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.collector_booster_similarity_score_v2(jsonb,jsonb)
  to service_role;

create table if not exists public.collector_booster_trajectory_forecast_current (
  sealed_uuid uuid not null,
  horizon_days smallint not null check(horizon_days in(90,180,365)),
  product_id bigint not null,
  product_name text not null,
  set_code text not null,
  release_date date not null,
  baseline_date date not null,
  lifecycle_age_days integer not null,
  lifecycle_stage text not null,
  current_market_price numeric not null,
  analog_count integer not null,
  median_return_pct numeric not null,
  downside_return_pct numeric not null,
  upside_return_pct numeric not null,
  pooled_return_pct numeric,
  projected_market_price numeric not null,
  average_similarity_score numeric not null,
  confidence_label text not null check(confidence_label in('LOW','MEDIUM','HIGH')),
  forecast_status text not null check(forecast_status in('READY','BUILDING_HISTORY')),
  promotion_status text not null check(promotion_status in('SHADOW','PRIMARY')),
  backtest_samples integer not null default 0,
  backtest_products integer not null default 0,
  direction_accuracy_pct numeric,
  median_absolute_error_pct numeric,
  pooled_median_absolute_error_pct numeric,
  model_version text not null,
  target_features jsonb not null default '{}'::jsonb,
  analogs jsonb not null default '[]'::jsonb,
  refreshed_at timestamptz not null default now(),
  primary key(sealed_uuid,horizon_days)
);

create index if not exists collector_booster_trajectory_set_horizon_idx
  on public.collector_booster_trajectory_forecast_current(set_code,horizon_days,release_date desc);

alter table public.collector_booster_trajectory_forecast_current enable row level security;
revoke all on public.collector_booster_trajectory_forecast_current from public,anon,authenticated;
grant select on public.collector_booster_trajectory_forecast_current to authenticated,service_role;
grant insert,update,delete on public.collector_booster_trajectory_forecast_current to service_role;

drop policy if exists collector_booster_trajectory_read
  on public.collector_booster_trajectory_forecast_current;
create policy collector_booster_trajectory_read
on public.collector_booster_trajectory_forecast_current for select
to authenticated using(true);

create or replace function public.refresh_collector_booster_trajectory_forecasts()
returns integer language plpgsql set search_path='' as $$
declare written integer;
begin
  perform public.refresh_collector_booster_support_features_v1();

  drop table if exists pg_temp.collector_booster_checkpoint_features_work;
  create temporary table collector_booster_checkpoint_features_work
  on commit drop as
  select * from public.collector_booster_checkpoint_features_v2;
  create index on collector_booster_checkpoint_features_work(sealed_uuid,checkpoint_date desc);
  create index on collector_booster_checkpoint_features_work(release_date,signed_age_days);

  drop table if exists pg_temp.collector_booster_checkpoint_outcomes_work;
  create temporary table collector_booster_checkpoint_outcomes_work
  on commit drop as
  select f.*,hz.horizon_days,o.observed_on horizon_outcome_date,
    (o.observed_on-f.checkpoint_date)::integer actual_days,
    o.market_price horizon_outcome_market_price,
    round(100*(o.market_price/nullif(f.checkpoint_market_price,0)-1),2) actual_return_pct
  from pg_temp.collector_booster_checkpoint_features_work f
  cross join (values (90::smallint),(180::smallint),(365::smallint)) hz(horizon_days)
  join lateral (
    select h.observed_on,h.market_price
    from public.sealed_product_market_history h
    where h.product_id=f.product_id and h.sub_type_name='Normal' and h.market_price>0
      and h.observed_on between f.checkpoint_date+hz.horizon_days-7
        and f.checkpoint_date+hz.horizon_days+14
    order by abs(h.observed_on-(f.checkpoint_date+hz.horizon_days)),h.observed_on
    limit 1
  ) o on true;
  create index on collector_booster_checkpoint_outcomes_work(
    horizon_days,release_date,horizon_outcome_date,signed_age_days
  );
  analyze collector_booster_checkpoint_features_work;
  analyze collector_booster_checkpoint_outcomes_work;

  with current_targets as (
    select distinct on(f.sealed_uuid) f.*
    from pg_temp.collector_booster_checkpoint_features_work f
    where f.checkpoint_market_price>0 and f.change_30d_pct is not null
    order by f.sealed_uuid,f.checkpoint_date desc
  ), current_candidates_raw as (
    select t.sealed_uuid target_sealed_uuid,t.product_id target_product_id,
      t.product_name target_product_name,t.set_code target_set_code,
      t.release_date target_release_date,t.checkpoint_date target_checkpoint_date,
      t.signed_age_days target_age_days,t.lifecycle_stage target_stage,
      t.checkpoint_market_price target_market_price,t.feature_vector target_features,
      a.horizon_days,a.sealed_uuid analog_sealed_uuid,a.product_name analog_product_name,
      a.set_code analog_set_code,a.checkpoint_date analog_checkpoint_date,
      a.signed_age_days analog_age_days,a.lifecycle_stage analog_stage,
      a.horizon_outcome_date analog_outcome_date,a.actual_return_pct analog_return_pct,
      a.units_sold_30d analog_units_sold_30d,a.top10_share_pct analog_top10_share_pct,
      public.collector_booster_similarity_score_v2(t.feature_vector,a.feature_vector)
        similarity_score,
      row_number() over(partition by t.sealed_uuid,a.horizon_days,a.sealed_uuid
        order by public.collector_booster_similarity_score_v2(t.feature_vector,a.feature_vector) desc,
          abs(t.signed_age_days-a.signed_age_days),a.checkpoint_date desc) analog_point_rank
    from current_targets t
    join pg_temp.collector_booster_checkpoint_outcomes_work a
      on a.sealed_uuid<>t.sealed_uuid
      and a.release_date<=t.release_date-120
      and a.horizon_outcome_date<=t.checkpoint_date
      and abs(a.signed_age_days-t.signed_age_days)<=case
        when t.signed_age_days<180 then 45 when t.signed_age_days<730 then 90 else 180 end
    where a.change_30d_pct is not null
  ), current_candidates as (
    select * from current_candidates_raw where analog_point_rank=1
  ), current_pooled as (
    select target_sealed_uuid,horizon_days,
      round(percentile_cont(.5) within group(order by analog_return_pct)::numeric,2)
        pooled_return_pct
    from current_candidates group by target_sealed_uuid,horizon_days
  ), current_ranked as (
    select c.*,row_number() over(partition by target_sealed_uuid,horizon_days
      order by similarity_score desc,analog_outcome_date desc,analog_set_code) analog_rank
    from current_candidates c
  ), current_weights as (
    select r.*,power(greatest(similarity_score,1)/100.0,3) analog_weight
    from current_ranked r where analog_rank<=5
  ), current_ordered as (
    select w.*,
      sum(analog_weight) over(partition by target_sealed_uuid,horizon_days
        order by analog_return_pct,analog_set_code rows unbounded preceding) cumulative_weight,
      sum(analog_weight) over(partition by target_sealed_uuid,horizon_days) total_weight
    from current_weights w
  ), current_forecasts as (
    select target_sealed_uuid,target_product_id,target_product_name,target_set_code,
      target_release_date,target_checkpoint_date,target_age_days,target_stage,
      target_market_price,target_features,horizon_days,count(*)::integer analog_count,
      min(analog_return_pct) filter(where cumulative_weight>=total_weight*.50) median_return_pct,
      min(analog_return_pct) filter(where cumulative_weight>=total_weight*.25) downside_return_pct,
      min(analog_return_pct) filter(where cumulative_weight>=total_weight*.75) upside_return_pct,
      round(avg(similarity_score),2) average_similarity_score,
      jsonb_agg(jsonb_build_object(
        'rank',analog_rank,'sealed_uuid',analog_sealed_uuid,'product_name',analog_product_name,
        'set_code',analog_set_code,'checkpoint_date',analog_checkpoint_date,
        'age_days',analog_age_days,'stage',analog_stage,
        'similarity_score',similarity_score,'return_pct',analog_return_pct,
        'outcome_date',analog_outcome_date,'units_sold_30d',analog_units_sold_30d,
        'top10_share_pct',analog_top10_share_pct,
        'weight',round(analog_weight::numeric,4)
      ) order by analog_rank) analogs
    from current_ordered
    group by target_sealed_uuid,target_product_id,target_product_name,target_set_code,
      target_release_date,target_checkpoint_date,target_age_days,target_stage,
      target_market_price,target_features,horizon_days
  ), test_target_periods as (
    select o.*,
      ((o.checkpoint_date-date '2024-02-08')/28)::integer checkpoint_period,
      row_number() over(partition by o.sealed_uuid,o.horizon_days,
        ((o.checkpoint_date-date '2024-02-08')/28)::integer
        order by o.checkpoint_date desc) period_rank
    from pg_temp.collector_booster_checkpoint_outcomes_work o
    where o.change_30d_pct is not null
  ), test_targets as (
    select * from test_target_periods where period_rank=1
  ), test_candidates_raw as (
    select t.sealed_uuid target_sealed_uuid,t.horizon_days,t.checkpoint_date,
      t.actual_return_pct target_actual_return_pct,
      a.sealed_uuid analog_sealed_uuid,a.actual_return_pct analog_return_pct,
      a.horizon_outcome_date analog_outcome_date,
      public.collector_booster_similarity_score_v2(t.feature_vector,a.feature_vector)
        similarity_score,
      row_number() over(partition by t.sealed_uuid,t.horizon_days,t.checkpoint_date,a.sealed_uuid
        order by public.collector_booster_similarity_score_v2(t.feature_vector,a.feature_vector) desc,
          abs(t.signed_age_days-a.signed_age_days),a.checkpoint_date desc) analog_point_rank
    from test_targets t
    join pg_temp.collector_booster_checkpoint_outcomes_work a
      on a.horizon_days=t.horizon_days and a.sealed_uuid<>t.sealed_uuid
      and a.release_date<=t.release_date-120
      and a.horizon_outcome_date<=t.checkpoint_date
      and abs(a.signed_age_days-t.signed_age_days)<=case
        when t.signed_age_days<180 then 45 when t.signed_age_days<730 then 90 else 180 end
    where a.change_30d_pct is not null
  ), test_candidates as (
    select * from test_candidates_raw where analog_point_rank=1
  ), test_pooled as (
    select target_sealed_uuid,horizon_days,checkpoint_date,
      percentile_cont(.5) within group(order by analog_return_pct)::numeric pooled_prediction
    from test_candidates
    group by target_sealed_uuid,horizon_days,checkpoint_date
  ), test_ranked as (
    select c.*,row_number() over(partition by target_sealed_uuid,horizon_days,checkpoint_date
      order by similarity_score desc,analog_outcome_date desc,analog_sealed_uuid) analog_rank
    from test_candidates c
  ), test_weights as (
    select r.*,power(greatest(similarity_score,1)/100.0,3) analog_weight
    from test_ranked r where analog_rank<=5
  ), test_ordered as (
    select w.*,
      sum(analog_weight) over(partition by target_sealed_uuid,horizon_days,checkpoint_date
        order by analog_return_pct,analog_sealed_uuid rows unbounded preceding) cumulative_weight,
      sum(analog_weight) over(partition by target_sealed_uuid,horizon_days,checkpoint_date)
        total_weight
    from test_weights w
  ), test_predictions as (
    select w.target_sealed_uuid,w.horizon_days,w.checkpoint_date,
      max(w.target_actual_return_pct) target_actual_return_pct,count(*)::integer analog_count,
      min(w.analog_return_pct) filter(where w.cumulative_weight>=w.total_weight*.50) prediction,
      max(p.pooled_prediction) pooled_prediction
    from test_ordered w join test_pooled p
      using(target_sealed_uuid,horizon_days,checkpoint_date)
    group by w.target_sealed_uuid,w.horizon_days,w.checkpoint_date
    having count(*)>=3
  ), backtests as (
    select horizon_days,count(*)::integer sample_count,
      count(distinct target_sealed_uuid)::integer product_count,
      round(100.0*count(*) filter(where sign(prediction)=sign(target_actual_return_pct))
        /nullif(count(*),0),1) direction_accuracy_pct,
      round(percentile_cont(.5) within group(order by abs(prediction-target_actual_return_pct))::numeric,2)
        median_absolute_error_pct,
      round(percentile_cont(.5) within group(order by abs(pooled_prediction-target_actual_return_pct))::numeric,2)
        pooled_median_absolute_error_pct
    from test_predictions group by horizon_days
  ), upserted as (
    insert into public.collector_booster_trajectory_forecast_current(
      sealed_uuid,horizon_days,product_id,product_name,set_code,release_date,baseline_date,
      lifecycle_age_days,lifecycle_stage,current_market_price,analog_count,
      median_return_pct,downside_return_pct,upside_return_pct,pooled_return_pct,
      projected_market_price,average_similarity_score,confidence_label,forecast_status,
      promotion_status,backtest_samples,backtest_products,direction_accuracy_pct,
      median_absolute_error_pct,pooled_median_absolute_error_pct,model_version,
      target_features,analogs,refreshed_at
    )
    select f.target_sealed_uuid,f.horizon_days,f.target_product_id,f.target_product_name,
      f.target_set_code,f.target_release_date,f.target_checkpoint_date,f.target_age_days,
      f.target_stage,round(f.target_market_price,2),f.analog_count,
      round(f.median_return_pct,2),round(f.downside_return_pct,2),
      round(f.upside_return_pct,2),p.pooled_return_pct,
      round(f.target_market_price*(1+f.median_return_pct/100),2),
      f.average_similarity_score,
      case
        when f.analog_count>=5 and coalesce(b.product_count,0)>=12
          and coalesce(b.sample_count,0)>=50
          and b.median_absolute_error_pct<=b.pooled_median_absolute_error_pct then 'HIGH'
        when f.analog_count>=5 and coalesce(b.product_count,0)>=8
          and coalesce(b.sample_count,0)>=25 then 'MEDIUM'
        else 'LOW'
      end,
      case when f.analog_count>=3 then 'READY' else 'BUILDING_HISTORY' end,
      case when f.analog_count>=5 and coalesce(b.product_count,0)>=8
          and coalesce(b.sample_count,0)>=30 and b.direction_accuracy_pct>=55
          and b.median_absolute_error_pct<=b.pooled_median_absolute_error_pct
        then 'PRIMARY' else 'SHADOW' end,
      coalesce(b.sample_count,0),coalesce(b.product_count,0),b.direction_accuracy_pct,
      b.median_absolute_error_pct,b.pooled_median_absolute_error_pct,
      'collector-lifecycle-similarity-v2',
      f.target_features||jsonb_build_object('lifecycle_stage',f.target_stage),
      f.analogs,now()
    from current_forecasts f
    join current_pooled p on p.target_sealed_uuid=f.target_sealed_uuid
      and p.horizon_days=f.horizon_days
    left join backtests b on b.horizon_days=f.horizon_days
    on conflict(sealed_uuid,horizon_days) do update set
      product_id=excluded.product_id,product_name=excluded.product_name,
      set_code=excluded.set_code,release_date=excluded.release_date,
      baseline_date=excluded.baseline_date,lifecycle_age_days=excluded.lifecycle_age_days,
      lifecycle_stage=excluded.lifecycle_stage,current_market_price=excluded.current_market_price,
      analog_count=excluded.analog_count,median_return_pct=excluded.median_return_pct,
      downside_return_pct=excluded.downside_return_pct,
      upside_return_pct=excluded.upside_return_pct,pooled_return_pct=excluded.pooled_return_pct,
      projected_market_price=excluded.projected_market_price,
      average_similarity_score=excluded.average_similarity_score,
      confidence_label=excluded.confidence_label,forecast_status=excluded.forecast_status,
      promotion_status=excluded.promotion_status,backtest_samples=excluded.backtest_samples,
      backtest_products=excluded.backtest_products,
      direction_accuracy_pct=excluded.direction_accuracy_pct,
      median_absolute_error_pct=excluded.median_absolute_error_pct,
      pooled_median_absolute_error_pct=excluded.pooled_median_absolute_error_pct,
      model_version=excluded.model_version,target_features=excluded.target_features,
      analogs=excluded.analogs,refreshed_at=excluded.refreshed_at
    returning 1
  ) select count(*) into written from upserted;

  delete from public.collector_booster_trajectory_forecast_current f
  where not exists(
    select 1 from public.collector_booster_checkpoint_features_v2 x
    where x.sealed_uuid=f.sealed_uuid
  );
  return written;
end $$;

revoke all on function public.refresh_collector_booster_trajectory_forecasts()
  from public,anon,authenticated;
grant execute on function public.refresh_collector_booster_trajectory_forecasts()
  to service_role;

comment on table public.collector_booster_trajectory_forecast_current is
  'Lifecycle-age-matched 90/180/365-day Collector Booster trajectory evidence. SHADOW rows never alter executable EV, acquisition decisions, or Scout grades.';

insert into public.data_preservation_registry(
  table_name,data_class,preservation_tier,minimum_granularity,future_features,
  authoritative_source,can_rebuild,destructive_change_blocked,notes,reviewed_at
)
values(
  'collector_booster_trajectory_forecast_current','current_state','REBUILDABLE',
  'One Collector Booster Display and forecast horizon',
  array['Lifecycle-normalized sealed analogs','Scarcity-turn detection','Collector Box forward calibration']::text[],
  false,true,false,
  'Derived from preserved TCGCSV Market history and TCGplayer items-sold buckets. Market is trajectory evidence only.',now()
)
on conflict(table_name) do update set
  minimum_granularity=excluded.minimum_granularity,
  future_features=excluded.future_features,notes=excluded.notes,reviewed_at=now();

select public.refresh_collector_booster_trajectory_forecasts();

notify pgrst,'reload schema';
