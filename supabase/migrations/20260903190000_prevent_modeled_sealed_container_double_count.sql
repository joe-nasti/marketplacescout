-- A modeled box/case and its child-component row describe the same packs.
-- Prefer the direct collation model when both exist; only add children to a
-- fixed-content parent whose own cards are genuinely additive (for example,
-- a gift bundle containing packs plus promos).

create or replace view public.sealed_product_executable_ev_current
with (security_invoker=true) as
with users as (select distinct user_id from public.sealed_set_profiles where enabled),
base_keys as (
 select user_id,sealed_uuid from public.sealed_ev_channel_current
 union select u.user_id,f.sealed_uuid from users u cross join public.sealed_fixed_executable_ev f
), base as (
 select k.user_id,k.sealed_uuid,
   coalesce(e.tcg_low_ev,0)+case when e.sealed_uuid is null then coalesce(f.fixed_tcg_low_ev,0) else 0 end tcg_low_ev,
   coalesce(e.direct_first_net_ev,0)+case when e.sealed_uuid is null then coalesce(f.fixed_direct_first_net_ev,0) else 0 end direct_first_net_ev,
   coalesce(e.collectish_live_out_ev,0)+case when e.sealed_uuid is null then coalesce(f.fixed_collectish_live_out_ev,0) else 0 end collectish_live_out_ev,
   coalesce(f.fixed_tcg_low_ev,0) fixed_tcg_low_ev,
   coalesce(f.fixed_collectish_live_out_ev,0) fixed_collectish_live_out_ev,
   coalesce(e.price_coverage_pct,100) price_coverage_pct,
   e.model_key,e.model_version,e.valuation_as_of,
   case when e.sealed_uuid is not null then 'randomized_current_only'
        else 'fixed_current_only' end valuation_basis
 from base_keys k
 left join public.sealed_ev_channel_current e
   on e.user_id=k.user_id and e.sealed_uuid=k.sealed_uuid
 left join public.sealed_fixed_executable_ev f on f.sealed_uuid=k.sealed_uuid
), children as (
 select u.user_id,c.parent_sealed_uuid,
   sum(c.quantity*b.tcg_low_ev) child_tcg_low_ev,
   sum(c.quantity*b.direct_first_net_ev) child_direct_first_net_ev,
   sum(c.quantity*b.collectish_live_out_ev) child_collectish_live_out_ev,
   sum(c.quantity) filter(where b.sealed_uuid is not null) modeled_child_units,
   min(b.price_coverage_pct) child_price_coverage_pct
 from users u cross join public.sealed_product_child_components c
 left join base b on b.user_id=u.user_id and b.sealed_uuid=c.child_sealed_uuid
 group by u.user_id,c.parent_sealed_uuid
), keys as (
 select user_id,sealed_uuid from base
 union select user_id,parent_sealed_uuid from children
)
select k.user_id,k.sealed_uuid,
 case when b.model_key is not null then b.tcg_low_ev
      else coalesce(b.tcg_low_ev,0)+coalesce(ch.child_tcg_low_ev,0) end tcg_low_ev,
 case when b.model_key is not null then b.direct_first_net_ev
      else coalesce(b.direct_first_net_ev,0)+coalesce(ch.child_direct_first_net_ev,0) end direct_first_net_ev,
 case when b.model_key is not null then b.collectish_live_out_ev
      else coalesce(b.collectish_live_out_ev,0)+coalesce(ch.child_collectish_live_out_ev,0) end collectish_live_out_ev,
 coalesce(b.fixed_tcg_low_ev,0) fixed_tcg_low_ev,
 coalesce(b.fixed_collectish_live_out_ev,0) fixed_collectish_live_out_ev,
 case when b.model_key is not null then 0 else coalesce(ch.modeled_child_units,0) end modeled_child_units,
 case when b.model_key is not null then b.price_coverage_pct
      else least(coalesce(b.price_coverage_pct,100),coalesce(ch.child_price_coverage_pct,100)) end price_coverage_pct,
 case when b.model_key is not null then b.valuation_basis
      when ch.parent_sealed_uuid is not null and b.sealed_uuid is not null then 'children_plus_fixed_current_only'
      when ch.parent_sealed_uuid is not null then 'children_current_only'
      else b.valuation_basis end valuation_basis,
 b.model_key,b.model_version,b.valuation_as_of
from keys k
left join base b on b.user_id=k.user_id and b.sealed_uuid=k.sealed_uuid
left join children ch on ch.user_id=k.user_id and ch.parent_sealed_uuid=k.sealed_uuid;

grant select on public.sealed_product_executable_ev_current to authenticated,service_role;

notify pgrst,'reload schema';
