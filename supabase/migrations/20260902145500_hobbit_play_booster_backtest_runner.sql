-- Hobbit Play Booster probabilistic EV runner.
-- Wizards publishes several sub-1% buckets only as "less than 1%". The v1
-- model preserves the exact published shares and allocates each rounded <1%
-- residual proportional to eligible pool size; assumptions are persisted on
-- each backtest so later MTGJSON/official precision can replace this cleanly.

create or replace function public.run_hobbit_play_backtest(p_backtest_id uuid,p_samples integer default 50000)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  n int:=greatest(1000,least(coalesce(p_samples,50000),100000));
  i int;j int;k int;r numeric;total numeric;ref numeric;bc int;has_topper boolean;
  vals numeric[]:=array[]::numeric[];
  a_bc_n numeric[];a_bu_n numeric[];a_br_n numeric[];a_bm_n numeric[];
  a_sc_n numeric[];a_su_n numeric[];a_sr_n numeric[];a_du_n numeric[];a_dr_n numeric[];a_dm_n numeric[];a_bkr_n numeric[];a_bkm_n numeric[];
  a_bc_f numeric[];a_bu_f numeric[];a_br_f numeric[];a_bm_f numeric[];
  a_sc_f numeric[];a_su_f numeric[];a_sr_f numeric[];a_du_f numeric[];a_dr_f numeric[];a_dm_f numeric[];a_bkr_f numeric[];a_bkm_f numeric[];
  a_default_n numeric[];a_default_f numeric[];a_journey_n numeric[];a_journey_f numeric[];a_dual_n numeric[];a_dual_f numeric[];a_topper numeric[];
  mean_v numeric;median_v numeric;p10 numeric;p90 numeric;net_mean numeric;gross_be numeric;net_be numeric;two_x numeric;five_x numeric;booster_mean numeric;topper_mean numeric:=0;
