-- Generalize deterministic executable EV to exact 100-card Commander products.
-- Products containing an additional sealed sample pack remain component-only
-- until that child product has a complete executable model.

create index if not exists mtgjson_decks_sealed_products_gin_idx
  on public.mtgjson_decks using gin(sealed_product_uuids jsonb_ops)
  where sealed_product_uuids is not null;

create unique index if not exists sealed_collation_commander_generated_binding_idx
  on public.sealed_collation_profile_bindings(sealed_uuid,source_ref)
  where source_ref in ('MTGJSON exact Commander deck v2','MTGJSON exact Commander container v2');

create or replace function public.refresh_sealed_deterministic_deck_components()
returns jsonb
language plpgsql
security invoker
set search_path=''
set statement_timeout='180s'
as $$
declare
  v_upserted integer:=0;
  v_deleted integer:=0;
  v_decks integer:=0;
  v_complete integer:=0;
  v_component_only integer:=0;
  v_containers integer:=0;
begin
  with deck_totals as materialized (
    select dc.deck_key,sum(dc.quantity)::integer total_cards
    from public.mtgjson_deck_cards dc group by dc.deck_key
  ), eligible as materialized (
    select p.uuid sealed_uuid,p.set_code,d.deck_key
    from public.mtgjson_sealed_products p
    join public.mtgjson_decks d
      on coalesce(d.sealed_product_uuids,'[]'::jsonb) ? p.uuid::text
    join deck_totals t on t.deck_key=d.deck_key and t.total_cards=100
    where p.category='deck' and lower(coalesce(p.subtype,''))='commander'
      and d.deck_type<>'Bundle Land Pack'
  )
  insert into public.sealed_product_fixed_card_components as existing
    (sealed_uuid,card_uuid,finish,quantity,component_type,provenance,notes)
  select e.sealed_uuid,dc.card_uuid,dc.finish,dc.quantity,'deck_card',
    'mtgjson-commander-deck-v2','Exact 100-card MTGJSON Commander deck contents'
  from eligible e join public.mtgjson_deck_cards dc on dc.deck_key=e.deck_key
  on conflict(sealed_uuid,card_uuid,finish,component_type)
  do update set quantity=excluded.quantity,provenance=excluded.provenance,notes=excluded.notes
  where (existing.quantity,existing.provenance,existing.notes)
    is distinct from (excluded.quantity,excluded.provenance,excluded.notes);
  get diagnostics v_upserted=row_count;

  with deck_totals as materialized (
    select dc.deck_key,sum(dc.quantity)::integer total_cards
    from public.mtgjson_deck_cards dc group by dc.deck_key
  ), source_rows as materialized (
    select p.uuid sealed_uuid,dc.card_uuid,dc.finish
    from public.mtgjson_sealed_products p
    join public.mtgjson_decks d
      on coalesce(d.sealed_product_uuids,'[]'::jsonb) ? p.uuid::text
    join deck_totals t on t.deck_key=d.deck_key and t.total_cards=100
    join public.mtgjson_deck_cards dc on dc.deck_key=d.deck_key
    where p.category='deck' and lower(coalesce(p.subtype,''))='commander'
      and d.deck_type<>'Bundle Land Pack'
  )
  delete from public.sealed_product_fixed_card_components fc
  where fc.provenance='mtgjson-commander-deck-v2'
    and not exists (
      select 1 from source_rows s where s.sealed_uuid=fc.sealed_uuid
        and s.card_uuid=fc.card_uuid and s.finish=fc.finish
    );
  get diagnostics v_deleted=row_count;

  with deck_totals as materialized (
    select dc.deck_key,sum(dc.quantity)::integer total_cards
    from public.mtgjson_deck_cards dc group by dc.deck_key
  ), eligible as materialized (
    select distinct p.uuid sealed_uuid,p.set_code,
      coalesce(jsonb_array_length(p.contents->'sealed'),0)::integer child_count
    from public.mtgjson_sealed_products p
    join public.mtgjson_decks d
      on coalesce(d.sealed_product_uuids,'[]'::jsonb) ? p.uuid::text
    join deck_totals t on t.deck_key=d.deck_key and t.total_cards=100
    where p.category='deck' and lower(coalesce(p.subtype,''))='commander'
      and d.deck_type<>'Bundle Land Pack'
  )
  update public.sealed_collation_profile_bindings b set
    set_code=e.set_code,adapter_key='sealed_deterministic_cards_v1',
    model_version='mtgjson-commander-deck-v2',
    profile_status=case when e.child_count=0 then 'deterministic' else 'component_only' end,
    source_type='mtgjson',
    assumptions=jsonb_build_object('exact_deck_cards',100,'unmodeled_sealed_children',e.child_count),
    enabled=true,updated_at=now()
  from eligible e
  where b.sealed_uuid=e.sealed_uuid and b.source_ref='MTGJSON exact Commander deck v2';

  with deck_totals as materialized (
    select dc.deck_key,sum(dc.quantity)::integer total_cards
    from public.mtgjson_deck_cards dc group by dc.deck_key
  ), eligible as materialized (
    select distinct p.uuid sealed_uuid,p.set_code,
      coalesce(jsonb_array_length(p.contents->'sealed'),0)::integer child_count
    from public.mtgjson_sealed_products p
    join public.mtgjson_decks d
      on coalesce(d.sealed_product_uuids,'[]'::jsonb) ? p.uuid::text
    join deck_totals t on t.deck_key=d.deck_key and t.total_cards=100
    where p.category='deck' and lower(coalesce(p.subtype,''))='commander'
      and d.deck_type<>'Bundle Land Pack'
  )
  insert into public.sealed_collation_profile_bindings
    (set_code,sealed_uuid,adapter_key,model_version,profile_status,source_type,
     source_ref,assumptions,priority,enabled)
  select e.set_code,e.sealed_uuid,'sealed_deterministic_cards_v1','mtgjson-commander-deck-v2',
    case when e.child_count=0 then 'deterministic' else 'component_only' end,
    'mtgjson','MTGJSON exact Commander deck v2',
    jsonb_build_object('exact_deck_cards',100,'unmodeled_sealed_children',e.child_count),600,true
  from eligible e
  where not exists (
    select 1 from public.sealed_collation_profile_bindings b
    where b.sealed_uuid=e.sealed_uuid and b.source_ref='MTGJSON exact Commander deck v2'
  );

  update public.sealed_collation_profile_bindings b set enabled=false,updated_at=now()
  where b.source_ref='MTGJSON exact Commander deck v2' and not exists (
    select 1 from public.mtgjson_sealed_products p
    join public.mtgjson_decks d
      on coalesce(d.sealed_product_uuids,'[]'::jsonb) ? p.uuid::text
    join (select deck_key,sum(quantity)::integer cards from public.mtgjson_deck_cards group by deck_key) t
      on t.deck_key=d.deck_key and t.cards=100
    where p.uuid=b.sealed_uuid and p.category='deck'
      and lower(coalesce(p.subtype,''))='commander' and d.deck_type<>'Bundle Land Pack'
  );

  with exact_decks as materialized (
    select distinct p.uuid
    from public.mtgjson_sealed_products p
    join public.mtgjson_decks d
      on coalesce(d.sealed_product_uuids,'[]'::jsonb) ? p.uuid::text
    join (select deck_key,sum(quantity)::integer cards from public.mtgjson_deck_cards group by deck_key) t
      on t.deck_key=d.deck_key and t.cards=100
    where p.category='deck' and lower(coalesce(p.subtype,''))='commander'
      and d.deck_type<>'Bundle Land Pack'
      and coalesce(jsonb_array_length(p.contents->'sealed'),0)=0
  ), eligible_containers as materialized (
    select p.uuid sealed_uuid,p.set_code,count(*)::integer child_count
    from public.mtgjson_sealed_products p
    join public.sealed_product_child_components c on c.parent_sealed_uuid=p.uuid
    join exact_decks d on d.uuid=c.child_sealed_uuid
    group by p.uuid,p.set_code
    having count(*)=coalesce(jsonb_array_length(p.contents->'sealed'),0)
  )
  update public.sealed_collation_profile_bindings b set
    set_code=e.set_code,adapter_key='sealed_container_rollup_v1',
    model_version='mtgjson-commander-container-v2',profile_status='deterministic',
    source_type='mtgjson',assumptions=jsonb_build_object('exact_child_decks',e.child_count),
    enabled=true,updated_at=now()
  from eligible_containers e
  where b.sealed_uuid=e.sealed_uuid and b.source_ref='MTGJSON exact Commander container v2';

  with exact_decks as materialized (
    select distinct p.uuid
    from public.mtgjson_sealed_products p
    join public.mtgjson_decks d
      on coalesce(d.sealed_product_uuids,'[]'::jsonb) ? p.uuid::text
    join (select deck_key,sum(quantity)::integer cards from public.mtgjson_deck_cards group by deck_key) t
      on t.deck_key=d.deck_key and t.cards=100
    where p.category='deck' and lower(coalesce(p.subtype,''))='commander'
      and d.deck_type<>'Bundle Land Pack'
      and coalesce(jsonb_array_length(p.contents->'sealed'),0)=0
  ), eligible_containers as materialized (
    select p.uuid sealed_uuid,p.set_code,count(*)::integer child_count
    from public.mtgjson_sealed_products p
    join public.sealed_product_child_components c on c.parent_sealed_uuid=p.uuid
    join exact_decks d on d.uuid=c.child_sealed_uuid
    group by p.uuid,p.set_code
    having count(*)=coalesce(jsonb_array_length(p.contents->'sealed'),0)
  )
  insert into public.sealed_collation_profile_bindings
    (set_code,sealed_uuid,adapter_key,model_version,profile_status,source_type,
     source_ref,assumptions,priority,enabled)
  select e.set_code,e.sealed_uuid,'sealed_container_rollup_v1','mtgjson-commander-container-v2',
    'deterministic','mtgjson','MTGJSON exact Commander container v2',
    jsonb_build_object('exact_child_decks',e.child_count),600,true
  from eligible_containers e
  where not exists (
    select 1 from public.sealed_collation_profile_bindings b
    where b.sealed_uuid=e.sealed_uuid and b.source_ref='MTGJSON exact Commander container v2'
  );

  with exact_decks as materialized (
    select distinct p.uuid
    from public.mtgjson_sealed_products p
    join public.mtgjson_decks d
      on coalesce(d.sealed_product_uuids,'[]'::jsonb) ? p.uuid::text
    join (select deck_key,sum(quantity)::integer cards from public.mtgjson_deck_cards group by deck_key) t
      on t.deck_key=d.deck_key and t.cards=100
    where p.category='deck' and lower(coalesce(p.subtype,''))='commander'
      and d.deck_type<>'Bundle Land Pack'
      and coalesce(jsonb_array_length(p.contents->'sealed'),0)=0
  ), eligible_containers as materialized (
    select p.uuid sealed_uuid
    from public.mtgjson_sealed_products p
    join public.sealed_product_child_components c on c.parent_sealed_uuid=p.uuid
    join exact_decks d on d.uuid=c.child_sealed_uuid
    group by p.uuid
    having count(*)=coalesce(jsonb_array_length(p.contents->'sealed'),0)
  )
  update public.sealed_collation_profile_bindings b set enabled=false,updated_at=now()
  where b.source_ref='MTGJSON exact Commander container v2' and b.enabled
    and not exists (
      select 1 from eligible_containers e where e.sealed_uuid=b.sealed_uuid
    );

  select count(*),count(*) filter(where coalesce(jsonb_array_length(p.contents->'sealed'),0)=0),
    count(*) filter(where coalesce(jsonb_array_length(p.contents->'sealed'),0)>0)
  into v_decks,v_complete,v_component_only
  from public.mtgjson_sealed_products p
  where exists(select 1 from public.sealed_collation_profile_bindings b
    where b.sealed_uuid=p.uuid and b.source_ref='MTGJSON exact Commander deck v2' and b.enabled);

  select count(*) into v_containers from public.sealed_collation_profile_bindings b
  where b.source_ref='MTGJSON exact Commander container v2' and b.enabled;

  return jsonb_build_object('component_rows_upserted',v_upserted,'stale_rows_deleted',v_deleted,
    'exact_deck_products',v_decks,'deterministic_decks',v_complete,
    'component_only_decks',v_component_only,'deterministic_containers',v_containers);
end $$;

revoke all on function public.refresh_sealed_deterministic_deck_components() from public,anon,authenticated;
grant execute on function public.refresh_sealed_deterministic_deck_components() to service_role;

select public.refresh_sealed_deterministic_deck_components();
notify pgrst,'reload schema';
