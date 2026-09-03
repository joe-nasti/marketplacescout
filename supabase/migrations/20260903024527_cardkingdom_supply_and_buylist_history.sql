-- Printing-specific vendor supply and demand with change-only history.
-- Card Kingdom semantics validated against the complete 2026-09-02 v2 feed:
-- condition_values are RETAIL price/stock and their quantities sum to qty_retail;
-- price_buy/qty_buying are condition-agnostic remaining buylist capacity.

create table if not exists public.vendor_depth_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('cardkingdom','manapool','tcgplayer')),
  endpoint text not null,
  status text not null default 'running' check (status in ('running','complete','failed','partial')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  observed_at timestamptz not null default now(),
  source_as_of timestamptz,
  source_as_of_raw text,
  source_timezone text,
  row_count integer,
  changed_count integer,
  payload_sha256 text,
  schema_version text not null default 'vendor-depth-v1',
  detail jsonb not null default '{}'::jsonb
);

create index if not exists vendor_depth_runs_source_started_idx
  on public.vendor_depth_runs(source,started_at desc);

create table if not exists public.vendor_item_identities (
  source text not null,
  source_item_key text not null,
  source_product_id text,
  source_sku text,
  mtgjson_uuid uuid references public.mtgjson_cards(uuid) on delete set null,
  scryfall_id uuid,
  tcgplayer_product_id text,
  tcgplayer_sku_id text,
  card_name text,
  set_name text,
  set_code text,
  collector_number text,
  variation text,
  finish text not null,
  language text not null default 'EN',
  product_url text,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  source_updated_at timestamptz not null default now(),
  identity_detail jsonb not null default '{}'::jsonb,
  primary key (source,source_item_key)
);

create index if not exists vendor_item_identities_mtgjson_idx
  on public.vendor_item_identities(mtgjson_uuid,finish,language);
create index if not exists vendor_item_identities_scryfall_idx
  on public.vendor_item_identities(scryfall_id,finish,language);
create index if not exists vendor_item_identities_tcg_sku_idx
  on public.vendor_item_identities(tcgplayer_sku_id) where tcgplayer_sku_id is not null;

create or replace function public.preserve_vendor_identity_first_seen()
returns trigger language plpgsql set search_path='public' as $$
begin
  if tg_op='UPDATE' then new.first_seen_at:=old.first_seen_at; end if;
  return new;
end
$$;

create trigger preserve_vendor_identity_first_seen_trigger
before update on public.vendor_item_identities
for each row execute function public.preserve_vendor_identity_first_seen();

create table if not exists public.vendor_depth_current (
  source text not null,
  observation_key text not null,
  source_item_key text not null,
  lane text not null check (lane in ('retail_supply','buylist_demand','threshold_supply')),
  condition text not null default 'ALL',
  finish text not null,
  language text not null default 'EN',
  price numeric(12,2),
  quantity integer check (quantity is null or quantity >= 0),
  listing_count integer check (listing_count is null or listing_count >= 0),
  threshold_price numeric(12,2),
  measurement_scope text not null,
  count_quality text not null check (count_quality in ('exact','capped','optimizer_derived','aggregate','unavailable')),
  is_executable boolean not null default false,
  source_as_of timestamptz,
  source_as_of_raw text,
  observed_at timestamptz not null,
  first_seen_at timestamptz not null,
  last_changed_at timestamptz not null,
  run_id uuid references public.vendor_depth_runs(id) on delete set null,
  value_hash text not null,
  detail jsonb not null default '{}'::jsonb,
  primary key (source,observation_key),
  foreign key (source,source_item_key)
    references public.vendor_item_identities(source,source_item_key) on delete cascade
);

create index if not exists vendor_depth_current_item_idx
  on public.vendor_depth_current(source,source_item_key,lane,condition);
create index if not exists vendor_depth_current_actionable_idx
  on public.vendor_depth_current(lane,price,quantity)
  where is_executable and quantity > 0;

create table if not exists public.vendor_depth_events (
  id bigint generated always as identity primary key,
  source text not null,
  observation_key text not null,
  source_item_key text not null,
  lane text not null,
  condition text not null,
  finish text not null,
  language text not null,
  price numeric(12,2),
  quantity integer,
  listing_count integer,
  threshold_price numeric(12,2),
  measurement_scope text not null,
  count_quality text not null,
  is_executable boolean not null,
  event_type text not null check (event_type in ('first_seen','changed','removed')),
  source_as_of timestamptz,
  source_as_of_raw text,
  observed_at timestamptz not null,
  run_id uuid references public.vendor_depth_runs(id) on delete set null,
  previous_value_hash text,
  value_hash text not null,
  detail jsonb not null default '{}'::jsonb,
  unique(source,observation_key,value_hash)
);

create index if not exists vendor_depth_events_item_time_idx
  on public.vendor_depth_events(source,source_item_key,lane,observed_at desc);
create index if not exists vendor_depth_events_observation_time_idx
  on public.vendor_depth_events(source,observation_key,observed_at desc);

