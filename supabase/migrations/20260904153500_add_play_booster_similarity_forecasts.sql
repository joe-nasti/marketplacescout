-- Explainable, release-time Play Booster similarity forecasts.
-- TCGCSV Market is trajectory evidence only. Executable EV continues to use
-- the Direct-first / TCG Low fallback policy after fees, liquidity, and labor.

create or replace view public.modeled_play_booster_release_features_v1
with (security_invoker=true) as
with play_sets as (
  select distinct upper(p.set_code) set_code,
    coalesce(p.release_date,s.released_at) release_date,
    coalesce(s.scryfall_name,s.name,p.set_code) set_name,
    coalesce(s.set_type,'unknown') set_type
  from public.mtgjson_sealed_products p
  left join public.magic_set_catalog s on upper(s.code)=upper(p.set_code)
  where p.category='booster_pack' and p.subtype='play'
    and coalesce(p.release_date,s.released_at) is not null
), dated_sets as (
  select p.*,
    p.release_date-lag(p.release_date) over(order by p.release_date,p.set_code) release_gap_days
  from play_sets p
), card_traits as (
  select upper(c.set_code) set_code,c.tcgplayer_product_id::bigint product_id,
    min(coalesce(c.scryfall_oracle_id::text,c.uuid::text)) oracle_key
  from public.mtgjson_cards c
  where c.tcgplayer_product_id~'^[0-9]+$'
  group by 1,2
), set_products as (
  select distinct p.set_code,p.release_date,c.product_id,c.oracle_key
  from dated_sets p join card_traits c using(set_code)
), base_candidates as (
  select p.set_code,p.release_date,h.observed_on,
    abs(h.observed_on-p.release_date) distance
  from (select distinct set_code,release_date from set_products) p
  join public.modeled_booster_card_price_history h
    on h.observed_on between p.release_date-7 and p.release_date+14
  group by 1,2,3
), base_dates as (
  select distinct on(set_code) set_code,release_date,observed_on
  from base_candidates
  order by set_code,distance,observed_on
), baseline_rows as (
  select p.set_code,b.observed_on baseline_date,h.product_id,p.oracle_key,
    h.sub_type_name,h.market_price,
    row_number() over(
      partition by p.set_code
      order by h.market_price desc,h.product_id,h.sub_type_name
    ) value_rank
  from set_products p
  join base_dates b using(set_code,release_date)
  join public.modeled_booster_card_price_history h
    on h.product_id=p.product_id and h.observed_on=b.observed_on
    and h.market_price>0
)
select d.set_code,d.set_name,d.set_type,d.release_date,d.release_gap_days,
  min(b.baseline_date) baseline_date,count(*)::integer priced_points,
  count(distinct b.product_id)::integer priced_products,
  count(distinct b.oracle_key)::integer distinct_cards,
  round(100.0*(count(distinct b.product_id)-count(distinct b.oracle_key))
    /nullif(count(distinct b.product_id),0),2) variant_density_pct,
  round(sum(b.market_price),2) launch_basket_value,
  round(100.0*sum(b.market_price) filter(where b.value_rank<=10)
    /nullif(sum(b.market_price),0),2) top10_share_pct,
  round(100.0*count(*) filter(where lower(b.sub_type_name)<>'normal')
    /nullif(count(*),0),2) premium_price_point_pct
from dated_sets d join baseline_rows b using(set_code)
group by d.set_code,d.set_name,d.set_type,d.release_date,d.release_gap_days;

revoke all on public.modeled_play_booster_release_features_v1 from public,anon,authenticated;
grant select on public.modeled_play_booster_release_features_v1 to service_role;

comment on view public.modeled_play_booster_release_features_v1 is
  'Release-time-only Play Booster similarity features. Launch basket values use TCGCSV Market solely for trajectory matching.';

