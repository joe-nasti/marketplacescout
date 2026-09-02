create or replace view public.sealed_product_model_coverage as
select e.user_id,e.sealed_uuid,e.set_code,e.product_name,e.category,e.subtype,r.adapter_key,r.adapter_family,r.adapter_name,r.model_kind,r.model_version adapter_model_version,r.profile_status,r.source_type collation_source_type,r.source_ref collation_source_ref,e.model_status,e.crack_value_basis,e.crack_value_complete,e.crack_gross_mean_ev,e.crack_net_mean_ev,e.unresolved_deck_components,e.unresolved_pack_components,e.unresolved_other_components,
case
 when r.profile_status='deterministic' and coalesce(e.crack_value_complete,false) then 'DETERMINISTIC'
 when r.profile_status='full' and coalesce(e.crack_value_complete,false) then 'FULL MODEL'
 when r.profile_status='partial' then 'COLLATION PARTIAL'
 when r.profile_status='component_only' then 'COMPONENT FLOOR'
 when r.profile_status='unmodeled' then 'UNMODELED'
 when e.crack_value_basis='direct_backtest' and coalesce(e.crack_value_complete,false) then 'FULL MODEL'
 when e.crack_value_basis='direct_backtest' then 'COLLATION PARTIAL'
 when e.category='deck' and coalesce(e.crack_value_complete,false) then 'DETERMINISTIC'
 when e.crack_value_basis='modeled_components' and coalesce(e.crack_value_complete,false) then 'FULL MODEL'
 when e.crack_value_basis='modeled_components' then 'COMPONENT FLOOR'
 else 'UNMODELED' end coverage_state,
case
 when r.profile_status in ('partial','component_only','unmodeled') then false
 when r.profile_status='deterministic' then coalesce(e.crack_value_complete,false)
 when r.profile_status='full' then coalesce(e.crack_value_complete,false)
 when e.crack_value_basis in ('direct_backtest','modeled_components') then coalesce(e.crack_value_complete,false)
 else false end recommendation_eligible,
case
 when r.binding_id is null then 'No collation profile binding'
 when r.profile_status='partial' then 'Collation profile is explicitly partial'
 when r.profile_status='component_only' then 'Only component-level value is modeled'
 when r.profile_status='unmodeled' then 'Adapter family is known but set-specific collation is not hydrated'
 when not coalesce(e.crack_value_complete,false) then 'One or more game-card components remain unresolved'
 else 'Modeled card value is complete for the registered profile' end coverage_reason,
e.release_date,e.tcgplayer_product_id,e.sealed_market_price,e.sealed_low_price,e.sealed_low_with_shipping,e.sealed_price_at,e.crack_gross_median_ev,e.crack_p10_ev,e.crack_p90_ev,e.crack_break_even_probability,e.crack_net_break_even_probability,e.deterministic_ck_buylist_ev,e.fixed_ck_buylist_ev,e.noncard_extras_excluded,e.modeled_child_components,e.unmodeled_child_components,e.deterministic_deck_components
from public.sealed_product_family_economics e left join public.sealed_collation_binding_resolved r on r.sealed_uuid=e.sealed_uuid;
grant select on public.sealed_product_model_coverage to authenticated,service_role;