begin
  select sealed_reference_price,booster_count,coalesce((assumptions->>'has_topper')::boolean,false)
    into ref,bc,has_topper from sealed_ev_backtests where backtest_id=p_backtest_id;
  if ref is null then raise exception 'Missing sealed reference price'; end if;
  bc:=coalesce(bc,1);

  select array_agg(market_value) into a_bc_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='base_common' and finish='normal' and market_value is not null;
  select array_agg(market_value) into a_bu_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='base_uncommon' and finish='normal' and market_value is not null;
  select array_agg(market_value) into a_br_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='base_rare' and finish='normal' and market_value is not null;
  select array_agg(market_value) into a_bm_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='base_mythic' and finish='normal' and market_value is not null;
  select array_agg(market_value) into a_sc_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='scene_common' and finish='normal' and market_value is not null;
  select array_agg(market_value) into a_su_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='scene_uncommon' and finish='normal' and market_value is not null;
  select array_agg(market_value) into a_sr_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='scene_rare' and finish='normal' and market_value is not null;
  select array_agg(market_value) into a_du_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='dragon_uncommon' and finish='normal' and market_value is not null;
  select array_agg(market_value) into a_dr_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='dragon_rare' and finish='normal' and market_value is not null;
  select array_agg(market_value) into a_dm_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='dragon_mythic' and finish='normal' and market_value is not null;
  select array_agg(market_value) into a_bkr_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='book_rare' and finish='normal' and market_value is not null;
  select array_agg(market_value) into a_bkm_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='book_mythic' and finish='normal' and market_value is not null;

  select array_agg(market_value) into a_bc_f from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='base_common' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_bu_f from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='base_uncommon' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_br_f from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='base_rare' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_bm_f from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='base_mythic' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_sc_f from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='scene_common' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_su_f from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='scene_uncommon' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_sr_f from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='scene_rare' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_du_f from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='dragon_uncommon' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_dr_f from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='dragon_rare' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_dm_f from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='dragon_mythic' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_bkr_f from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='book_rare' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_bkm_f from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='book_mythic' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_default_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='default_land' and finish='normal' and market_value is not null;
  select array_agg(market_value) into a_default_f from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='default_land' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_journey_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='journey_land' and finish='normal' and market_value is not null;
  select array_agg(market_value) into a_journey_f from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='journey_land' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_dual_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='dual_land' and finish='normal' and market_value is not null;
  select array_agg(market_value) into a_dual_f from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='dual_land' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_topper from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='classic_artist' and finish='foil' and market_value is not null;
  if has_topper then topper_mean=(select avg(x) from unnest(a_topper) x); end if;

  for i in 1..n loop
    total=case when has_topper then sealed_ev_array_pick(a_topper) else 0 end;
    for j in 1..bc loop
      for k in 1..7 loop if random()<.922 then total=total+sealed_ev_array_pick(a_bc_n); else total=total+sealed_ev_array_pick(a_sc_n); end if; end loop;
      for k in 1..3 loop r=random(); if r<.836 then total=total+sealed_ev_array_pick(a_bu_n); elsif r<.891 then total=total+sealed_ev_array_pick(a_su_n); else total=total+sealed_ev_array_pick(a_du_n); end if; end loop;
      r=random();
      if r<.7417 then total=total+sealed_ev_array_pick(a_bc_n); elsif r<.7807 then total=total+sealed_ev_array_pick(a_bu_n); elsif r<.9537 then total=total+sealed_ev_array_pick(a_br_n); elsif r<.9767 then total=total+sealed_ev_array_pick(a_bm_n); elsif r<.977632 then total=total+sealed_ev_array_pick(a_sc_n); elsif r<.979496 then total=total+sealed_ev_array_pick(a_su_n); elsif r<.983690 then total=total+sealed_ev_array_pick(a_sr_n); elsif r<.986486 then total=total+sealed_ev_array_pick(a_du_n); elsif r<.991612 then total=total+sealed_ev_array_pick(a_dr_n); elsif r<.995340 then total=total+sealed_ev_array_pick(a_dm_n); elsif r<.997204 then total=total+sealed_ev_array_pick(a_bkr_n); else total=total+sealed_ev_array_pick(a_bkm_n); end if;
      r=random();
      if r<.829 then total=total+sealed_ev_array_pick(a_br_n); elsif r<.940 then total=total+sealed_ev_array_pick(a_bm_n); elsif r<.958 then total=total+sealed_ev_array_pick(a_sr_n); elsif r<.981 then total=total+sealed_ev_array_pick(a_dr_n); elsif r<.989444 then total=total+sealed_ev_array_pick(a_dm_n); elsif r<.993666 then total=total+sealed_ev_array_pick(a_bkr_n); else total=total+sealed_ev_array_pick(a_bkm_n); end if;
      r=random();
      if r<.598 then total=total+sealed_ev_array_pick(a_bc_f); elsif r<.891 then total=total+sealed_ev_array_pick(a_bu_f); elsif r<.962 then total=total+sealed_ev_array_pick(a_br_f); elsif r<.972 then total=total+sealed_ev_array_pick(a_bm_f); elsif r<.97312 then total=total+sealed_ev_array_pick(a_sc_f); elsif r<.97536 then total=total+sealed_ev_array_pick(a_su_f); elsif r<.98040 then total=total+sealed_ev_array_pick(a_sr_f); elsif r<.98376 then total=total+sealed_ev_array_pick(a_du_f); elsif r<.98992 then total=total+sealed_ev_array_pick(a_dr_f); elsif r<.99440 then total=total+sealed_ev_array_pick(a_dm_f); elsif r<.99664 then total=total+sealed_ev_array_pick(a_bkr_f); else total=total+sealed_ev_array_pick(a_bkm_f); end if;
      r=random();
      if r<.267 then total=total+sealed_ev_array_pick(a_default_n); elsif r<.334 then total=total+sealed_ev_array_pick(a_default_f); elsif r<.467 then total=total+sealed_ev_array_pick(a_journey_n); elsif r<.500 then total=total+sealed_ev_array_pick(a_journey_f); elsif r<.900 then total=total+sealed_ev_array_pick(a_dual_n); else total=total+sealed_ev_array_pick(a_dual_f); end if;
    end loop;
    vals=array_append(vals,total);
  end loop;

  select avg(x),percentile_cont(.5) within group(order by x),percentile_cont(.1) within group(order by x),percentile_cont(.9) within group(order by x),avg(x)*.75,
         avg((x>=ref)::int),avg((x*.75>=ref)::int),avg((x>=ref*2)::int),avg((x>=ref*5)::int)
  into mean_v,median_v,p10,p90,net_mean,gross_be,net_be,two_x,five_x from unnest(vals)x;
  booster_mean=(mean_v-topper_mean)/bc;
  update sealed_ev_backtests set sample_count=n,booster_mean_ev=round(booster_mean,2),topper_mean_ev=case when has_topper then round(topper_mean,2) else null end,gross_mean_ev=round(mean_v,2),gross_median_ev=round(median_v,2),p10_ev=round(p10,2),p90_ev=round(p90,2),net_mean_ev_after_fees=round(net_mean,2),break_even_probability=round(gross_be,4),two_x_probability=round(two_x,4),five_x_probability=round(five_x,4),results=results||jsonb_build_object('net_break_even_probability',round(net_be,4),'fee_rate',.25,'distribution_basis','Monte Carlo Wizards official Play Booster percentages; rounded <1% residual allocated proportional to eligible pool size') where backtest_id=p_backtest_id;
  return jsonb_build_object('samples',n,'boosters',bc,'sealed_reference_price',ref,'booster_mean_ev',round(booster_mean,2),'topper_mean_ev',case when has_topper then round(topper_mean,2) else null end,'gross_mean_ev',round(mean_v,2),'median_ev',round(median_v,2),'p10',round(p10,2),'p90',round(p90,2),'net_mean_after_25pct',round(net_mean,2),'gross_break_even',round(gross_be,4),'net_break_even',round(net_be,4));
end $$;

revoke all on function public.run_hobbit_play_backtest(uuid,integer) from public,anon,authenticated;
grant execute on function public.run_hobbit_play_backtest(uuid,integer) to service_role;