create or replace view public.modeled_play_booster_cohort_outcomes_v1
with (security_invoker=true) as
with set_products as (
  select distinct f.set_code,f.release_date,c.tcgplayer_product_id::bigint product_id
  from public.modeled_play_booster_release_features_v1 f
  join public.mtgjson_cards c on upper(c.set_code)=f.set_code
  where c.tcgplayer_product_id~'^[0-9]+$'
), horizons as (
  select unnest(array[30,60,90])::smallint horizon_days
), horizon_candidates as (
  select p.set_code,p.release_date,hz.horizon_days,h.observed_on,
    abs(h.observed_on-(p.release_date+hz.horizon_days)) distance
  from (select distinct set_code,release_date from set_products) p
  cross join horizons hz
  join public.modeled_booster_card_price_history h
    on h.observed_on between p.release_date+hz.horizon_days-3
      and p.release_date+hz.horizon_days+10
  group by 1,2,3,4
), horizon_dates as (
  select distinct on(set_code,horizon_days)
    set_code,release_date,horizon_days,observed_on
  from horizon_candidates
  order by set_code,horizon_days,distance,observed_on
)
select p.set_code,h.horizon_days,f.baseline_date,h.observed_on horizon_date,
  (h.observed_on-p.release_date)::integer actual_days,
  count(*)::integer matched_prices,
  round((100*(sum(p1.market_price)/nullif(sum(p0.market_price),0)-1))::numeric,2) change_pct
from set_products p
join public.modeled_play_booster_release_features_v1 f using(set_code,release_date)
join horizon_dates h using(set_code,release_date)
join public.modeled_booster_card_price_history p0
  on p0.product_id=p.product_id and p0.observed_on=f.baseline_date
  and p0.market_price>0
join public.modeled_booster_card_price_history p1
  on p1.product_id=p0.product_id and p1.sub_type_name=p0.sub_type_name
  and p1.observed_on=h.observed_on and p1.market_price>0
group by p.set_code,h.horizon_days,f.baseline_date,h.observed_on,p.release_date
having count(*)>=100;

revoke all on public.modeled_play_booster_cohort_outcomes_v1 from public,anon,authenticated;
grant select on public.modeled_play_booster_cohort_outcomes_v1 to service_role;

comment on view public.modeled_play_booster_cohort_outcomes_v1 is
  'Mature Play Booster outcomes. A sampled horizon must be no more than three days early, preventing incomplete cohorts from being promoted.';

create or replace function public.modeled_play_booster_similarity_score(
  p_target_basket numeric,p_analog_basket numeric,
  p_target_products integer,p_analog_products integer,
  p_target_top10 numeric,p_analog_top10 numeric,
  p_target_variants numeric,p_analog_variants numeric,
  p_target_premium_points numeric,p_analog_premium_points numeric,
  p_target_gap integer,p_analog_gap integer,
  p_target_set_type text,p_analog_set_type text
)
returns numeric language sql immutable parallel safe set search_path='' as $$
  select round(greatest(0,100
    -least(25,abs(ln(greatest(p_target_basket,1)/greatest(p_analog_basket,1)))*22)
    -least(20,abs(p_target_products-p_analog_products)::numeric/greatest(p_target_products,1)*25)
    -least(20,abs(p_target_top10-p_analog_top10)*.5)
    -least(15,abs(p_target_variants-p_analog_variants)*.4)
    -least(8,abs(p_target_premium_points-p_analog_premium_points)*.5)
    -least(8,abs(coalesce(p_target_gap,49)-coalesce(p_analog_gap,49))::numeric/3)
    -case when p_target_set_type=p_analog_set_type then 0 else 12 end
  ),2)
$$;

revoke all on function public.modeled_play_booster_similarity_score(
  numeric,numeric,integer,integer,numeric,numeric,numeric,numeric,numeric,numeric,
  integer,integer,text,text
) from public,anon,authenticated;
grant execute on function public.modeled_play_booster_similarity_score(
  numeric,numeric,integer,integer,numeric,numeric,numeric,numeric,numeric,numeric,
  integer,integer,text,text
) to service_role;

create table if not exists public.modeled_play_booster_similarity_forecast_current (
  set_code text not null,
  horizon_days smallint not null check(horizon_days in(30,60,90)),
  set_name text not null,
  release_date date not null,
  baseline_date date not null,
  analog_count integer not null,
  median_change_pct numeric not null,
  downside_change_pct numeric not null,
  upside_change_pct numeric not null,
  pooled_change_pct numeric,
  average_similarity_score numeric not null,
  confidence_label text not null check(confidence_label in('LOW','MEDIUM','HIGH')),
  forecast_status text not null check(forecast_status in('READY','BUILDING_HISTORY')),
  promotion_status text not null check(promotion_status in('SHADOW','PRIMARY')),
  backtest_samples integer not null default 0,
  direction_accuracy_pct numeric,
  median_absolute_error_pct numeric,
  pooled_median_absolute_error_pct numeric,
  model_version text not null,
  target_features jsonb not null default '{}'::jsonb,
  analogs jsonb not null default '[]'::jsonb,
  refreshed_at timestamptz not null default now(),
  primary key(set_code,horizon_days)
);

