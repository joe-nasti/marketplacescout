create or replace function public.sealed_ev_array_pick(a numeric[])
returns numeric
language plpgsql
volatile
set search_path=public
as $$
begin
  if a is null or array_length(a,1) is null then return 0; end if;
  return a[1+floor(random()*array_length(a,1))::int];
end $$;
revoke all on function public.sealed_ev_array_pick(numeric[]) from public,anon,authenticated;
grant execute on function public.sealed_ev_array_pick(numeric[]) to service_role;

create or replace function public.run_hobbit_collector_box_backtest(p_backtest_id uuid, p_samples integer default 50000)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  n int := greatest(1000, least(coalesce(p_samples,50000),100000));
  i int; j int; k int; r numeric; total numeric; ref numeric; vals numeric[] := array[]::numeric[];
  a_base_common numeric[]; a_dual numeric[]; a_scene_common numeric[]; a_base_uncommon numeric[]; a_scene_uncommon numeric[]; a_dragon_uncommon numeric[]; a_dragon_surge_all numeric[];
  a_journey numeric[]; a_base_rare numeric[]; a_base_mythic numeric[];
  a_scene_rare_n numeric[]; a_hoc_scene_n numeric[]; a_dragon_rare_n numeric[]; a_dragon_mythic_n numeric[]; a_book_rare_n numeric[]; a_book_mythic_n numeric[]; a_classic_n numeric[]; a_dwarvish_n numeric[]; a_hob_ext_rare_n numeric[]; a_hob_ext_mythic_n numeric[]; a_hoc_ext_n numeric[];
  a_scene_rare_f numeric[]; a_dragon_rare_f numeric[]; a_dragon_mythic_f numeric[]; a_dragon_surge_rare numeric[]; a_dragon_surge_mythic numeric[]; a_book_rare_f numeric[]; a_book_mythic_f numeric[]; a_book_surge_rare numeric[]; a_book_surge_mythic numeric[]; a_classic_surge numeric[]; a_dwarvish_f numeric[]; a_hob_ext_rare_f numeric[]; a_hob_ext_mythic_f numeric[]; a_topper numeric[];
  mean_v numeric; median_v numeric; p10 numeric; p90 numeric; net_mean numeric; gross_be numeric; net_be numeric; two_x numeric; five_x numeric; booster_mean numeric; topper_mean numeric; pick numeric;
