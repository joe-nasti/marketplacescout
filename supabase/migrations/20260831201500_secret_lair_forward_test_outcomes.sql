create table if not exists public.secret_lair_forward_test_outcomes (
  outcome_id uuid primary key default gen_random_uuid(), user_id uuid not null, release_id uuid not null, drop_id uuid not null, finish text not null,
  frozen_evaluation_id uuid, frozen_recommendation text, frozen_opportunity_score numeric, frozen_collector_score numeric, frozen_expected_roi_pct numeric, frozen_acquisition_cost numeric, frozen_model_version text,
  first_listing_at timestamptz, first_sale_at timestamptz, broad_market_at timestamptz, listing_peak integer default 0, listing_peak_at timestamptz,
  release_trough_price numeric, release_trough_at timestamptz, latest_low_price numeric, latest_market_price numeric, latest_listing_count integer default 0,
  drain_from_peak_pct numeric, rebuild_from_trough_pct numeric, net_roi_from_trough_pct numeric, outcome_status text not null default 'observing', metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,drop_id,finish)
);
alter table public.secret_lair_forward_test_outcomes enable row level security;
drop policy if exists secret_lair_forward_test_outcomes_own on public.secret_lair_forward_test_outcomes;
create policy secret_lair_forward_test_outcomes_own on public.secret_lair_forward_test_outcomes for select to authenticated using (user_id=auth.uid());

create or replace function public.refresh_secret_lair_forward_test_outcome(p_user_id uuid,p_drop_id uuid,p_finish text)
returns void language plpgsql security definer set search_path=public as $$
declare v_release uuid; v_eval record; v_state record; v_rel record; v_peak int:=0; v_peak_at timestamptz; v_trough_price numeric; v_trough_at timestamptz; v_latest_low numeric; v_latest_market numeric; v_drain numeric; v_rebuild numeric; v_netroi numeric; v_status text:='observing';
begin
  select release_id into v_release from public.secret_lair_drops where drop_id=p_drop_id; if v_release is null then return; end if;
  select * into v_eval from public.secret_lair_evaluations where user_id=p_user_id and drop_id=p_drop_id and finish=p_finish and evaluation_phase='pre_sale' and evaluation_status='scored' order by evaluated_at asc limit 1;
  select * into v_state from public.secret_lair_market_transition_state where user_id=p_user_id and drop_id=p_drop_id and finish=p_finish limit 1;
  select * into v_rel from public.secret_lair_release_market_transition_state where user_id=p_user_id and release_id=v_release limit 1;
  select coalesce(max(listing_count),0) into v_peak from public.secret_lair_market_observations where user_id=p_user_id and drop_id=p_drop_id and finish=p_finish and source_market='tcgplayer';
  if v_peak>0 then select min(observed_at) into v_peak_at from public.secret_lair_market_observations where user_id=p_user_id and drop_id=p_drop_id and finish=p_finish and source_market='tcgplayer' and listing_count=v_peak; end if;
  select nullif(low_price,0),nullif(market_price,0) into v_latest_low,v_latest_market from public.secret_lair_market_observations where user_id=p_user_id and drop_id=p_drop_id and finish=p_finish and source_market='tcgplayer' order by observed_at desc limit 1;
  if v_rel.broad_market_candidate_at is not null then select nullif(low_price,0),observed_at into v_trough_price,v_trough_at from public.secret_lair_market_observations where user_id=p_user_id and drop_id=p_drop_id and finish=p_finish and source_market='tcgplayer' and observed_at>=v_rel.broad_market_candidate_at and nullif(low_price,0) is not null and coalesce(listing_count,0)>=greatest(5,ceil(greatest(v_peak,1)*0.5)::int) order by low_price asc,observed_at asc limit 1; end if;
  if v_peak>0 then v_drain:=round((1-coalesce(v_state.latest_listing_count,0)::numeric/v_peak::numeric)*100,1); end if;
  if v_trough_price is not null and v_latest_low is not null then v_rebuild:=round((v_latest_low/v_trough_price-1)*100,1); end if;
  if v_trough_price is not null and v_eval.acquisition_cost is not null and v_eval.acquisition_cost>0 then v_netroi:=round(((v_trough_price*0.75)-v_eval.acquisition_cost)/v_eval.acquisition_cost*100,1); end if;
  if v_rel.broad_market_candidate_at is null then v_status:=case when v_state.first_listing_at is null then 'cataloged' else 'presale_activity' end; elsif v_trough_price is null then v_status:='supply_shock'; elsif coalesce(v_drain,0)>=35 then v_status:='draining'; else v_status:='trough_forming'; end if;
  insert into public.secret_lair_forward_test_outcomes(user_id,release_id,drop_id,finish,frozen_evaluation_id,frozen_recommendation,frozen_opportunity_score,frozen_collector_score,frozen_expected_roi_pct,frozen_acquisition_cost,frozen_model_version,first_listing_at,first_sale_at,broad_market_at,listing_peak,listing_peak_at,release_trough_price,release_trough_at,latest_low_price,latest_market_price,latest_listing_count,drain_from_peak_pct,rebuild_from_trough_pct,net_roi_from_trough_pct,outcome_status,updated_at)
  values(p_user_id,v_release,p_drop_id,p_finish,v_eval.evaluation_id,v_eval.recommendation,v_eval.opportunity_score,v_eval.collector_score,v_eval.expected_roi_pct,v_eval.acquisition_cost,v_eval.model_version,v_state.first_listing_at,v_state.first_sale_at,v_rel.broad_market_candidate_at,v_peak,v_peak_at,v_trough_price,v_trough_at,v_latest_low,v_latest_market,coalesce(v_state.latest_listing_count,0),v_drain,v_rebuild,v_netroi,v_status,now())
  on conflict(user_id,drop_id,finish) do update set first_listing_at=excluded.first_listing_at,first_sale_at=excluded.first_sale_at,broad_market_at=excluded.broad_market_at,listing_peak=excluded.listing_peak,listing_peak_at=excluded.listing_peak_at,release_trough_price=excluded.release_trough_price,release_trough_at=excluded.release_trough_at,latest_low_price=excluded.latest_low_price,latest_market_price=excluded.latest_market_price,latest_listing_count=excluded.latest_listing_count,drain_from_peak_pct=excluded.drain_from_peak_pct,rebuild_from_trough_pct=excluded.rebuild_from_trough_pct,net_roi_from_trough_pct=excluded.net_roi_from_trough_pct,outcome_status=excluded.outcome_status,updated_at=now();
end $$;
revoke all on function public.refresh_secret_lair_forward_test_outcome(uuid,uuid,text) from public,anon,authenticated; grant execute on function public.refresh_secret_lair_forward_test_outcome(uuid,uuid,text) to service_role;
create or replace function public.secret_lair_forward_test_after_market_observation() returns trigger language plpgsql security definer set search_path=public as $$begin if new.drop_id is not null and new.finish is not null and new.source_market='tcgplayer' then perform public.refresh_secret_lair_forward_test_outcome(new.user_id,new.drop_id,new.finish); end if; return new; end$$;
drop trigger if exists secret_lair_forward_test_market_observation on public.secret_lair_market_observations;
create trigger secret_lair_forward_test_market_observation after insert on public.secret_lair_market_observations for each row execute function public.secret_lair_forward_test_after_market_observation();