create index if not exists modeled_play_booster_similarity_release_idx
  on public.modeled_play_booster_similarity_forecast_current(release_date desc,set_code,horizon_days);

alter table public.modeled_play_booster_similarity_forecast_current enable row level security;
revoke all on public.modeled_play_booster_similarity_forecast_current from public,anon,authenticated;
grant select on public.modeled_play_booster_similarity_forecast_current to authenticated,service_role;
grant insert,update,delete on public.modeled_play_booster_similarity_forecast_current to service_role;

drop policy if exists modeled_play_booster_similarity_read
  on public.modeled_play_booster_similarity_forecast_current;
create policy modeled_play_booster_similarity_read
on public.modeled_play_booster_similarity_forecast_current for select
to authenticated using(true);

create or replace function public.refresh_modeled_booster_ev_calibration()
returns integer language plpgsql set search_path='' as $$
declare written integer;
begin
  with aggregate_rows as (
    select o.horizon_days,count(*)::integer cohort_count,
      round(percentile_cont(.5) within group(order by o.change_pct)::numeric,2) median_change_pct,
      round(percentile_cont(.25) within group(order by o.change_pct)::numeric,2) downside_change_pct,
      round(percentile_cont(.75) within group(order by o.change_pct)::numeric,2) upside_change_pct,
      round(percentile_cont(.5) within group(order by o.matched_prices))::integer median_matched_prices,
      case when count(*)>=3 then 'READY' else 'BUILDING_HISTORY' end calibration_status,
      case when count(*)>=12 then 'HIGH' when count(*)>=6 then 'MEDIUM' else 'LOW' end confidence_label,
      jsonb_build_object(
        'set_codes',jsonb_agg(o.set_code order by o.set_code),
        'cohorts',jsonb_agg(jsonb_build_object(
          'set_code',o.set_code,'baseline_date',o.baseline_date,
          'horizon_date',o.horizon_date,'actual_days',o.actual_days,
          'matched_prices',o.matched_prices,'change_pct',o.change_pct
        ) order by o.set_code),
        'price_basis','TCGCSV Market matched basket',
        'minimum_matched_prices',100,
        'minimum_maturity_days','horizon minus 3 days'
      ) evidence
    from public.modeled_play_booster_cohort_outcomes_v1 o
    group by o.horizon_days
  ), upserted as (
    insert into public.modeled_booster_ev_calibration_current(
      horizon_days,cohort_count,median_change_pct,downside_change_pct,upside_change_pct,
      median_matched_prices,calibration_status,confidence_label,model_version,evidence,refreshed_at
    )
    select horizon_days,cohort_count,median_change_pct,downside_change_pct,upside_change_pct,
      median_matched_prices,calibration_status,confidence_label,
      'play-market-basket-v2-mature-horizons',evidence,now()
    from aggregate_rows
    on conflict(horizon_days) do update set
      cohort_count=excluded.cohort_count,median_change_pct=excluded.median_change_pct,
      downside_change_pct=excluded.downside_change_pct,upside_change_pct=excluded.upside_change_pct,
      median_matched_prices=excluded.median_matched_prices,
      calibration_status=excluded.calibration_status,confidence_label=excluded.confidence_label,
      model_version=excluded.model_version,evidence=excluded.evidence,refreshed_at=excluded.refreshed_at
    returning 1
  ) select count(*) into written from upserted;

  delete from public.modeled_booster_ev_calibration_current c
  where not exists(
    select 1 from public.modeled_play_booster_cohort_outcomes_v1 o
    where o.horizon_days=c.horizon_days
  );
  return written;
end $$;

revoke all on function public.refresh_modeled_booster_ev_calibration() from public,anon,authenticated;
grant execute on function public.refresh_modeled_booster_ev_calibration() to service_role;

