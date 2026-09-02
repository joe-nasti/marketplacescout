-- Practical sealed EV discounts theoretical best-outlet value for labor and liquidity.
-- TCG Market, SYP, and last-known Direct remain excluded from randomized EV.

create or replace function public.collectish_velocity_factor(p_daily_sales numeric)
returns numeric language sql immutable parallel safe set search_path='' as $$
  select case
    when p_daily_sales is null then .50
    when p_daily_sales >= 1 then 1
    when p_daily_sales >= .25 then .90
    when p_daily_sales >= .10 then .75
    when p_daily_sales > 0 then .55
    else .35
  end::numeric
$$;

revoke all on function public.collectish_velocity_factor(numeric) from public;
grant execute on function public.collectish_velocity_factor(numeric) to authenticated,service_role;

create or replace view public.sealed_ev_pool_practical_values
with (security_invoker=true) as
with valued as (
  select e.*,i.tcgplayer_product_id
  from public.sealed_ev_pool_executable_values e
  join public.sealed_ev_backtest_pool_items i on i.pool_item_id=e.pool_item_id
), routes as (
  select v.*,
    case when coalesce(v.direct_net,0)*.85 >= .50
      then round(v.direct_net*.85,4) else 0 end practical_direct,
    case when coalesce(v.tcg_regular_net,0)*.75 >= .50
      then round(v.tcg_regular_net*.75,4) else 0 end practical_regular,
    case when coalesce(v.manapool_net,0)*.65 >= 1
      then round(v.manapool_net*.65,4) else 0 end practical_manapool
  from valued v
)
select r.*,
  greatest(coalesce(r.ck_cash,0),r.practical_direct,r.practical_regular,r.practical_manapool)::numeric practical_liquidation,
  case greatest(coalesce(r.ck_cash,0),r.practical_direct,r.practical_regular,r.practical_manapool)
    when coalesce(r.ck_cash,0) then 'Card Kingdom'
    when r.practical_direct then 'TCG Direct'
    when r.practical_regular then 'TCG Regular'
    else 'ManaPool'
  end practical_channel
from routes r;

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
    avg(v.practical_liquidation) practical_liquidation,
    count(*) item_count
  from pv v group by 1,2,3
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
    sum(s.draws_per_booster*s.probability/nullif(p.item_count,0))
      * max(v.practical_liquidation)*coalesce(l.booster_count,1) contribution
  from latest l
  join public.sealed_ev_backtest_slots s on s.backtest_id=l.backtest_id
  join pool p on p.backtest_id=s.backtest_id and p.pool_key=s.pool_key and p.finish=s.finish
  join pv v on v.backtest_id=p.backtest_id
    and v.pool_key=p.pool_key and v.finish=p.finish
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

