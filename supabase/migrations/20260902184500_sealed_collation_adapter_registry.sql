-- Generic sealed collation registry. Hobbit is the first data-backed profile, not a special UI path.
create table if not exists public.sealed_collation_adapters (
  adapter_key text primary key,
  adapter_family text not null,
  display_name text not null,
  model_kind text not null check (model_kind in ('probabilistic_pack','probabilistic_box','composite','deterministic','container','special_randomized')),
  reusable_across_sets boolean not null default true,
  description text,
  default_assumptions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sealed_collation_profile_bindings (
  binding_id uuid primary key default gen_random_uuid(),
  set_code text not null,
  sealed_uuid uuid references public.mtgjson_sealed_products(uuid) on delete cascade,
  product_category text,
  product_subtype text,
  adapter_key text not null references public.sealed_collation_adapters(adapter_key),
  model_version text not null,
  profile_status text not null check (profile_status in ('full','partial','component_only','deterministic','unmodeled')),
  source_type text not null default 'internal',
  source_ref text,
  assumptions jsonb not null default '{}'::jsonb,
  priority integer not null default 100,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sealed_collation_binding_scope_check check (sealed_uuid is not null or product_category is not null or product_subtype is not null)
);
create index if not exists sealed_collation_binding_lookup_idx on public.sealed_collation_profile_bindings(set_code,enabled,priority,product_category,product_subtype);
create index if not exists sealed_collation_binding_uuid_idx on public.sealed_collation_profile_bindings(sealed_uuid) where sealed_uuid is not null and enabled;

insert into public.sealed_collation_adapters(adapter_key,adapter_family,display_name,model_kind,reusable_across_sets,description,default_assumptions) values
('modern_play_booster_official_v1','modern_play','Modern Play Booster · official slots','probabilistic_pack',true,'Generic Play Booster adapter driven by set-specific official slot percentages and card pools','{"requires_slot_profile":true,"pool_weighting":"set_specific"}'),
('modern_play_box_official_v1','modern_play','Modern Play Booster Box · official slots','probabilistic_box',true,'Play Booster box adapter composed from Play Boosters plus box extras','{"requires_pack_adapter":"modern_play_booster_official_v1"}'),
('modern_collector_booster_official_v1','modern_collector','Modern Collector Booster · official slots','probabilistic_pack',true,'Collector Booster adapter driven by official slot probabilities and treatment pools','{"requires_slot_profile":true,"pool_weighting":"set_specific"}'),
('modern_collector_box_official_v1','modern_collector','Modern Collector Booster Box · official slots','probabilistic_box',true,'Collector Booster box adapter composed from Collector Boosters plus box extras','{"requires_pack_adapter":"modern_collector_booster_official_v1"}'),
('sealed_composite_children_v1','composite','Composite sealed product','composite',true,'Rolls up modeled child sealed products and exact deterministic card components','{"requires_complete_children":true}'),
('sealed_deterministic_cards_v1','deterministic','Deterministic card product','deterministic',true,'Fixed-card/deck products valued from exact printing contents','{"randomized_slots":false}'),
('sealed_container_rollup_v1','container','Sealed container/case','container',true,'Case/container economics derived from modeled child sealed products','{"requires_complete_children":true}'),
('special_randomized_product_v1','special_randomized','Special randomized product','special_randomized',false,'Escape hatch for randomized products that do not match normal booster adapters','{"generic_booster":false}')
on conflict(adapter_key) do update set adapter_family=excluded.adapter_family,display_name=excluded.display_name,model_kind=excluded.model_kind,reusable_across_sets=excluded.reusable_across_sets,description=excluded.description,default_assumptions=excluded.default_assumptions,updated_at=now();

create or replace view public.sealed_collation_binding_resolved as
select p.uuid sealed_uuid,p.set_code,p.name product_name,p.category,p.subtype,b.binding_id,b.adapter_key,a.adapter_family,a.display_name adapter_name,a.model_kind,a.reusable_across_sets,b.model_version,b.profile_status,b.source_type,b.source_ref,b.assumptions,b.priority
from public.mtgjson_sealed_products p
left join lateral (
  select x.* from public.sealed_collation_profile_bindings x
  where x.enabled and upper(x.set_code)=upper(p.set_code)
    and (x.sealed_uuid is null or x.sealed_uuid=p.uuid)
    and (x.product_category is null or x.product_category=p.category)
    and (x.product_subtype is null or x.product_subtype=p.subtype)
  order by (x.sealed_uuid is not null) desc,(x.product_subtype is not null) desc,(x.product_category is not null) desc,x.priority asc,x.created_at desc limit 1
) b on true
left join public.sealed_collation_adapters a on a.adapter_key=b.adapter_key;

grant select on public.sealed_collation_adapters,public.sealed_collation_profile_bindings,public.sealed_collation_binding_resolved to authenticated,service_role;

-- HOB exact profile bindings.
insert into public.sealed_collation_profile_bindings(set_code,sealed_uuid,adapter_key,model_version,profile_status,source_type,source_ref,assumptions,priority) values
('HOB','cc3d4b38-33da-5bf3-84f7-70df313f9997','modern_play_booster_official_v1','hobbit-play-v1-rounded-official','full','wizards_official','https://magic.wizards.com/en/news/feature/collecting-the-hobbit','{"rounded_lt_1pct_residual":"eligible_pool_size"}',10),
('HOB','28d49eb7-16ae-5ed9-8f37-efff67fd54c1','modern_play_box_official_v1','hobbit-play-v1-rounded-official','full','wizards_official','https://magic.wizards.com/en/news/feature/collecting-the-hobbit','{"packs":30,"box_topper":true}',10),
('HOB','8fb173c2-250c-5919-8431-cc24685d10d3','modern_collector_booster_official_v1','hobbit-collector-v1-official','full','wizards_official','https://magic.wizards.com/en/news/feature/collecting-the-hobbit','{"box_only_topper":false}',10),
('HOB','9f730c77-137a-5c4d-905d-8e9ab96a1739','modern_collector_box_official_v1','hobbit-collector-v1-official','full','wizards_official','https://magic.wizards.com/en/news/feature/collecting-the-hobbit','{"packs":12,"box_topper":true,"gleaming_gold_smaug":"excluded_unmodeled_jackpot"}',10),
('HOB','ac894328-92e0-52fc-b0e1-c2362c666b3e','sealed_composite_children_v1','hobbit-composite-v1','full','wizards_official','https://magic.wizards.com/en/news/feature/collecting-the-hobbit','{"children":"9 play boosters","fixed_cards":"lands+promo","noncard_extras_excluded":true}',10),
('HOB','26bd45e8-3996-5051-a92f-d2c84a763c32','sealed_composite_children_v1','hobbit-composite-v1','full','wizards_official','https://magic.wizards.com/en/news/feature/collecting-the-hobbit','{"children":"9 play boosters + 1 collector booster","fixed_cards":"gift lands+promo","noncard_extras_excluded":true}',10),
('HOB','2e548fa4-96d9-51d8-b001-b1639450dabe','sealed_composite_children_v1','hobbit-composite-v1','partial','wizards_official','https://magic.wizards.com/en/news/feature/collecting-the-hobbit','{"children":"12 play boosters + 1 collector booster","unresolved_game_cards":"90 basic lands"}',10),
('HOB','feeebce1-365f-5297-b6d5-179fd80e3286','sealed_composite_children_v1','hobbit-composite-v1','partial','wizards_official','https://magic.wizards.com/en/news/feature/collecting-the-hobbit','{"children":"6 play boosters","unresolved_game_cards":"random foil prerelease promo"}',10),
('HOB','37505164-dd72-5df9-bee2-ce640b077694','sealed_composite_children_v1','hobbit-scene-box-v1','full','wizards_official','https://magic.wizards.com/en/news/feature/all-the-scene-cards-from-the-hobbit','{"children":"3 play boosters","fixed_cards":"HOC 1-6 foil","noncard_extras_excluded":true}',10),
('HOB','4a51d316-794d-5bfd-b16c-3d7c4ac80ed1','sealed_composite_children_v1','hobbit-scene-box-v1','full','wizards_official','https://magic.wizards.com/en/news/feature/all-the-scene-cards-from-the-hobbit','{"children":"3 play boosters","fixed_cards":"HOC 7-12 foil","noncard_extras_excluded":true}',10),
('HOB','c252d520-3061-526e-bee6-26f65db802c9','sealed_container_rollup_v1','hobbit-container-v1','full','mtgjson','HOB sealed products','{"children":"6 collector booster boxes"}',20),
('HOB','f7135d48-ff10-5819-afbc-8945592a8a45','sealed_container_rollup_v1','hobbit-container-v1','component_only','mtgjson','HOB sealed products','{"children":"4 collector booster box cases","sealed_price_quality":"sparse"}',20),
('HOB','b57609aa-65ff-5699-aecd-ecb54e81b3eb','sealed_container_rollup_v1','hobbit-container-v1','full','mtgjson','HOB sealed products','{"children":"6 play booster boxes"}',20),
('HOB','69e472dc-b0cf-5f9d-be5d-63eae86f3d40','sealed_container_rollup_v1','hobbit-container-v1','full','mtgjson','HOB sealed products','{"children":"6 bundles"}',20),
('HOB','6705bce9-9ad3-5038-a823-22cd618ab5f1','sealed_container_rollup_v1','hobbit-container-v1','full','mtgjson','HOB sealed products','{"children":"6 gift bundles"}',20),
('HOB','7f0464af-f8c6-5350-9a31-f1658bb68802','sealed_container_rollup_v1','hobbit-container-v1','partial','mtgjson','HOB sealed products','{"children":"6 draft nights","inherits_partial_child":true}',20),
('HOB','cf5585ca-7a1e-5d47-97b7-a017f0db2bfb','sealed_container_rollup_v1','hobbit-container-v1','partial','mtgjson','HOB sealed products','{"children":"15 prerelease packs","inherits_partial_child":true}',20),
('HOB','80074b6f-8c3a-545d-b720-790a1f69aa07','sealed_container_rollup_v1','hobbit-container-v1','full','mtgjson','HOB sealed products','{"children":"2 each scene box"}',20),
('HOB','8a6030c7-5e91-5316-ba3a-726418feb61a','sealed_container_rollup_v1','hobbit-container-v1','full','mtgjson','HOB sealed products','{"children":"scene box set of 2"}',20)
on conflict do nothing;
insert into public.sealed_collation_profile_bindings(set_code,product_category,adapter_key,model_version,profile_status,source_type,source_ref,assumptions,priority)
select 'HOB','deck','sealed_deterministic_cards_v1','mtgjson-deck-v1','deterministic','mtgjson','HOB deck contents','{"exact_deck_contents":true}',90
where not exists(select 1 from public.sealed_collation_profile_bindings where set_code='HOB' and sealed_uuid is null and product_category='deck' and adapter_key='sealed_deterministic_cards_v1');

create or replace view public.sealed_product_model_coverage as
select e.user_id,e.sealed_uuid,e.set_code,e.product_name,e.category,e.subtype,r.adapter_key,r.adapter_family,r.adapter_name,r.model_kind,r.model_version adapter_model_version,r.profile_status,r.source_type collation_source_type,r.source_ref collation_source_ref,e.model_status,e.crack_value_basis,e.crack_value_complete,e.crack_gross_mean_ev,e.crack_net_mean_ev,e.unresolved_deck_components,e.unresolved_pack_components,e.unresolved_other_components,
case when r.profile_status='deterministic' and coalesce(e.crack_value_complete,false) then 'DETERMINISTIC' when r.profile_status='full' and coalesce(e.crack_value_complete,false) then 'FULL MODEL' when e.crack_value_basis='direct_backtest' and coalesce(e.crack_value_complete,false) then 'FULL MODEL' when r.profile_status='partial' or (e.crack_value_basis='direct_backtest' and not coalesce(e.crack_value_complete,false)) then 'COLLATION PARTIAL' when r.profile_status='component_only' or (e.crack_value_basis='modeled_components' and not coalesce(e.crack_value_complete,false)) then 'COMPONENT FLOOR' when e.category='deck' and coalesce(e.crack_value_complete,false) then 'DETERMINISTIC' when e.crack_value_basis='modeled_components' and coalesce(e.crack_value_complete,false) then 'FULL MODEL' else 'UNMODELED' end coverage_state,
case when r.profile_status='deterministic' and coalesce(e.crack_value_complete,false) then true when r.profile_status='full' and coalesce(e.crack_value_complete,false) then true when e.crack_value_basis='direct_backtest' and coalesce(e.crack_value_complete,false) then true when e.crack_value_basis='modeled_components' and coalesce(e.crack_value_complete,false) then true else false end recommendation_eligible,
case when r.binding_id is null then 'No collation profile binding' when r.profile_status='partial' then 'Collation profile is explicitly partial' when r.profile_status='component_only' then 'Only component-level value is modeled' when not coalesce(e.crack_value_complete,false) then 'One or more game-card components remain unresolved' else 'Modeled card value is complete for the registered profile' end coverage_reason,
e.release_date,e.tcgplayer_product_id,e.sealed_market_price,e.sealed_low_price,e.sealed_low_with_shipping,e.sealed_price_at,e.crack_gross_median_ev,e.crack_p10_ev,e.crack_p90_ev,e.crack_break_even_probability,e.crack_net_break_even_probability,e.deterministic_ck_buylist_ev,e.fixed_ck_buylist_ev,e.noncard_extras_excluded,e.modeled_child_components,e.unmodeled_child_components,e.deterministic_deck_components
from public.sealed_product_family_economics e left join public.sealed_collation_binding_resolved r on r.sealed_uuid=e.sealed_uuid;
grant select on public.sealed_product_model_coverage to authenticated,service_role;
