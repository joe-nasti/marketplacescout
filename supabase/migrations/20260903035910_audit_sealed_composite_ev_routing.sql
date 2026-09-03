-- Per-user invariant surface for composite sealed EV. Fixed-card children are
-- already expanded into parent routes; only modeled randomized children add EV.
create or replace view public.sealed_composite_ev_audit_current
with (security_invoker=true) as
with classified as (
  select pe.user_id,c.parent_sealed_uuid,c.child_sealed_uuid,c.child_product_name,c.quantity,
    ce.valuation_basis,ce.practical_liquidation_ev,
    case
      when lower(coalesce(ce.valuation_basis,'')) like '%fixed%' then 'already_routed'
      when ce.valuation_basis is not null then 'additive_randomized'
      else 'unresolved'
    end child_route_class
  from public.sealed_product_executable_ev_cache pe
  join public.sealed_product_child_components c on c.parent_sealed_uuid=pe.sealed_uuid
  left join public.sealed_product_executable_ev_cache ce
    on ce.user_id=pe.user_id and ce.sealed_uuid=c.child_sealed_uuid
), rollup as (
  select user_id,parent_sealed_uuid,
    count(*) child_count,
    count(*) filter(where child_route_class='already_routed') fixed_child_count,
    count(*) filter(where child_route_class='additive_randomized') randomized_child_count,
    count(*) filter(where child_route_class='unresolved') unresolved_child_count,
    round(coalesce(sum(quantity*coalesce(practical_liquidation_ev,0))
      filter(where child_route_class='already_routed'),0),4) already_routed_child_ev,
    round(coalesce(sum(quantity*coalesce(practical_liquidation_ev,0))
      filter(where child_route_class='additive_randomized'),0),4) additive_child_ev
  from classified group by user_id,parent_sealed_uuid
)
select r.user_id,r.parent_sealed_uuid,p.set_code,p.name parent_product_name,
  r.child_count,r.fixed_child_count,r.randomized_child_count,r.unresolved_child_count,
  r.already_routed_child_ev,r.additive_child_ev,
  case
    when r.fixed_child_count>0 and r.randomized_child_count>0 then 'mixed'
    when r.fixed_child_count>0 and r.unresolved_child_count>0 then 'fixed_with_unresolved'
    when r.fixed_child_count>0 then 'deterministic'
    when r.randomized_child_count>0 and r.unresolved_child_count>0 then 'randomized_with_unresolved'
    when r.randomized_child_count>0 then 'randomized'
    else 'unresolved'
  end audit_state,
  (r.unresolved_child_count=0) complete,
  'fixed child EV is comparison-only; additive_child_ev contains randomized children only'::text invariant
from rollup r
join public.mtgjson_sealed_products p on p.uuid=r.parent_sealed_uuid;

grant select on public.sealed_composite_ev_audit_current to authenticated,service_role;
notify pgrst,'reload schema';
