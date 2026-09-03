+-- Prefer depth-verified public prices, reject stale/thin public observations,
-- and expose confidence evidence for every sealed-child exit decision.
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
  order by sp.sealed_uuid,
    case
      when sp.captured_at>=now()-interval '12 hours' and sp.source='tcgplayer_public' and coalesce(sp.total_listings,0)>=2 then 0
      when sp.captured_at>=now()-interval '12 hours' and sp.source='tcgplayer_official_product' then 1
      when sp.captured_at>=now()-interval '12 hours' then 2
      else 3 end,
    sp.captured_at desc
), candidates as (
  select u.user_id,c.parent_sealed_uuid,c.child_sealed_uuid,c.child_product_name,
    c.quantity,p.category,p.subtype,
    case when lower(coalesce(ce.valuation_basis,'')) like '%fixed%' then true else false end fixed_child,
    case when lower(coalesce(ce.valuation_basis,'')) not like '%fixed%'
      then ce.practical_liquidation_ev end crack_unit_net,
    case when p.category='booster_pack'
      and ce.practical_liquidation_ev is not null
      and lower(coalesce(ce.valuation_basis,'')) not like '%fixed%'
      and lp.captured_at>=now()-interval '12 hours'
      and (
        lp.source='tcgplayer_official_product'
        or (lp.source='tcgplayer_public' and coalesce(lp.total_listings,0)>=2)
      )
      then public.collectish_tcg_regular_net(lp.sealed_tcg_low) end sealed_unit_net,
    lp.sealed_tcg_low,lp.source sealed_price_source,lp.captured_at sealed_price_at,
    ce.valuation_basis crack_valuation_basis,ce.valuation_as_of crack_valuation_at,
    lp.total_listings sealed_total_listings,
    case
      when lp.captured_at is null then 'missing'
      when lp.captured_at<now()-interval '12 hours' then 'stale'
      when lp.source='tcgplayer_public' and coalesce(lp.total_listings,0)<2 then 'thin'
      when lp.source='tcgplayer_public' then 'verified'
      else 'unverified' end sealed_depth_status,
    case
      when lp.captured_at>=now()-interval '12 hours' and lp.source='tcgplayer_public' and coalesce(lp.total_listings,0)>=3 then 'HIGH'
      when lp.captured_at>=now()-interval '12 hours' and (
        lp.source='tcgplayer_official_product'
        or (lp.source='tcgplayer_public' and coalesce(lp.total_listings,0)>=2)
      ) then 'MEDIUM'
      else 'LOW' end sealed_route_confidence,
    coalesce(lp.captured_at>=now()-interval '12 hours' and (
      lp.source='tcgplayer_official_product'
      or (lp.source='tcgplayer_public' and coalesce(lp.total_listings,0)>=2)
    ),false) sealed_route_eligible
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
select d.user_id,d.parent_sealed_uuid,d.child_sealed_uuid,d.child_product_name,
  d.quantity,d.category,d.subtype,d.fixed_child,d.crack_unit_net,d.sealed_unit_net,
  d.sealed_tcg_low,d.sealed_price_source,d.sealed_price_at,d.crack_valuation_basis,d.crack_valuation_at,
  d.selected_exit_route,d.selected_unit_net,d.parent_included_unit_net,
  round(d.quantity*d.selected_unit_net,4) selected_contribution,
  round(d.quantity*d.parent_included_unit_net,4) parent_included_contribution,
  round(d.quantity*(d.selected_unit_net-d.parent_included_unit_net),4) parent_adjustment,
  'one modeled child unit chooses max(eligible current crack net, eligible current sealed-sale net); fixed children remain comparison-only'::text decision_policy,
  d.sealed_total_listings,
  round(extract(epoch from (now()-d.sealed_price_at))/3600,2) sealed_price_age_hours,
  d.sealed_depth_status,d.sealed_route_confidence,d.sealed_route_eligible
from decided d;

notify pgrst,'reload schema';
