-- Calibrate early Play Booster EV trajectory from matched card-price baskets.
-- TCGCSV Market is historical shape evidence only; it is never executable EV.

create table if not exists public.modeled_booster_ev_calibration_current (
  horizon_days smallint primary key check (horizon_days in (30,60,90)),
  cohort_count integer not null,
  median_change_pct numeric not null,
  downside_change_pct numeric not null,
  upside_change_pct numeric not null,
  median_matched_prices integer not null,
  calibration_status text not null check (calibration_status in ('READY','BUILDING_HISTORY')),
  confidence_label text not null check (confidence_label in ('LOW','MEDIUM','HIGH')),
  model_version text not null,
  evidence jsonb not null default '{}'::jsonb,
  refreshed_at timestamptz not null default now()
);

alter table public.modeled_booster_ev_calibration_current enable row level security;
revoke all on public.modeled_booster_ev_calibration_current from public,anon,authenticated;
grant select on public.modeled_booster_ev_calibration_current to authenticated,service_role;
grant insert,update,delete on public.modeled_booster_ev_calibration_current to service_role;

drop policy if exists modeled_booster_ev_calibration_read on public.modeled_booster_ev_calibration_current;
create policy modeled_booster_ev_calibration_read
on public.modeled_booster_ev_calibration_current for select to authenticated using (true);

create or replace function public.refresh_modeled_booster_ev_calibration()
returns integer language plpgsql set search_path='' as $$
declare written integer;
begin
  with play_sets as (
    select distinct upper(p.set_code) set_code,coalesce(p.release_date,s.released_at) release_date
    from public.mtgjson_sealed_products p
    left join public.magic_set_catalog s on upper(s.code)=upper(p.set_code)
    where p.category='booster_pack' and p.subtype='play'
      and coalesce(p.release_date,s.released_at) is not null
  ), set_products as (
    select distinct ps.set_code,ps.release_date,c.tcgplayer_product_id::bigint product_id
    from play_sets ps join public.mtgjson_cards c on upper(c.set_code)=ps.set_code
    where c.tcgplayer_product_id~'^[0-9]+$'
  ), horizons as (
    select unnest(array[30,60,90])::smallint horizon_days
  ), base_candidates as (
    select sp.set_code,sp.release_date,h.observed_on,abs(h.observed_on-sp.release_date) distance
    from (select distinct set_code,release_date from set_products) sp
    join public.modeled_booster_card_price_history h
      on h.observed_on between sp.release_date-7 and sp.release_date+14
    group by 1,2,3
  ), base_dates as (
    select distinct on(set_code) set_code,release_date,observed_on
    from base_candidates order by set_code,distance,observed_on
  ), horizon_candidates as (
    select sp.set_code,sp.release_date,hz.horizon_days,h.observed_on,
      abs(h.observed_on-(sp.release_date+hz.horizon_days)) distance
    from (select distinct set_code,release_date from set_products) sp cross join horizons hz
    join public.modeled_booster_card_price_history h
      on h.observed_on between sp.release_date+hz.horizon_days-10 and sp.release_date+hz.horizon_days+10
    group by 1,2,3,4
  ), horizon_dates as (
    select distinct on(set_code,horizon_days) set_code,release_date,horizon_days,observed_on
    from horizon_candidates order by set_code,horizon_days,distance,observed_on
  ), cohorts as (
    select sp.set_code,hd.horizon_days,bd.observed_on baseline_date,hd.observed_on horizon_date,
      count(*)::integer matched_prices,
      100*(sum(h1.market_price)/nullif(sum(h0.market_price),0)-1) change_pct
    from set_products sp join base_dates bd using(set_code,release_date)
    join horizon_dates hd using(set_code,release_date)
    join public.modeled_booster_card_price_history h0
      on h0.product_id=sp.product_id and h0.observed_on=bd.observed_on and h0.market_price>0
    join public.modeled_booster_card_price_history h1
      on h1.product_id=h0.product_id and h1.sub_type_name=h0.sub_type_name
      and h1.observed_on=hd.observed_on and h1.market_price>0
    group by 1,2,3,4
    having count(*)>=100
  ), aggregate_rows as (
    select horizon_days,count(*)::integer cohort_count,
      round(percentile_cont(.5) within group(order by change_pct)::numeric,2) median_change_pct,
      round(percentile_cont(.25) within group(order by change_pct)::numeric,2) downside_change_pct,
      round(percentile_cont(.75) within group(order by change_pct)::numeric,2) upside_change_pct,
      round(percentile_cont(.5) within group(order by matched_prices))::integer median_matched_prices,
      case when count(*)>=3 then 'READY' else 'BUILDING_HISTORY' end calibration_status,
      case when count(*)>=12 then 'HIGH' when count(*)>=6 then 'MEDIUM' else 'LOW' end confidence_label,
      jsonb_build_object('set_codes',jsonb_agg(set_code order by set_code),'cohorts',jsonb_agg(
        jsonb_build_object('set_code',set_code,'baseline_date',baseline_date,'horizon_date',horizon_date,
          'matched_prices',matched_prices,'change_pct',round(change_pct,2)) order by set_code),
        'price_basis','TCGCSV Market matched basket','minimum_matched_prices',100) evidence
    from cohorts group by horizon_days
  ), upserted as (
    insert into public.modeled_booster_ev_calibration_current
      (horizon_days,cohort_count,median_change_pct,downside_change_pct,upside_change_pct,
       median_matched_prices,calibration_status,confidence_label,model_version,evidence,refreshed_at)
    select horizon_days,cohort_count,median_change_pct,downside_change_pct,upside_change_pct,
      median_matched_prices,calibration_status,confidence_label,'play-market-basket-v1',evidence,now()
    from aggregate_rows
    on conflict(horizon_days) do update set
      cohort_count=excluded.cohort_count,median_change_pct=excluded.median_change_pct,
      downside_change_pct=excluded.downside_change_pct,upside_change_pct=excluded.upside_change_pct,
      median_matched_prices=excluded.median_matched_prices,calibration_status=excluded.calibration_status,
      confidence_label=excluded.confidence_label,model_version=excluded.model_version,
      evidence=excluded.evidence,refreshed_at=excluded.refreshed_at
    returning 1
  ) select count(*) into written from upserted;

  delete from public.modeled_booster_ev_calibration_current c
  where not exists(select 1 from (values(30),(60),(90)) h(days) where h.days=c.horizon_days);
  return written;
end $$;

revoke all on function public.refresh_modeled_booster_ev_calibration() from public,anon,authenticated;
grant execute on function public.refresh_modeled_booster_ev_calibration() to service_role;

comment on table public.modeled_booster_ev_calibration_current is
  'Historical Play Booster Market-basket trajectory calibration. Never an executable price source.';

notify pgrst,'reload schema';
