-- MTGJSON native sheets are not uniformly distributed. Executable and
-- practical EV must preserve each card's native sheet weight just as the
-- reference Monte Carlo does. Legacy hand-built pools default to weight 1.

create or replace view public.sealed_ev_channel_current
with (security_invoker=true) as
with latest as (
  select distinct on (b.user_id,b.sealed_uuid) b.*
  from public.sealed_ev_backtests b
  order by b.user_id,b.sealed_uuid,b.valuation_as_of desc,b.created_at desc
), pool as (
  select v.backtest_id,v.pool_key,v.finish,
         sum(v.tcg_low*w.native_weight)/nullif(sum(w.native_weight),0) tcg_low,
         sum(coalesce(v.direct_net,v.tcg_regular_net,0)*w.native_weight)/nullif(sum(w.native_weight),0) direct_first_net,
         sum(v.collectish_live_out*w.native_weight)/nullif(sum(w.native_weight),0) collectish_live_out,
         sum(w.native_weight) filter(where v.tcg_low>0)/nullif(sum(w.native_weight),0) price_coverage
  from public.sealed_ev_pool_executable_values v
  join public.sealed_ev_backtest_pool_items i on i.pool_item_id=v.pool_item_id
  cross join lateral (select coalesce(nullif(i.metadata->>'native_weight','')::numeric,1) native_weight) w
  group by 1,2,3
), pack as (
  select l.user_id,l.sealed_uuid,l.backtest_id,l.model_key,l.model_version,l.valuation_as_of,
         sum(s.draws_per_booster*s.probability*coalesce(p.tcg_low,0)) tcg_low_per_pack,
         sum(s.draws_per_booster*s.probability*coalesce(p.direct_first_net,0)) direct_first_net_per_pack,
         sum(s.draws_per_booster*s.probability*coalesce(p.collectish_live_out,0)) collectish_live_out_per_pack,
         sum(s.draws_per_booster*s.probability*coalesce(p.price_coverage,0)) /
           nullif(sum(s.draws_per_booster*s.probability),0) price_coverage
  from latest l join public.sealed_ev_backtest_slots s on s.backtest_id=l.backtest_id
  left join pool p on p.backtest_id=s.backtest_id and p.pool_key=s.pool_key and p.finish=s.finish
  group by l.user_id,l.sealed_uuid,l.backtest_id,l.model_key,l.model_version,l.valuation_as_of
)
select p.*,
       round(p.tcg_low_per_pack*coalesce(l.booster_count,1),4) tcg_low_ev,
       round(p.direct_first_net_per_pack*coalesce(l.booster_count,1),4) direct_first_net_ev,
       round(p.collectish_live_out_per_pack*coalesce(l.booster_count,1),4) collectish_live_out_ev,
       round(p.price_coverage*100,2) price_coverage_pct,
       'current_only_no_syp_native_weighted'::text randomized_route_policy
from pack p join latest l using(user_id,sealed_uuid,backtest_id);

create or replace view public.sealed_ev_practical_channel_current
with (security_invoker=true) as
with latest as (
  select distinct on (b.user_id,b.sealed_uuid) b.*
  from public.sealed_ev_backtests b
  order by b.user_id,b.sealed_uuid,b.valuation_as_of desc,b.created_at desc
), pv as materialized (
  select * from public.sealed_ev_pool_practical_values
), pool as (
  select v.backtest_id,v.pool_key,v.finish,
    sum(v.practical_liquidation*w.native_weight)/nullif(sum(w.native_weight),0) practical_liquidation,
    sum(w.native_weight) total_weight
  from pv v
  join public.sealed_ev_backtest_pool_items i on i.pool_item_id=v.pool_item_id
  cross join lateral (select coalesce(nullif(i.metadata->>'native_weight','')::numeric,1) native_weight) w
  group by 1,2,3
), base as (
  select l.user_id,l.sealed_uuid,l.backtest_id,
    sum(s.draws_per_booster*s.probability*coalesce(p.practical_liquidation,0))
      * coalesce(l.booster_count,1) practical_liquidation_ev
  from latest l
  join public.sealed_ev_backtest_slots s on s.backtest_id=l.backtest_id
  left join pool p on p.backtest_id=s.backtest_id and p.pool_key=s.pool_key and p.finish=s.finish
  group by l.user_id,l.sealed_uuid,l.backtest_id,l.booster_count
), item_contribution as (
  select l.user_id,l.sealed_uuid,v.pool_item_id,
    sum(s.draws_per_booster*s.probability/nullif(p.total_weight,0))
      * max(v.practical_liquidation*w.native_weight)*coalesce(l.booster_count,1) contribution
  from latest l
  join public.sealed_ev_backtest_slots s on s.backtest_id=l.backtest_id
  join pool p on p.backtest_id=s.backtest_id and p.pool_key=s.pool_key and p.finish=s.finish
  join pv v on v.backtest_id=p.backtest_id and v.pool_key=p.pool_key and v.finish=p.finish
  join public.sealed_ev_backtest_pool_items i on i.pool_item_id=v.pool_item_id
  cross join lateral (select coalesce(nullif(i.metadata->>'native_weight','')::numeric,1) native_weight) w
  group by l.user_id,l.sealed_uuid,v.pool_item_id,l.booster_count
), ranked as (
  select x.*,row_number() over(partition by user_id,sealed_uuid order by contribution desc) rn
  from item_contribution x
), concentration as (
  select user_id,sealed_uuid,
    sum(contribution) total_contribution,
    sum(contribution) filter(where rn<=10) top10_contribution,
    max(contribution) top1_contribution
  from ranked group by 1,2
)
select b.user_id,b.sealed_uuid,
  round(b.practical_liquidation_ev,4) practical_liquidation_ev,
  round(100*c.top10_contribution/nullif(c.total_contribution,0),2) top10_practical_ev_share_pct,
  round(100*c.top1_contribution/nullif(c.total_contribution,0),2) top1_practical_ev_share_pct
from base b left join concentration c using(user_id,sealed_uuid);

notify pgrst,'reload schema';