create or replace function public.capture_vendor_depth_change()
returns trigger
language plpgsql
set search_path='public'
as $$
declare v_event text;
begin
  if tg_op='INSERT' then
    new.first_seen_at:=coalesce(new.first_seen_at,new.observed_at);
    new.last_changed_at:=coalesce(new.last_changed_at,new.observed_at);
    v_event:='first_seen';
  elsif new.value_hash is distinct from old.value_hash then
    new.first_seen_at:=old.first_seen_at;
    new.last_changed_at:=new.observed_at;
    v_event:='changed';
  else
    new.first_seen_at:=old.first_seen_at;
    new.last_changed_at:=old.last_changed_at;
    return new;
  end if;

  insert into public.vendor_depth_events(
    source,observation_key,source_item_key,lane,condition,finish,language,
    price,quantity,listing_count,threshold_price,measurement_scope,count_quality,
    is_executable,event_type,source_as_of,source_as_of_raw,observed_at,run_id,
    previous_value_hash,value_hash,detail)
  values(
    new.source,new.observation_key,new.source_item_key,new.lane,new.condition,new.finish,new.language,
    new.price,new.quantity,new.listing_count,new.threshold_price,new.measurement_scope,new.count_quality,
    new.is_executable,v_event,new.source_as_of,new.source_as_of_raw,new.observed_at,new.run_id,
    case when tg_op='UPDATE' then old.value_hash end,new.value_hash,new.detail)
  on conflict(source,observation_key,value_hash) do nothing;
  return new;
end
$$;

create trigger capture_vendor_depth_change_trigger
before insert or update on public.vendor_depth_current
for each row execute function public.capture_vendor_depth_change();

alter table public.vendor_depth_runs enable row level security;
alter table public.vendor_item_identities enable row level security;
alter table public.vendor_depth_current enable row level security;
alter table public.vendor_depth_events enable row level security;

revoke all on public.vendor_depth_runs,public.vendor_item_identities,
  public.vendor_depth_current,public.vendor_depth_events from public,anon,authenticated;
grant select,insert,update on public.vendor_depth_runs,public.vendor_item_identities,
  public.vendor_depth_current,public.vendor_depth_events to service_role;
grant usage,select on sequence public.vendor_depth_events_id_seq to service_role;

create or replace function public.vendor_depth_for_printing_v1(
  p_mtgjson_uuid uuid,
  p_finish text default null,
  p_language text default 'EN',
  p_history_days integer default 30
) returns jsonb
language sql stable security invoker set search_path='public'
as $$
with ids as (
  select * from public.vendor_item_identities i
  where i.mtgjson_uuid=p_mtgjson_uuid
    and (p_finish is null or lower(i.finish)=lower(p_finish))
    and (p_language is null or upper(i.language)=upper(p_language))
), current_rows as (
  select jsonb_agg(to_jsonb(c) order by c.source,c.lane,c.condition,c.threshold_price nulls first) rows
  from public.vendor_depth_current c join ids i using(source,source_item_key)
), history_rows as (
  select jsonb_agg(to_jsonb(e) order by e.observed_at,e.source,e.lane,e.condition) rows
  from public.vendor_depth_events e join ids i using(source,source_item_key)
  where e.observed_at >= now() - make_interval(days=>greatest(1,least(coalesce(p_history_days,30),365)))
)
select jsonb_build_object(
  'mtgjson_uuid',p_mtgjson_uuid,
  'current',coalesce((select rows from current_rows),'[]'::jsonb),
  'history',coalesce((select rows from history_rows),'[]'::jsonb),
  'semantics',jsonb_build_object(
    'cardkingdom_retail','condition-specific copies currently offered for sale',
    'cardkingdom_buylist','condition-agnostic remaining copies Card Kingdom says it will buy',
    'manapool_retail','variant quantity; threshold rows are optimizer-derived when present',
    'tcgplayer_retail','reserved for throttled unofficial exact-SKU depth'));
$$;

revoke all on function public.vendor_depth_for_printing_v1(uuid,text,text,integer) from public,anon;
grant execute on function public.vendor_depth_for_printing_v1(uuid,text,text,integer) to authenticated,service_role;
revoke all on function public.capture_vendor_depth_change() from public,anon,authenticated;
revoke all on function public.preserve_vendor_identity_first_seen() from public,anon,authenticated;
grant select on public.vendor_item_identities,public.vendor_depth_current,public.vendor_depth_events to authenticated;

create policy "authenticated reads vendor identities" on public.vendor_item_identities
  for select to authenticated
  using (coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false);
create policy "authenticated reads current vendor depth" on public.vendor_depth_current
  for select to authenticated
  using (coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false);
create policy "authenticated reads vendor depth history" on public.vendor_depth_events
  for select to authenticated
  using (coalesce(((select auth.jwt())->>'is_anonymous')::boolean,false)=false);

comment on column public.vendor_depth_current.quantity is
  'Meaning is lane-specific; see measurement_scope/count_quality. Never interpret a generic quantity without them.';
comment on column public.vendor_depth_current.source_as_of_raw is
  'Verbatim source timestamp when the source omits an offset; do not coerce it into UTC.';
