create or replace function public.service_resolve_video_noncard_entity_v2(
  p_raw text,
  p_context text default null,
  p_entity_type_hint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  raw text := trim(coalesce(p_raw,''));
  hint text := lower(trim(coalesce(p_entity_type_hint,'')));
  r record;
  exact_count integer := 0;
begin
  if length(raw) < 3 then return null; end if;
  if hint not in ('sealed_product','precon','secret_lair_drop','set') then hint := ''; end if;

  if hint = 'secret_lair_drop' then
    select 'secret_lair_drop'::text as entity_type,d.drop_name as entity_name,d.drop_id::text as entity_id,null::text as product_id,null::text as set_code,0.99::numeric as confidence
      into r from public.secret_lair_drops d where lower(d.drop_name)=lower(raw) limit 1;
  elsif hint = 'precon' then
    select 'precon'::text as entity_type,d.name as entity_name,d.deck_key::text as entity_id,null::text as product_id,d.code as set_code,0.99::numeric as confidence
      into r from public.mtgjson_decks d where lower(d.name)=lower(raw) limit 1;
  elsif hint = 'sealed_product' then
    select 'sealed_product'::text as entity_type,s.name as entity_name,s.uuid::text as entity_id,s.tcgplayer_product_id::text as product_id,s.set_code as set_code,0.99::numeric as confidence
      into r from public.mtgjson_sealed_products s where lower(s.name)=lower(raw) limit 1;
  elsif hint = 'set' then
    select 'set'::text as entity_type,m.name as entity_name,m.scryfall_id::text as entity_id,m.tcgplayer_group_id::text as product_id,m.code as set_code,0.99::numeric as confidence
      into r from public.magic_set_catalog m where lower(m.name)=lower(raw) or lower(m.code)=lower(raw) limit 1;
  end if;
  if found then return to_jsonb(r); end if;

  select count(*) into exact_count from (
    select 1 from public.secret_lair_drops d where lower(d.drop_name)=lower(raw)
    union all select 1 from public.mtgjson_decks d where lower(d.name)=lower(raw)
    union all select 1 from public.mtgjson_sealed_products s where lower(s.name)=lower(raw)
    union all select 1 from public.magic_set_catalog m where lower(m.name)=lower(raw) or lower(m.code)=lower(raw)
  ) q;
  if hint = '' and exact_count > 1 then return null; end if;

  select * into r from (
    select 'secret_lair_drop'::text as entity_type,d.drop_name as entity_name,d.drop_id::text as entity_id,null::text as product_id,null::text as set_code,0.99::numeric as confidence
      from public.secret_lair_drops d where lower(d.drop_name)=lower(raw)
    union all select 'precon'::text,d.name,d.deck_key::text,null::text,d.code,0.99::numeric from public.mtgjson_decks d where lower(d.name)=lower(raw)
    union all select 'sealed_product'::text,s.name,s.uuid::text,s.tcgplayer_product_id::text,s.set_code,0.99::numeric from public.mtgjson_sealed_products s where lower(s.name)=lower(raw)
    union all select 'set'::text,m.name,m.scryfall_id::text,m.tcgplayer_group_id::text,m.code,0.99::numeric from public.magic_set_catalog m where lower(m.name)=lower(raw) or lower(m.code)=lower(raw)
  ) x(entity_type,entity_name,entity_id,product_id,set_code,confidence)
  limit 1;
  if found then return to_jsonb(r); end if;

  if length(raw) < 6 then return null; end if;

  select * into r from (
    select case when hint='secret_lair_drop' then 0 else 1 end as rank,'secret_lair_drop'::text as entity_type,d.drop_name as entity_name,d.drop_id::text as entity_id,null::text as product_id,null::text as set_code,0.90::numeric as confidence,abs(length(d.drop_name)-length(raw)) as diff
      from public.secret_lair_drops d where lower(d.drop_name) like '%'||lower(raw)||'%' or lower(raw) like '%'||lower(d.drop_name)||'%'
    union all select case when hint='precon' then 0 else 1 end,'precon'::text,d.name,d.deck_key::text,null::text,d.code,0.88::numeric,abs(length(d.name)-length(raw)) from public.mtgjson_decks d where lower(d.name) like '%'||lower(raw)||'%' or lower(raw) like '%'||lower(d.name)||'%'
    union all select case when hint='sealed_product' then 0 else 1 end,'sealed_product'::text,s.name,s.uuid::text,s.tcgplayer_product_id::text,s.set_code,0.87::numeric,abs(length(s.name)-length(raw)) from public.mtgjson_sealed_products s where lower(s.name) like '%'||lower(raw)||'%' or lower(raw) like '%'||lower(s.name)||'%'
    union all select case when hint='set' then 0 else 1 end,'set'::text,m.name,m.scryfall_id::text,m.tcgplayer_group_id::text,m.code,0.86::numeric,abs(length(m.name)-length(raw)) from public.magic_set_catalog m where lower(m.name) like '%'||lower(raw)||'%' or lower(raw) like '%'||lower(m.name)||'%'
  ) x(rank,entity_type,entity_name,entity_id,product_id,set_code,confidence,diff)
  where hint='' or x.entity_type=hint
  order by rank,diff,entity_type
  limit 1;
  if found then return to_jsonb(r)-'rank'-'diff'; end if;

  return null;
end;
$$;

revoke all on function public.service_resolve_video_noncard_entity_v2(text,text,text) from public, anon, authenticated;
grant execute on function public.service_resolve_video_noncard_entity_v2(text,text,text) to service_role;