begin
  select sealed_reference_price into ref from sealed_ev_backtests where backtest_id=p_backtest_id;
  if ref is null then raise exception 'Missing sealed reference price'; end if;
  select array_agg(market_value) into a_base_common from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='base_common' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_dual from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='dual_land' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_scene_common from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='scene_common' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_base_uncommon from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='base_uncommon' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_scene_uncommon from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='scene_uncommon' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_dragon_uncommon from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='dragon_uncommon' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_dragon_surge_all from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='dragon_surge_all' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_journey from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='journey_land' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_base_rare from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='base_rare' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_base_mythic from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='base_mythic' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_scene_rare_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='scene_rare' and finish='normal' and market_value is not null;
  select array_agg(market_value) into a_hoc_scene_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='hoc_scene_rare' and finish='normal' and market_value is not null;
  select array_agg(market_value) into a_dragon_rare_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='dragon_rare' and finish='normal' and market_value is not null;
  select array_agg(market_value) into a_dragon_mythic_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='dragon_mythic' and finish='normal' and market_value is not null;
  select array_agg(market_value) into a_book_rare_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='book_rare' and finish='normal' and market_value is not null;
  select array_agg(market_value) into a_book_mythic_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='book_mythic' and finish='normal' and market_value is not null;
  select array_agg(market_value) into a_classic_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='classic_artist' and finish='normal' and market_value is not null;
  select array_agg(market_value) into a_dwarvish_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='dwarvish' and finish='normal' and market_value is not null;
  select array_agg(market_value) into a_hob_ext_rare_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='hob_ext_rare' and finish='normal' and market_value is not null;
  select array_agg(market_value) into a_hob_ext_mythic_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='hob_ext_mythic' and finish='normal' and market_value is not null;
  select array_agg(market_value) into a_hoc_ext_n from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='hoc_ext_mythic' and finish='normal' and market_value is not null;
  select array_agg(market_value) into a_scene_rare_f from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='scene_rare' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_dragon_rare_f from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='dragon_rare' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_dragon_mythic_f from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='dragon_mythic' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_dragon_surge_rare from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='dragon_surge_rare' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_dragon_surge_mythic from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='dragon_surge_mythic' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_book_rare_f from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='book_rare' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_book_mythic_f from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='book_mythic' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_book_surge_rare from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='book_surge_rare' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_book_surge_mythic from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='book_surge_mythic' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_classic_surge from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='classic_artist_surge' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_dwarvish_f from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='dwarvish' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_hob_ext_rare_f from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='hob_ext_rare' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_hob_ext_mythic_f from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='hob_ext_mythic' and finish='foil' and market_value is not null;
  select array_agg(market_value) into a_topper from sealed_ev_backtest_pool_items where backtest_id=p_backtest_id and pool_key='classic_artist' and finish='foil' and market_value is not null;
  topper_mean=(select avg(x) from unnest(a_topper) x);
  for i in 1..n loop
    total=sealed_ev_array_pick(a_topper);
    for j in 1..12 loop
      for k in 1..5 loop r=random()*1.001; if r<.896 then total=total+sealed_ev_array_pick(a_base_common); elsif r<.971 then total=total+sealed_ev_array_pick(a_dual); else total=total+sealed_ev_array_pick(a_scene_common); end if; end loop;
      if random()<.1 then for k in 1..3 loop r=random(); if r<.846 then total=total+sealed_ev_array_pick(a_base_uncommon); elsif r<.908 then total=total+sealed_ev_array_pick(a_scene_uncommon); else total=total+sealed_ev_array_pick(a_dragon_uncommon); end if; end loop; total=total+sealed_ev_array_pick(a_dragon_surge_all);
      else for k in 1..4 loop r=random(); if r<.846 then total=total+sealed_ev_array_pick(a_base_uncommon); elsif r<.908 then total=total+sealed_ev_array_pick(a_scene_uncommon); else total=total+sealed_ev_array_pick(a_dragon_uncommon); end if; end loop; end if;
      total=total+sealed_ev_array_pick(a_journey);
      for k in 1..2 loop if random()<.876 then total=total+sealed_ev_array_pick(a_base_rare); else total=total+sealed_ev_array_pick(a_base_mythic); end if; end loop;
      for k in 1..2 loop r=random()*1.002;
        if r<.101 then pick=sealed_ev_array_pick(a_scene_rare_n); elsif r<.243 then pick=sealed_ev_array_pick(a_hoc_scene_n); elsif r<.374 then pick=sealed_ev_array_pick(a_dragon_rare_n); elsif r<.419 then pick=sealed_ev_array_pick(a_dragon_mythic_n); elsif r<.461 then pick=sealed_ev_array_pick(a_book_rare_n); elsif r<.494 then pick=sealed_ev_array_pick(a_book_mythic_n); elsif r<.613 then pick=sealed_ev_array_pick(a_classic_n); elsif r<.628 then pick=sealed_ev_array_pick(a_dwarvish_n); elsif r<.937 then pick=sealed_ev_array_pick(a_hob_ext_rare_n); elsif r<.949 then pick=sealed_ev_array_pick(a_hob_ext_mythic_n); else pick=sealed_ev_array_pick(a_hoc_ext_n); end if; total=total+pick; end loop;
      r=random()*1.001;
      if r<.110 then pick=sealed_ev_array_pick(a_scene_rare_f); elsif r<.253 then pick=sealed_ev_array_pick(a_dragon_rare_f); elsif r<.302 then pick=sealed_ev_array_pick(a_dragon_mythic_f); elsif r<.367 then pick=sealed_ev_array_pick(a_dragon_surge_rare); elsif r<.391 then pick=sealed_ev_array_pick(a_dragon_surge_mythic); elsif r<.437 then pick=sealed_ev_array_pick(a_book_rare_f); elsif r<.473 then pick=sealed_ev_array_pick(a_book_mythic_f); elsif r<.497 then pick=sealed_ev_array_pick(a_book_surge_rare); elsif r<.515 then pick=sealed_ev_array_pick(a_book_surge_mythic); elsif r<.634 then pick=sealed_ev_array_pick(a_classic_surge); elsif r<.650 then pick=sealed_ev_array_pick(a_dwarvish_f); elsif r<.988 then pick=sealed_ev_array_pick(a_hob_ext_rare_f); else pick=sealed_ev_array_pick(a_hob_ext_mythic_f); end if; total=total+pick;
    end loop;
    vals=array_append(vals,total);
  end loop;
  select avg(x),percentile_cont(.5) within group(order by x),percentile_cont(.1) within group(order by x),percentile_cont(.9) within group(order by x),avg(x)*.75,avg((x>=ref)::int),avg((x*.75>=ref)::int),avg((x>=ref*2)::int),avg((x>=ref*5)::int)
    into mean_v,median_v,p10,p90,net_mean,gross_be,net_be,two_x,five_x from unnest(vals) x;
  booster_mean=(mean_v-topper_mean)/12;
  update sealed_ev_backtests set sample_count=n,booster_mean_ev=round(booster_mean,2),topper_mean_ev=round(topper_mean,2),gross_mean_ev=round(mean_v,2),gross_median_ev=round(median_v,2),p10_ev=round(p10,2),p90_ev=round(p90,2),net_mean_ev_after_fees=round(net_mean,2),break_even_probability=round(gross_be,4),two_x_probability=round(two_x,4),five_x_probability=round(five_x,4),results=results||jsonb_build_object('net_break_even_probability',round(net_be,4),'fee_rate',.25,'distribution_basis','Monte Carlo exact official slot mix; current exact-printing TCGplayer values; headliner excluded') where backtest_id=p_backtest_id;
  return jsonb_build_object('samples',n,'sealed_reference_price',ref,'booster_mean_ev',round(booster_mean,2),'topper_mean_ev',round(topper_mean,2),'gross_mean_ev',round(mean_v,2),'median_ev',round(median_v,2),'p10',round(p10,2),'p90',round(p90,2),'net_mean_after_25pct',round(net_mean,2),'gross_break_even',round(gross_be,4),'net_break_even',round(net_be,4),'two_x',round(two_x,4),'five_x',round(five_x,4));
end $$;
revoke all on function public.run_hobbit_collector_box_backtest(uuid,integer) from public,anon,authenticated;
grant execute on function public.run_hobbit_collector_box_backtest(uuid,integer) to service_role;
