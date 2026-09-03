-- Decision support for sealed EV plus lifecycle-normalized trajectory features.
-- Historical analogs use observed TCGplayer marketplace buckets only; they do not
-- infer history outside returned coverage.

create or replace view public.sealed_product_decision_support_current
with (security_invoker=true) as
with latest_bt as (
  select distinct on (user_id,sealed_uuid) *
  from public.sealed_ev_backtests
  order by user_id,sealed_uuid,valuation_as_of desc,created_at desc
), base as (
  select c.*,s.sealed_acquisition_price,b.profile_status,
    bt.sample_count,bt.gross_mean_ev,bt.p90_ev,bt.break_even_probability,
    bt.two_x_probability,bt.five_x_probability,
    coalesce((c.ev_audit->>'expected_card_units')::numeric,0) expected_units,
    coalesce((c.ev_audit->>'stale_route_units')::numeric,0) stale_units,
    case when b.profile_status in ('full','deterministic') then 25 else 0 end collation_points,
    case when c.price_coverage_pct>=98 then 35 when c.price_coverage_pct>=90 then 28
      else greatest(0,round(coalesce(c.price_coverage_pct,0)*.28,0)) end price_points,
    case when coalesce((c.ev_audit->>'expected_card_units')::numeric,0)=0 then 0
      when 100*coalesce((c.ev_audit->>'stale_route_units')::numeric,0)/nullif((c.ev_audit->>'expected_card_units')::numeric,0)<=5 then 20
      when 100*coalesce((c.ev_audit->>'stale_route_units')::numeric,0)/nullif((c.ev_audit->>'expected_card_units')::numeric,0)<=20 then 12 else 4 end freshness_points,
    case when b.profile_status='deterministic' then 20 when bt.sample_count>=100000 then 20
      when bt.sample_count>=10000 then 14 when bt.sample_count is not null then 6 else 0 end simulation_points
  from public.sealed_product_executable_ev_cache c
  left join public.sealed_ev_current s using(user_id,sealed_uuid)
  left join public.sealed_collation_binding_resolved b on b.sealed_uuid=c.sealed_uuid
  left join latest_bt bt on bt.user_id=c.user_id and bt.sealed_uuid=c.sealed_uuid
), scored as (
  select b.*,(collation_points+price_points+freshness_points+simulation_points)::numeric confidence_score,
    case when profile_status='deterministic' then practical_liquidation_ev
      when gross_mean_ev>0 then round(p90_ev/gross_mean_ev*practical_liquidation_ev,4) end practical_p90_estimate
  from base b
)
select s.user_id,s.sealed_uuid,s.practical_p90_estimate,
  s.break_even_probability gross_break_even_probability,
  s.two_x_probability gross_two_x_probability,s.five_x_probability gross_five_x_probability,
  s.confidence_score,
  case when s.confidence_score>=85 then 'HIGH' when s.confidence_score>=65 then 'MEDIUM' else 'LOW' end confidence_label,
  jsonb_strip_nulls(jsonb_build_object(
    'collation',case when s.profile_status in ('full','deterministic') then 'set-specific model' else 'incomplete or provisional model' end,
    'price_coverage_pct',s.price_coverage_pct,
    'stale_route_pct',round(100*s.stale_units/nullif(s.expected_units,0),2),
    'simulation_samples',s.sample_count,
    'distribution',case when s.profile_status='deterministic' then 'exact contents' when s.sample_count is not null then 'scaled Monte Carlo distribution' else 'unavailable' end
  )) confidence_evidence,
  round(s.practical_liquidation_ev/1.15,2) max_buy_for_15pct_roi,
  round(s.practical_p10_estimate,2) downside_break_even_buy,
  'Gross break-even probability comes from the pack simulation at its sealed reference price; practical percentiles scale the simulated shape to executable EV.'::text distribution_caveat
from scored s;

grant select on public.sealed_product_decision_support_current to authenticated,service_role;

create or replace view public.sealed_product_trajectory_features_current
with (security_invoker=true) as
with daily as (
  select b.user_id,p.uuid sealed_uuid,p.category,p.subtype,p.release_date,b.bucket_start_date,
    sum(coalesce(b.quantity_sold,0)) quantity_sold,
    sum(coalesce(b.transaction_count,0)) transaction_count,
    sum(coalesce(b.market_price,0)*greatest(coalesce(b.transaction_count,0),1))
      /nullif(sum(greatest(coalesce(b.transaction_count,0),1)),0) market_price
  from public.marketplace_sku_sales_buckets b
  join public.mtgjson_sealed_products p on p.tcgplayer_product_id=b.product_id
  where b.market_price>0
  group by b.user_id,p.uuid,p.category,p.subtype,p.release_date,b.bucket_start_date
), rollup as (
  select d.user_id,d.sealed_uuid,d.category,d.subtype,d.release_date,
    min(d.bucket_start_date) history_start,max(d.bucket_start_date) history_end,
    count(*) observation_count,sum(d.quantity_sold) units_sold,
    (array_agg(d.market_price order by d.bucket_start_date))[1] market_start,
    (array_agg(d.market_price order by d.bucket_start_date desc))[1] market_current,
    (array_agg(d.market_price order by d.bucket_start_date)
      filter(where d.bucket_start_date>=current_date-30))[1] market_30d_start,
    (array_agg(d.market_price order by d.bucket_start_date)
      filter(where d.bucket_start_date>=current_date-90))[1] market_90d_start,
    sum(d.quantity_sold) filter(where d.bucket_start_date>=current_date-30) units_30d,
    sum(d.quantity_sold) filter(where d.bucket_start_date>=current_date-90) units_90d
  from daily d group by d.user_id,d.sealed_uuid,d.category,d.subtype,d.release_date
)
select r.*,(history_end-history_start+1) history_days,
  round(100*(market_current/ nullif(market_30d_start,0)-1),2) change_30d_pct,
  round(100*(market_current/ nullif(market_90d_start,0)-1),2) change_90d_pct,
  round(coalesce(units_30d,0)/30.0,3) units_per_day_30d,
  round(coalesce(units_90d,0)/90.0,3) units_per_day_90d,
  greatest(0,current_date-release_date) product_age_days
