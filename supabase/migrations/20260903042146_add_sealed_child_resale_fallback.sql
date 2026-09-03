-- Conservative fallback for genuine sealed child products that do not yet
-- have a fixed-card or randomized collation model. This is a sealed resale
-- route, not crack EV, and never uses TCG Market.
create or replace view public.sealed_child_resale_fallback_current
with (security_invoker=true) as
with users as (
  select distinct user_id from public.sealed_set_profiles where enabled
), children as (
  select distinct child_sealed_uuid from public.sealed_product_child_components
), priced as (
  select u.user_id,p.uuid sealed_uuid,p.name product_name,
    coalesce(sp.low_with_shipping,sp.low_price)::numeric sealed_tcg_low,
    sp.total_listings,sp.captured_at
  from users u cross join children c
  join public.mtgjson_sealed_products p on p.uuid=c.child_sealed_uuid
  join public.sealed_product_price_current sp
    on sp.sealed_uuid=p.uuid and sp.source='tcgplayer_public'
  left join public.sealed_product_executable_ev_cache ce
    on ce.user_id=u.user_id and ce.sealed_uuid=p.uuid
  where ce.valuation_basis is null and p.category='box_set'
    and p.subtype like 'secret_lair%'
    and coalesce(sp.low_with_shipping,sp.low_price)>0
    and coalesce(sp.total_listings,0)>0
)
select user_id,sealed_uuid,product_name,sealed_tcg_low tcg_low_ev,
  public.collectish_tcg_regular_net(sealed_tcg_low) practical_liquidation_ev,
  'sealed_resale_current_only'::text valuation_basis,
  total_listings,captured_at valuation_as_of,
  'TCG Low sealed resale after regular marketplace fees; TCG Market and crack EV excluded'::text valuation_policy
from priced where public.collectish_tcg_regular_net(sealed_tcg_low)>0;

grant select on public.sealed_child_resale_fallback_current to authenticated,service_role;
revoke all on public.sealed_child_resale_fallback_current from anon;

create or replace view public.sealed_composite_ev_audit_current
with (security_invoker=true) as
with classified as (
  select pe.user_id,c.parent_sealed_uuid,c.child_sealed_uuid,c.child_product_name,c.quantity,
    coalesce(ce.valuation_basis,sr.valuation_basis) valuation_basis,
    coalesce(ce.practical_liquidation_ev,sr.practical_liquidation_ev) practical_liquidation_ev,
    case
      when lower(coalesce(ce.valuation_basis,sr.valuation_basis,'')) like '%fixed%' then 'already_routed'
      when coalesce(ce.valuation_basis,sr.valuation_basis) is not null then 'additive_randomized'
      else 'unresolved'
    end child_route_class
  from public.sealed_product_executable_ev_cache pe
  join public.sealed_product_child_components c on c.parent_sealed_uuid=pe.sealed_uuid
  left join public.sealed_product_executable_ev_cache ce
    on ce.user_id=pe.user_id and ce.sealed_uuid=c.child_sealed_uuid
  left join public.sealed_child_resale_fallback_current sr
    on sr.user_id=pe.user_id and sr.sealed_uuid=c.child_sealed_uuid
), rollup as (
  select user_id,parent_sealed_uuid,count(*) child_count,
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
    when r.randomized_child_count>0 then 'randomized' else 'unresolved'
  end audit_state,(r.unresolved_child_count=0) complete,
  'fixed child EV is comparison-only; additive_child_ev contains modeled randomized or sealed-resale child routes only'::text invariant
from rollup r join public.mtgjson_sealed_products p on p.uuid=r.parent_sealed_uuid;

grant select on public.sealed_composite_ev_audit_current to authenticated,service_role;
revoke all on public.sealed_composite_ev_audit_current from anon;
notify pgrst,'reload schema';
