-- A parent cannot become recommendation-grade merely because a partial child
-- has a backtest row. Child collation quality must also be complete.
create or replace view public.sealed_product_model_coverage as
with child_quality as (
  select c.parent_sealed_uuid,
         count(*) filter (
           where coalesce(r.profile_status, 'unmodeled') not in ('full', 'deterministic')
         )::int as non_final_child_components
  from public.sealed_product_child_components c
  left join public.sealed_collation_binding_resolved r
    on r.sealed_uuid = c.child_sealed_uuid
  group by c.parent_sealed_uuid
), coverage_input as (
  select e.*,
         r.binding_id,
         r.adapter_key,
         r.adapter_family,
         r.adapter_name,
         r.model_kind,
         r.model_version as adapter_model_version,
         r.profile_status,
         r.source_type as collation_source_type,
         r.source_ref as collation_source_ref,
         coalesce(q.non_final_child_components, 0) as non_final_child_components,
         coalesce(e.crack_value_complete, false)
           and coalesce(q.non_final_child_components, 0) = 0 as quality_complete
  from public.sealed_product_family_economics e
  left join public.sealed_collation_binding_resolved r on r.sealed_uuid = e.sealed_uuid
  left join child_quality q on q.parent_sealed_uuid = e.sealed_uuid
)
select user_id,sealed_uuid,set_code,product_name,category,subtype,adapter_key,adapter_family,adapter_name,model_kind,adapter_model_version,profile_status,collation_source_type,collation_source_ref,model_status,crack_value_basis,
quality_complete as crack_value_complete,crack_gross_mean_ev,crack_net_mean_ev,unresolved_deck_components,unresolved_pack_components,unresolved_other_components,
case
 when profile_status='deterministic' and quality_complete then 'DETERMINISTIC'
 when profile_status='full' and quality_complete then 'FULL MODEL'
 when profile_status='partial' then 'COLLATION PARTIAL'
 when profile_status='component_only' then 'COMPONENT FLOOR'
 when profile_status='unmodeled' then 'UNMODELED'
 when crack_value_basis='direct_backtest' and quality_complete then 'FULL MODEL'
 when crack_value_basis='direct_backtest' then 'COLLATION PARTIAL'
 when category='deck' and quality_complete then 'DETERMINISTIC'
 when crack_value_basis='modeled_components' and quality_complete then 'FULL MODEL'
 when crack_value_basis='modeled_components' then 'COMPONENT FLOOR'
 else 'UNMODELED' end coverage_state,
case
 when profile_status in ('partial','component_only','unmodeled') then false
 when profile_status='deterministic' then quality_complete
 when profile_status='full' then quality_complete
 when crack_value_basis in ('direct_backtest','modeled_components') then quality_complete
 else false end recommendation_eligible,
case
 when binding_id is null then 'No collation profile binding'
 when profile_status='partial' then 'Collation profile is explicitly partial'
 when profile_status='component_only' then 'Only component-level value is modeled'
 when profile_status='unmodeled' then 'Adapter family is known but set-specific collation is not hydrated'
 when non_final_child_components>0 then 'One or more child products has partial or unverified collation'
 when not quality_complete then 'One or more game-card components remain unresolved'
 else 'Modeled card value is complete for the registered profile' end coverage_reason,
release_date,tcgplayer_product_id,sealed_market_price,sealed_low_price,sealed_low_with_shipping,sealed_price_at,crack_gross_median_ev,crack_p10_ev,crack_p90_ev,crack_break_even_probability,crack_net_break_even_probability,deterministic_ck_buylist_ev,fixed_ck_buylist_ev,noncard_extras_excluded,modeled_child_components,unmodeled_child_components,deterministic_deck_components
from coverage_input;

grant select on public.sealed_product_model_coverage to authenticated,service_role;
notify pgrst, 'reload schema';