create or replace view public.sealed_product_practical_ev_current
with (security_invoker=true) as
with exec as materialized (
  select * from public.sealed_product_executable_ev_current
), practical as materialized (
  select * from public.sealed_ev_practical_channel_current
), latest_bt as materialized (
  select distinct on (b.user_id,b.sealed_uuid) b.*
  from public.sealed_ev_backtests b
  order by b.user_id,b.sealed_uuid,b.valuation_as_of desc,b.created_at desc
), child_practical as (
  select e.user_id,c.parent_sealed_uuid,
    sum(c.quantity*coalesce(p.practical_liquidation_ev,ce.collectish_live_out_ev)) child_practical_ev,
    sum(c.quantity*case when bt.gross_mean_ev>0
      then bt.gross_median_ev/bt.gross_mean_ev*coalesce(p.practical_liquidation_ev,ce.collectish_live_out_ev)
      else coalesce(p.practical_liquidation_ev,ce.collectish_live_out_ev) end) child_median_estimate,
    sum(c.quantity*case when bt.gross_mean_ev>0
      then bt.p10_ev/bt.gross_mean_ev*coalesce(p.practical_liquidation_ev,ce.collectish_live_out_ev)
      else coalesce(p.practical_liquidation_ev,ce.collectish_live_out_ev) end) child_p10_estimate,
    max(p.top10_practical_ev_share_pct) child_top10_share_pct,
    max(p.top1_practical_ev_share_pct) child_top1_share_pct
  from exec e
  join public.sealed_product_child_components c on c.parent_sealed_uuid=e.sealed_uuid
  left join exec ce
    on ce.user_id=e.user_id and ce.sealed_uuid=c.child_sealed_uuid
  left join practical p
    on p.user_id=e.user_id and p.sealed_uuid=c.child_sealed_uuid
  left join latest_bt bt on bt.user_id=e.user_id and bt.sealed_uuid=c.child_sealed_uuid
  group by e.user_id,c.parent_sealed_uuid
), base as (
  select e.*,
    coalesce(p.practical_liquidation_ev,
      cp.child_practical_ev+coalesce(e.fixed_collectish_live_out_ev,0),
      e.collectish_live_out_ev) randomized_practical_ev,
    coalesce(p.top10_practical_ev_share_pct,cp.child_top10_share_pct) top10_practical_ev_share_pct,
    coalesce(p.top1_practical_ev_share_pct,cp.child_top1_share_pct) top1_practical_ev_share_pct,
    s.sealed_acquisition_price sealed_low_price,
    (coalesce(bind.profile_status,'') in ('full','deterministic')) recommendation_eligible,
    case when bind.profile_status='full' then 'FULL MODEL'
         when bind.profile_status='deterministic' then 'DETERMINISTIC'
         else 'UNMODELED' end coverage_state,
    coalesce(bt.gross_mean_ev,case when cp.parent_sealed_uuid is not null then
      cp.child_practical_ev+coalesce(e.fixed_collectish_live_out_ev,0) end) crack_gross_mean_ev,
    coalesce(bt.gross_median_ev,case when cp.parent_sealed_uuid is not null then
      cp.child_median_estimate+coalesce(e.fixed_collectish_live_out_ev,0) end) crack_gross_median_ev,
    coalesce(bt.p10_ev,case when cp.parent_sealed_uuid is not null then
      cp.child_p10_estimate+coalesce(e.fixed_collectish_live_out_ev,0) end) crack_p10_ev
  from exec e
  left join practical p
    on p.user_id=e.user_id and p.sealed_uuid=e.sealed_uuid
  left join child_practical cp on cp.user_id=e.user_id and cp.parent_sealed_uuid=e.sealed_uuid
  left join public.sealed_ev_current s
    on s.user_id=e.user_id and s.sealed_uuid=e.sealed_uuid
  left join latest_bt bt on bt.user_id=e.user_id and bt.sealed_uuid=e.sealed_uuid
  left join public.sealed_collation_binding_resolved bind on bind.sealed_uuid=e.sealed_uuid
), calculated as (
  select b.*,
    case when b.crack_gross_mean_ev>0
      then round(b.crack_gross_median_ev/b.crack_gross_mean_ev*b.randomized_practical_ev,4) end practical_median_estimate,
    case when b.crack_gross_mean_ev>0
      then round(b.crack_p10_ev/b.crack_gross_mean_ev*b.randomized_practical_ev,4) end practical_p10_estimate
  from base b
), scored as (
  select c.*,
    round(greatest(0,least(100,
      50
      + greatest(-30,least(30,100*(c.randomized_practical_ev/nullif(c.sealed_low_price,0)-1)))
      - case when c.price_coverage_pct>=98 then 0 when c.price_coverage_pct>=90 then 8 else 25 end
      - case when coalesce(c.top10_practical_ev_share_pct,0)<=45 then 0
             when c.top10_practical_ev_share_pct<=65 then 8 else 18 end
      - case when c.practical_median_estimate is not null and c.sealed_low_price>0
               and c.practical_median_estimate<c.sealed_low_price*.60 then 10 else 0 end
    )),1) practical_scout_score
  from calculated c
)
select s.*,
  case when not coalesce(s.recommendation_eligible,false) then 'MODEL PENDING'
       when s.price_coverage_pct<90 then 'PRICE COVERAGE LOW'
       when coalesce(s.top10_practical_ev_share_pct,0)>70 then 'CHASE DEPENDENT'
       when s.randomized_practical_ev>=s.sealed_low_price*1.15
         and coalesce(s.practical_median_estimate,s.randomized_practical_ev)>=s.sealed_low_price*.75 then 'BUY & CRACK'
       when s.randomized_practical_ev>=s.sealed_low_price then 'MARGINAL CRACK'
       else 'KEEP SEALED' end practical_action,
  case when s.practical_scout_score>=90 then 'A'
       when s.practical_scout_score>=80 then 'B'
       when s.practical_scout_score>=70 then 'C'
       when s.practical_scout_score>=60 then 'D'
       else 'F' end practical_scout_grade,
  'channel_liquidity_and_labor_v1'::text practical_model_version,
  'Median and P10 preserve the latest simulation shape and scale it to current practical EV.'::text distribution_estimate_basis
from scored s;

alter table public.sealed_product_executable_ev_cache
  add column if not exists practical_liquidation_ev numeric,
  add column if not exists practical_median_estimate numeric,
  add column if not exists practical_p10_estimate numeric,
  add column if not exists top10_practical_ev_share_pct numeric,
  add column if not exists top1_practical_ev_share_pct numeric,
  add column if not exists practical_scout_score numeric,
  add column if not exists practical_scout_grade text,
  add column if not exists practical_action text,
  add column if not exists practical_model_version text,
  add column if not exists distribution_estimate_basis text;

create or replace function public.refresh_sealed_product_executable_ev_cache()
returns integer language plpgsql security definer set search_path=public set statement_timeout='180s' as $$
declare n integer;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then
    raise exception 'service_role required';
  end if;
  truncate table public.sealed_product_executable_ev_cache;
  insert into public.sealed_product_executable_ev_cache(
    user_id,sealed_uuid,tcg_low_ev,direct_first_net_ev,collectish_live_out_ev,
    fixed_tcg_low_ev,fixed_collectish_live_out_ev,modeled_child_units,
    price_coverage_pct,valuation_basis,model_key,model_version,valuation_as_of,
    practical_liquidation_ev,practical_median_estimate,practical_p10_estimate,
    top10_practical_ev_share_pct,top1_practical_ev_share_pct,practical_scout_score,
    practical_scout_grade,practical_action,practical_model_version,distribution_estimate_basis,refreshed_at)
  select user_id,sealed_uuid,tcg_low_ev,direct_first_net_ev,collectish_live_out_ev,
    fixed_tcg_low_ev,fixed_collectish_live_out_ev,modeled_child_units,
    price_coverage_pct,valuation_basis,model_key,model_version,valuation_as_of,
    randomized_practical_ev,practical_median_estimate,practical_p10_estimate,
    top10_practical_ev_share_pct,top1_practical_ev_share_pct,practical_scout_score,
    practical_scout_grade,practical_action,practical_model_version,distribution_estimate_basis,now()
  from public.sealed_product_practical_ev_current;
  get diagnostics n=row_count;
  analyze public.sealed_product_executable_ev_cache;
  return n;
end $$;

revoke all on function public.refresh_sealed_product_executable_ev_cache() from public,anon,authenticated;
grant execute on function public.refresh_sealed_product_executable_ev_cache() to service_role;
grant select on public.sealed_ev_pool_practical_values,public.sealed_ev_practical_channel_current,
  public.sealed_product_practical_ev_current to authenticated,service_role;

notify pgrst,'reload schema';
