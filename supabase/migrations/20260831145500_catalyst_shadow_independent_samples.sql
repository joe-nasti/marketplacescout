-- Keep printing-level shadow snapshots, but calibrate on one representative
-- printing per card+catalyst state so reprint count does not inflate evidence.

create or replace view public.market_intel_catalyst_shadow_backtest
with (security_invoker = true)
as
with ranked as (
  select s.*,
    row_number() over (
      partition by s.user_id,
        trim(regexp_replace(lower(s.card_name), '\s*\([^)]*(foil|showcase|borderless|extended art|serialized|retro frame|etched|alternate art|halo foil|rainbow foil|surge foil|galaxy foil)[^)]*\)\s*', ' ', 'gi')),
        s.catalyst_key,
        s.scorer_version
      order by s.official_score desc, s.snapshot_id asc
    ) as calibration_rank
  from public.market_intel_catalyst_shadow_snapshots s
), s as (
  select * from ranked where calibration_rank=1
)
select s.*,
 p0.market_price baseline_market_price,p1.market_price market_price_1d,p3.market_price market_price_3d,p7.market_price market_price_7d,p30.market_price market_price_30d,
 round(100*(p1.market_price-p0.market_price)/nullif(p0.market_price,0),2) market_change_1d_pct,
 round(100*(p3.market_price-p0.market_price)/nullif(p0.market_price,0),2) market_change_3d_pct,
 round(100*(p7.market_price-p0.market_price)/nullif(p0.market_price,0),2) market_change_7d_pct,
 round(100*(p30.market_price-p0.market_price)/nullif(p0.market_price,0),2) market_change_30d_pct,
 coalesce(sa.tx_1d,0) transactions_1d,coalesce(sa.tx_3d,0) transactions_3d,coalesce(sa.tx_7d,0) transactions_7d,coalesce(sa.tx_30d,0) transactions_30d,
 coalesce(sa.qty_1d,0) quantity_1d,coalesce(sa.qty_3d,0) quantity_3d,coalesce(sa.qty_7d,0) quantity_7d,coalesce(sa.qty_30d,0) quantity_30d,
 now()>=s.captured_at+interval '1 day' matured_1d,now()>=s.captured_at+interval '3 days' matured_3d,now()>=s.captured_at+interval '7 days' matured_7d,now()>=s.captured_at+interval '30 days' matured_30d
from s
left join lateral (select market_price from public.tcgplayer_official_sku_price_history h where h.sku_id=s.sku_id::text and h.observed_at<=s.captured_at and h.market_price is not null order by h.observed_at desc limit 1) p0 on true
left join lateral (select market_price from public.tcgplayer_official_sku_price_history h where h.sku_id=s.sku_id::text and h.observed_at>=s.captured_at+interval '1 day' and h.market_price is not null order by h.observed_at limit 1) p1 on true
left join lateral (select market_price from public.tcgplayer_official_sku_price_history h where h.sku_id=s.sku_id::text and h.observed_at>=s.captured_at+interval '3 days' and h.market_price is not null order by h.observed_at limit 1) p3 on true
left join lateral (select market_price from public.tcgplayer_official_sku_price_history h where h.sku_id=s.sku_id::text and h.observed_at>=s.captured_at+interval '7 days' and h.market_price is not null order by h.observed_at limit 1) p7 on true
left join lateral (select market_price from public.tcgplayer_official_sku_price_history h where h.sku_id=s.sku_id::text and h.observed_at>=s.captured_at+interval '30 days' and h.market_price is not null order by h.observed_at limit 1) p30 on true
left join lateral (select
 coalesce(sum(b.transaction_count) filter(where b.bucket_start_date<=(s.captured_at+interval '1 day')::date),0) tx_1d,
 coalesce(sum(b.transaction_count) filter(where b.bucket_start_date<=(s.captured_at+interval '3 days')::date),0) tx_3d,
 coalesce(sum(b.transaction_count) filter(where b.bucket_start_date<=(s.captured_at+interval '7 days')::date),0) tx_7d,
 coalesce(sum(b.transaction_count) filter(where b.bucket_start_date<=(s.captured_at+interval '30 days')::date),0) tx_30d,
 coalesce(sum(b.quantity_sold) filter(where b.bucket_start_date<=(s.captured_at+interval '1 day')::date),0) qty_1d,
 coalesce(sum(b.quantity_sold) filter(where b.bucket_start_date<=(s.captured_at+interval '3 days')::date),0) qty_3d,
 coalesce(sum(b.quantity_sold) filter(where b.bucket_start_date<=(s.captured_at+interval '7 days')::date),0) qty_7d,
 coalesce(sum(b.quantity_sold) filter(where b.bucket_start_date<=(s.captured_at+interval '30 days')::date),0) qty_30d
 from public.marketplace_sku_sales_buckets b where b.user_id=s.user_id and b.sku_id=s.sku_id::text and b.bucket_start_date>s.captured_at::date and b.bucket_start_date<=(s.captured_at+interval '30 days')::date) sa on true;

