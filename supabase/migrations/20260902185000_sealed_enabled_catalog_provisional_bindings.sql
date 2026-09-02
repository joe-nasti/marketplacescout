-- Classify enabled sealed sets into reusable adapter families without granting recommendations.
insert into public.sealed_collation_adapters(adapter_key,adapter_family,display_name,model_kind,reusable_across_sets,description,default_assumptions) values
('draft_booster_official_v1','draft_booster','Draft Booster · official slots','probabilistic_pack',true,'Draft Booster adapter requiring set-specific official collation','{"requires_slot_profile":true}'),
('draft_booster_box_official_v1','draft_booster','Draft Booster Box · official slots','probabilistic_box',true,'Draft Booster box composed from Draft Boosters plus box extras','{"requires_pack_adapter":"draft_booster_official_v1"}'),
('set_booster_official_v1','set_booster','Set Booster · official slots','probabilistic_pack',true,'Set Booster adapter requiring set-specific official collation','{"requires_slot_profile":true}'),
('set_booster_box_official_v1','set_booster','Set Booster Box · official slots','probabilistic_box',true,'Set Booster box composed from Set Boosters plus box extras','{"requires_pack_adapter":"set_booster_official_v1"}'),
('other_booster_unclassified_v1','other_booster','Other booster · collation pending','probabilistic_pack',true,'Placeholder for booster products needing product-specific classification','{"classification_pending":true}')
on conflict(adapter_key) do update set adapter_family=excluded.adapter_family,display_name=excluded.display_name,model_kind=excluded.model_kind,reusable_across_sets=excluded.reusable_across_sets,description=excluded.description,default_assumptions=excluded.default_assumptions,updated_at=now();

with enabled_sets as (
  select distinct upper(set_code) set_code from public.sealed_set_profiles where enabled and upper(set_code) not in ('HOB','SLD')
), candidates as (
  select distinct e.set_code,p.category,p.subtype,
    case
      when p.category='deck' then 'sealed_deterministic_cards_v1'
      when p.category='booster_pack' and p.subtype='collector' then 'modern_collector_booster_official_v1'
      when p.category='booster_box' and p.subtype='collector' then 'modern_collector_box_official_v1'
      when p.category='booster_pack' and p.subtype='play' then 'modern_play_booster_official_v1'
      when p.category='booster_box' and p.subtype='play' then 'modern_play_box_official_v1'
      when p.category='booster_pack' and p.subtype='draft' then 'draft_booster_official_v1'
      when p.category='booster_box' and p.subtype='draft' then 'draft_booster_box_official_v1'
      when p.category='booster_pack' and p.subtype='set' then 'set_booster_official_v1'
      when p.category='booster_box' and p.subtype='set' then 'set_booster_box_official_v1'
      when p.category='booster_pack' then 'other_booster_unclassified_v1'
      when p.category in ('bundle','box_set','limited_aid_tool') then 'sealed_composite_children_v1'
      when p.category in ('booster_case','bundle_case','limited_aid_case','deck_box','multiple_decks','subset') then 'sealed_container_rollup_v1'
      else null end adapter_key,
    case when p.category='deck' then 'deterministic'
         when p.category in ('bundle','box_set','limited_aid_tool','booster_case','bundle_case','limited_aid_case','deck_box','multiple_decks','subset') then 'component_only'
         else 'unmodeled' end profile_status
  from enabled_sets e join public.mtgjson_sealed_products p on upper(p.set_code)=e.set_code
)
insert into public.sealed_collation_profile_bindings(set_code,product_category,product_subtype,adapter_key,model_version,profile_status,source_type,source_ref,assumptions,priority)
select c.set_code,c.category,c.subtype,c.adapter_key,'catalog-provisional-v1',c.profile_status,'mtgjson','enabled sealed catalog','{"provisional":true,"recommendations_require_complete_economics":true}',200
from candidates c where c.adapter_key is not null
and not exists(select 1 from public.sealed_collation_profile_bindings b where upper(b.set_code)=c.set_code and b.sealed_uuid is null and b.product_category=c.category and coalesce(b.product_subtype,'')=coalesce(c.subtype,''));