create or replace function public.refresh_modeled_play_booster_similarity_forecasts()
returns integer language plpgsql set search_path='' as $$
declare written integer;
begin
  with candidate_scores as (
    select t.set_code target_set_code,t.set_name target_set_name,
      t.release_date target_release_date,t.baseline_date target_baseline_date,
      o.horizon_days,a.set_code analog_set_code,a.set_name analog_set_name,
      o.horizon_date analog_horizon_date,o.change_pct analog_change_pct,
      public.modeled_play_booster_similarity_score(
        t.launch_basket_value,a.launch_basket_value,t.priced_products,a.priced_products,
        t.top10_share_pct,a.top10_share_pct,t.variant_density_pct,a.variant_density_pct,
        t.premium_price_point_pct,a.premium_price_point_pct,
        t.release_gap_days,a.release_gap_days,t.set_type,a.set_type
      ) similarity_score,
      t.launch_basket_value,t.priced_products,t.distinct_cards,t.top10_share_pct,
      t.variant_density_pct,t.premium_price_point_pct,t.release_gap_days,t.set_type
    from public.modeled_play_booster_release_features_v1 t
    join public.modeled_play_booster_cohort_outcomes_v1 o
      on o.set_code<>t.set_code and o.horizon_date<=t.baseline_date
    join public.modeled_play_booster_release_features_v1 a on a.set_code=o.set_code
  ), ranked as (
    select c.*,row_number() over(
      partition by c.target_set_code,c.horizon_days
      order by c.similarity_score desc,c.analog_horizon_date desc,c.analog_set_code
    ) analog_rank
    from candidate_scores c
  ), selected as (
    select r.*,power(greatest(r.similarity_score,1)/100.0,3) analog_weight
    from ranked r where r.analog_rank<=5
  ), weighted as (
    select s.*,
      sum(s.analog_weight) over(
        partition by s.target_set_code,s.horizon_days
        order by s.analog_change_pct,s.analog_set_code rows unbounded preceding
      ) cumulative_weight,
      sum(s.analog_weight) over(partition by s.target_set_code,s.horizon_days) total_weight
    from selected s
  ), weighted_forecasts as (
    select w.target_set_code,w.target_set_name,w.target_release_date,w.target_baseline_date,
      w.horizon_days,count(*)::integer analog_count,
      min(w.analog_change_pct) filter(where w.cumulative_weight>=w.total_weight*.50) median_change_pct,
      min(w.analog_change_pct) filter(where w.cumulative_weight>=w.total_weight*.25) downside_change_pct,
      min(w.analog_change_pct) filter(where w.cumulative_weight>=w.total_weight*.75) upside_change_pct,
      round(avg(w.similarity_score),2) average_similarity_score,
      max(w.launch_basket_value) launch_basket_value,max(w.priced_products) priced_products,
      max(w.distinct_cards) distinct_cards,max(w.top10_share_pct) top10_share_pct,
      max(w.variant_density_pct) variant_density_pct,
      max(w.premium_price_point_pct) premium_price_point_pct,
      max(w.release_gap_days) release_gap_days,max(w.set_type) set_type,
      jsonb_agg(jsonb_build_object(
        'rank',w.analog_rank,'set_code',w.analog_set_code,'set_name',w.analog_set_name,
        'similarity_score',w.similarity_score,'change_pct',w.analog_change_pct,
        'horizon_date',w.analog_horizon_date,
        'weight',round(w.analog_weight::numeric,4)
      ) order by w.analog_rank) analogs
    from weighted w
    group by w.target_set_code,w.target_set_name,w.target_release_date,
      w.target_baseline_date,w.horizon_days
  ), pooled_predictions as (
    select c.target_set_code,c.horizon_days,
      percentile_cont(.5) within group(order by c.analog_change_pct)::numeric pooled_prediction
    from candidate_scores c group by c.target_set_code,c.horizon_days
  ), test_points as (
    select w.target_set_code,w.horizon_days,w.median_change_pct prediction,
      p.pooled_prediction,o.change_pct actual_change_pct,
      abs(w.median_change_pct-o.change_pct) absolute_error,
      abs(p.pooled_prediction-o.change_pct) pooled_absolute_error
    from weighted_forecasts w
    join pooled_predictions p using(target_set_code,horizon_days)
    join public.modeled_play_booster_cohort_outcomes_v1 o
      on o.set_code=w.target_set_code and o.horizon_days=w.horizon_days
    where w.analog_count>=3
  ), backtests as (
    select t.horizon_days,count(*)::integer sample_count,
      round(100.0*count(*) filter(where sign(t.prediction)=sign(t.actual_change_pct))
        /nullif(count(*),0),1) direction_accuracy_pct,
      round(percentile_cont(.5) within group(order by t.absolute_error)::numeric,2)
        median_absolute_error_pct,
      round(percentile_cont(.5) within group(order by t.pooled_absolute_error)::numeric,2)
        pooled_median_absolute_error_pct
    from test_points t group by t.horizon_days
  ), upserted as (
    insert into public.modeled_play_booster_similarity_forecast_current(
      set_code,horizon_days,set_name,release_date,baseline_date,analog_count,
      median_change_pct,downside_change_pct,upside_change_pct,pooled_change_pct,
      average_similarity_score,confidence_label,forecast_status,promotion_status,
      backtest_samples,direction_accuracy_pct,median_absolute_error_pct,
      pooled_median_absolute_error_pct,model_version,target_features,analogs,refreshed_at
    )
    select w.target_set_code,w.horizon_days,w.target_set_name,w.target_release_date,
      w.target_baseline_date,w.analog_count,round(w.median_change_pct,2),
      round(w.downside_change_pct,2),round(w.upside_change_pct,2),c.median_change_pct,
      w.average_similarity_score,
      case
        when w.analog_count>=10 and coalesce(b.sample_count,0)>=12
          and b.median_absolute_error_pct<=b.pooled_median_absolute_error_pct then 'HIGH'
        when w.analog_count>=5 and coalesce(b.sample_count,0)>=5
          and b.median_absolute_error_pct<=b.pooled_median_absolute_error_pct then 'MEDIUM'
        else 'LOW'
      end,
      case when w.analog_count>=3 then 'READY' else 'BUILDING_HISTORY' end,
      case when w.analog_count>=5 and coalesce(b.sample_count,0)>=5
          and b.median_absolute_error_pct<=b.pooled_median_absolute_error_pct
        then 'PRIMARY' else 'SHADOW' end,
      coalesce(b.sample_count,0),b.direction_accuracy_pct,b.median_absolute_error_pct,
      b.pooled_median_absolute_error_pct,'play-similarity-v1',
      jsonb_build_object(
        'launch_basket_value',w.launch_basket_value,'priced_products',w.priced_products,
        'distinct_cards',w.distinct_cards,'top10_share_pct',w.top10_share_pct,
        'variant_density_pct',w.variant_density_pct,
        'premium_price_point_pct',w.premium_price_point_pct,
        'release_gap_days',w.release_gap_days,'set_type',w.set_type,
        'price_basis','TCGCSV Market release basket; trajectory evidence only'
      ),w.analogs,now()
    from weighted_forecasts w
    left join public.modeled_booster_ev_calibration_current c using(horizon_days)
    left join backtests b using(horizon_days)
    on conflict(set_code,horizon_days) do update set
      set_name=excluded.set_name,release_date=excluded.release_date,
      baseline_date=excluded.baseline_date,analog_count=excluded.analog_count,
      median_change_pct=excluded.median_change_pct,
      downside_change_pct=excluded.downside_change_pct,upside_change_pct=excluded.upside_change_pct,
      pooled_change_pct=excluded.pooled_change_pct,
      average_similarity_score=excluded.average_similarity_score,
      confidence_label=excluded.confidence_label,forecast_status=excluded.forecast_status,
      promotion_status=excluded.promotion_status,backtest_samples=excluded.backtest_samples,
      direction_accuracy_pct=excluded.direction_accuracy_pct,
      median_absolute_error_pct=excluded.median_absolute_error_pct,
      pooled_median_absolute_error_pct=excluded.pooled_median_absolute_error_pct,
      model_version=excluded.model_version,target_features=excluded.target_features,
      analogs=excluded.analogs,refreshed_at=excluded.refreshed_at
    returning 1
  ) select count(*) into written from upserted;

  delete from public.modeled_play_booster_similarity_forecast_current f
  where not exists(
    select 1 from public.modeled_play_booster_release_features_v1 x
    where x.set_code=f.set_code
  );
  return written;
end $$;

revoke all on function public.refresh_modeled_play_booster_similarity_forecasts()
  from public,anon,authenticated;
grant execute on function public.refresh_modeled_play_booster_similarity_forecasts()
  to service_role;

comment on table public.modeled_play_booster_similarity_forecast_current is
  'Similarity-weighted Play Booster trajectory forecasts with strict prior-outcome backtests. SHADOW rows never replace the pooled curve or alter Scout grades.';

select public.refresh_modeled_booster_ev_calibration();
select public.refresh_modeled_play_booster_similarity_forecasts();

notify pgrst,'reload schema';