from rollup r;

grant select on public.sealed_product_trajectory_features_current to authenticated,service_role;

create or replace view public.sealed_product_trajectory_backfill_queue
with (security_invoker=true) as
with users as (
  select distinct user_id from public.sealed_set_profiles where enabled
), coverage as (
  select user_id,product_id,min(bucket_start_date) history_start,max(bucket_start_date) history_end,
    max(observed_at) last_fetched_at
  from public.marketplace_sku_sales_buckets group by user_id,product_id
)
select u.user_id,p.uuid sealed_uuid,p.tcgplayer_product_id product_id,p.name,p.release_date,
  c.history_start,c.history_end,c.last_fetched_at,
  coalesce(c.history_end-c.history_start+1,0) history_days
from users u cross join public.mtgjson_sealed_products p
left join coverage c on c.user_id=u.user_id and c.product_id=p.tcgplayer_product_id
where p.category='booster_box' and p.subtype='collector'
  and p.tcgplayer_product_id~'^[0-9]+$'
  and (c.history_start is null or c.history_end-c.history_start<300
    or c.last_fetched_at<now()-interval '7 days');

grant select on public.sealed_product_trajectory_backfill_queue to service_role;

create or replace view public.sealed_product_trajectory_analogs_current
with (security_invoker=true) as
with pairs as (
  select t.user_id,t.sealed_uuid target_sealed_uuid,a.sealed_uuid analog_sealed_uuid,
    a.release_date analog_release_date,a.product_age_days analog_age_days,
    a.market_current analog_market_price,a.change_30d_pct analog_change_30d_pct,
    a.change_90d_pct analog_change_90d_pct,a.units_per_day_30d analog_units_per_day_30d,
    a.history_days analog_history_days,a.observation_count analog_observations,
    round(greatest(0,100
      -coalesce(abs(t.change_30d_pct-a.change_30d_pct),35)*.8
      -coalesce(abs(t.change_90d_pct-a.change_90d_pct),45)*.35
      -abs(ln(greatest(t.market_current,1)/greatest(a.market_current,1)))*10
      -abs(ln((greatest(t.units_per_day_30d,0)+.05)/(greatest(a.units_per_day_30d,0)+.05)))*8
    ),1) similarity_score
  from public.sealed_product_trajectory_features_current t
  join public.sealed_product_trajectory_features_current a
    on a.user_id=t.user_id and a.sealed_uuid<>t.sealed_uuid
    and a.category=t.category and a.subtype=t.subtype
    and a.release_date<=t.release_date-180
  where t.observation_count>=4 and a.observation_count>=4
), ranked as (
  select p.*,row_number() over(partition by user_id,target_sealed_uuid order by similarity_score desc,analog_history_days desc) analog_rank
  from pairs p
)
select r.*,p.name analog_product_name,p.set_code analog_set_code,
  case when r.analog_history_days>=300 and r.analog_observations>=12 then 'MEDIUM' else 'LOW' end analog_confidence,
  'Shape match uses observed 30/90-day price momentum, price scale, and marketplace sales velocity. It is descriptive, not a forecast.'::text analog_caveat
from ranked r join public.mtgjson_sealed_products p on p.uuid=r.analog_sealed_uuid
where r.analog_rank<=3;

grant select on public.sealed_product_trajectory_analogs_current to authenticated,service_role;

do $$ begin perform cron.unschedule('sealed-collector-trajectory-backfill'); exception when others then null; end $$;
select cron.schedule('sealed-collector-trajectory-backfill','17 * * * *',$cron$
  select net.http_post(
    url := 'https://bnsnlikjeogzdubgyvxk.supabase.co/functions/v1/sealed-trajectory-history-sync',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-collectish-cron-key',(select decrypted_secret from vault.decrypted_secrets where name='tcgplayer_price_cron' limit 1)
    ),
    body := '{"limit":8,"range":"year"}'::jsonb,
    timeout_milliseconds := 120000
  );
$cron$);

notify pgrst,'reload schema';
