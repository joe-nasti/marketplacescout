create or replace view public.sealed_product_family_economics
with (security_invoker=true) as
with latest_backtest as (
  select distinct on (user_id,sealed_uuid)
    user_id,sealed_uuid,backtest_id,model_key,model_version,valuation_as_of,sealed_reference_price,
    gross_mean_ev,gross_median_ev,p10_ev,p90_ev,net_mean_ev_after_fees,break_even_probability,
    (results->>'net_break_even_probability')::numeric as net_break_even_probability,
    two_x_probability,five_x_probability,top10_ev_share,assumptions,results
  from public.sealed_ev_backtests
  order by user_id,sealed_uuid,valuation_as_of desc,created_at desc
), users as (
  select distinct user_id from public.sealed_set_profiles where enabled
), child_rollup as (
  select u.user_id,c.parent_sealed_uuid,
         count(*)::int child_components,
         count(*) filter(where b.backtest_id is not null)::int modeled_child_components,
         count(*) filter(where b.backtest_id is null)::int unmodeled_child_components,
         sum(c.quantity) filter(where b.backtest_id is not null) modeled_child_units,
         sum(c.quantity*b.gross_mean_ev) filter(where b.backtest_id is not null) child_gross_mean_ev,
         sum(c.quantity*b.net_mean_ev_after_fees) filter(where b.backtest_id is not null) child_net_mean_ev
  from users u cross join public.sealed_product_child_components c
  left join latest_backtest b on b.user_id=u.user_id and b.sealed_uuid=c.child_sealed_uuid
  group by u.user_id,c.parent_sealed_uuid
)
select u.user_id,f.*,
       coalesce(b.gross_mean_ev,cr.child_gross_mean_ev) crack_gross_mean_ev,
       b.gross_median_ev crack_gross_median_ev,b.p10_ev crack_p10_ev,b.p90_ev crack_p90_ev,
       coalesce(b.net_mean_ev_after_fees,cr.child_net_mean_ev) crack_net_mean_ev,
       b.break_even_probability crack_break_even_probability,b.net_break_even_probability crack_net_break_even_probability,
       cr.child_components,cr.modeled_child_components,cr.unmodeled_child_components,cr.modeled_child_units,
       case when b.backtest_id is not null then 'direct_backtest' when cr.modeled_child_components>0 then 'modeled_children_lower_bound' else 'not_modeled' end crack_value_basis,
       case when b.backtest_id is not null then true when coalesce(cr.unmodeled_child_components,0)=0 and coalesce(cr.modeled_child_components,0)>0 then true else false end crack_value_complete,
       coalesce(b.gross_mean_ev,cr.child_gross_mean_ev)-f.sealed_market_price gross_crack_spread,
       coalesce(b.net_mean_ev_after_fees,cr.child_net_mean_ev)-f.sealed_market_price net_crack_spread
from users u join public.sealed_product_family_context f on true
left join latest_backtest b on b.user_id=u.user_id and b.sealed_uuid=f.sealed_uuid
left join child_rollup cr on cr.user_id=u.user_id and cr.parent_sealed_uuid=f.sealed_uuid;

grant select on public.sealed_product_family_economics to authenticated;