grant select on public.market_intel_catalyst_shadow_backtest to authenticated;

create or replace view public.market_intel_catalyst_shadow_backtest_summary
with (security_invoker = true)
as
select user_id,scorer_version,
 case when shadow_modifier<=-4 then '-8..-4' when shadow_modifier<0 then '-3..-1' when shadow_modifier=0 then '0' when shadow_modifier<=3 then '+1..+3' when shadow_modifier<=7 then '+4..+7' else '+8..+12' end modifier_band,
 count(*) snapshots,
 count(*) filter(where matured_1d) matured_1d,count(*) filter(where matured_3d) matured_3d,count(*) filter(where matured_7d) matured_7d,count(*) filter(where matured_30d) matured_30d,
 round(avg(market_change_1d_pct) filter(where matured_1d),2) avg_market_change_1d_pct,
 round(avg(market_change_3d_pct) filter(where matured_3d),2) avg_market_change_3d_pct,
 round(avg(market_change_7d_pct) filter(where matured_7d),2) avg_market_change_7d_pct,
 round(avg(market_change_30d_pct) filter(where matured_30d),2) avg_market_change_30d_pct,
 round(avg(transactions_1d) filter(where matured_1d),2) avg_transactions_1d,
 round(avg(transactions_3d) filter(where matured_3d),2) avg_transactions_3d,
 round(avg(transactions_7d) filter(where matured_7d),2) avg_transactions_7d,
 round(avg(transactions_30d) filter(where matured_30d),2) avg_transactions_30d
from public.market_intel_catalyst_shadow_backtest
group by user_id,scorer_version,modifier_band;

grant select on public.market_intel_catalyst_shadow_backtest_summary to authenticated;

create or replace function public.get_catalyst_calibration()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user_id uuid:=auth.uid();v_result jsonb;
begin
 if v_user_id is null then raise exception 'authentication required' using errcode='42501'; end if;
 select jsonb_build_object(
  'bands',coalesce((select jsonb_agg(to_jsonb(x) order by x.scorer_version desc,x.modifier_band) from (select * from public.market_intel_catalyst_shadow_backtest_summary where user_id=v_user_id)x),'[]'::jsonb),
  'proposals',coalesce((select jsonb_agg(to_jsonb(x) order by x.matured_7d desc,x.snapshots desc,x.source_label) from (select * from public.market_intel_catalyst_shadow_weight_proposals where user_id=v_user_id)x),'[]'::jsonb),
  'candidates',coalesce((select jsonb_agg(to_jsonb(x) order by x.decided_at desc nulls last,x.source_label) from (select * from public.market_intel_catalyst_candidate_weights where user_id=v_user_id)x),'[]'::jsonb),
  'shots',coalesce((select jsonb_agg(to_jsonb(x) order by x.captured_at desc) from (select snapshot_id,future_release,captured_at from public.market_intel_catalyst_shadow_snapshots where user_id=v_user_id order by captured_at desc limit 500)x),'[]'::jsonb),
  'candidateMetrics',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.market_intel_catalyst_candidate_model_metrics where user_id=v_user_id)x),'[]'::jsonb),
  'health',jsonb_build_object(
   'last_snapshot_at',(select max(captured_at) from public.market_intel_catalyst_shadow_snapshots where user_id=v_user_id),
   'first_snapshot_at',(select min(captured_at) from public.market_intel_catalyst_shadow_snapshots where user_id=v_user_id),
   'next_7d_at',(select min(captured_at+interval '7 days') from public.market_intel_catalyst_shadow_backtest where user_id=v_user_id and captured_at+interval '7 days'>now()),
   'mature_1d',(select count(*) from public.market_intel_catalyst_shadow_backtest where user_id=v_user_id and captured_at+interval '1 day'<=now()),
   'mature_3d',(select count(*) from public.market_intel_catalyst_shadow_backtest where user_id=v_user_id and captured_at+interval '3 days'<=now()),
   'mature_7d',(select count(*) from public.market_intel_catalyst_shadow_backtest where user_id=v_user_id and captured_at+interval '7 days'<=now()),
   'calibration_samples',(select count(*) from public.market_intel_catalyst_shadow_backtest where user_id=v_user_id),
   'raw_printing_snapshots',(select count(*) from public.market_intel_catalyst_shadow_snapshots where user_id=v_user_id),
   'latest_signal_at',(select max(observed_at) from public.market_intel_items where user_id=v_user_id),
   'recorder',(select coalesce(to_jsonb(r),'{}'::jsonb) from (select started_at,completed_at,scout_rows,recent_intel,candidates,inserted,status,error from public.market_intel_catalyst_shadow_recorder_runs order by started_at desc limit 1)r)
  )
 ) into v_result;
 return v_result;
end;$$;
revoke all on function public.get_catalyst_calibration() from public,anon;
grant execute on function public.get_catalyst_calibration() to authenticated;
