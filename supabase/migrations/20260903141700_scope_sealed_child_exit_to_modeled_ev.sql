-- Keep exit optimization scoped to children with a modeled crack EV. This
-- prevents a sealed-only child price from being added to a parent whose base
-- cache has no corresponding modeled child contribution to replace.
create or replace view public.sealed_child_exit_decision_current
with (security_invoker=true) as
with users as (
  select distinct user_id from public.sealed_set_profiles where enabled
), latest_price as (
  select distinct on (sp.sealed_uuid) sp.sealed_uuid,
    coalesce(sp.low_with_shipping,sp.low_price)::numeric sealed_tcg_low,
    sp.source,sp.total_listings,sp.captured_at
  from public.sealed_product_price_current sp
  where sp.source in ('tcgplayer_public','tcgplayer_official_product')
    and coalesce(sp.low_with_shipping,sp.low_price)>0
    and (sp.source='tcgplayer_official_product' or coalesce(sp.total_listings,0)>0)
  order by sp.sealed_uuid,sp.captured_at desc,
    case when sp.source='tcgplayer_public' then 0 else 1 end
), candidates as (
  select u.user_id,c.parent_sealed_uuid,c.child_sealed_uuid,c.child_product_name,
    c.quantity,p.category,p.subtype,
    case when lower(coalesce(ce.valuation_basis,'')) like '%fixed%' then true else false end fixed_child,
    case when lower(coalesce(ce.valuation_basis,'')) not like '%fixed%'
      then ce.practical_liquidation_ev end crack_unit_net,
    case when p.category='booster_pack'
      and ce.practical_liquidation_ev is not null
      and lower(coalesce(ce.valuation_basis,'')) not like '%fixed%'
      then public.collectish_tcg_regular_net(lp.sealed_tcg_low) end sealed_unit_net,
    lp.sealed_tcg_low,lp.source sealed_price_source,lp.captured_at sealed_price_at,
    ce.valuation_basis crack_valuation_basis,ce.valuation_as_of crack_valuation_at
  from users u cross join public.sealed_product_child_components c
  join public.mtgjson_sealed_products p on p.uuid=c.child_sealed_uuid
  left join public.sealed_product_executable_ev_cache ce
    on ce.user_id=u.user_id and ce.sealed_uuid=c.child_sealed_uuid
  left join latest_price lp on lp.sealed_uuid=c.child_sealed_uuid
), decided as (
  select x.*,
    case when fixed_child then 'already_routed'
      when coalesce(crack_unit_net,0)>=coalesce(sealed_unit_net,0) and coalesce(crack_unit_net,0)>0 then 'crack'
      when coalesce(sealed_unit_net,0)>0 then 'sell_sealed'
      else 'unresolved' end selected_exit_route,
    case when fixed_child then 0
      else greatest(coalesce(crack_unit_net,0),coalesce(sealed_unit_net,0)) end selected_unit_net,
    case when fixed_child then 0 else coalesce(crack_unit_net,0) end parent_included_unit_net
  from candidates x
)
select d.*,
  round(d.quantity*d.selected_unit_net,4) selected_contribution,
  round(d.quantity*d.parent_included_unit_net,4) parent_included_contribution,
  round(d.quantity*(d.selected_unit_net-d.parent_included_unit_net),4) parent_adjustment,
  'one modeled child unit chooses max(current crack net, current sealed-sale net); fixed children remain comparison-only'::text decision_policy
from decided d;

create or replace view public.sealed_product_exit_optimized_current
with (security_invoker=true) as
with child_rollup as (
  select user_id,parent_sealed_uuid,
    round(sum(parent_adjustment),4) child_exit_adjustment,
    round(sum(selected_contribution),4) selected_child_exit_ev,
    count(*) filter(where selected_exit_route='crack') crack_child_count,
    count(*) filter(where selected_exit_route='sell_sealed') sealed_sale_child_count,
    count(*) filter(where selected_exit_route='already_routed') fixed_child_count,
    count(*) filter(where selected_exit_route='unresolved') unresolved_child_count
  from public.sealed_child_exit_decision_current
  group by user_id,parent_sealed_uuid
)
select c.user_id,c.sealed_uuid,
  c.practical_liquidation_ev base_practical_liquidation_ev,
  case when c.practical_liquidation_ev is not null
    then round(c.practical_liquidation_ev+coalesce(r.child_exit_adjustment,0),4) end exit_optimized_practical_ev,
  coalesce(r.child_exit_adjustment,0) child_exit_adjustment,
  coalesce(r.selected_child_exit_ev,0) selected_child_exit_ev,
  coalesce(r.crack_child_count,0) crack_child_count,
  coalesce(r.sealed_sale_child_count,0) sealed_sale_child_count,
  coalesce(r.fixed_child_count,0) fixed_child_count,
  coalesce(r.unresolved_child_count,0) unresolved_child_count,
  'base practical EV plus only the modeled child-route improvement; never crack plus sealed resale'::text optimization_policy
from public.sealed_product_executable_ev_cache c
left join child_rollup r on r.user_id=c.user_id and r.parent_sealed_uuid=c.sealed_uuid;

notify pgrst,'reload schema';
