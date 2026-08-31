-- Keep one not-yet-cataloged MTGJSON UUID from aborting the entire daily price import.
-- The canonical FK remains intact: unknown UUID price rows are skipped and audited until
-- the identity catalog catches up on a later sync.

create table if not exists public.mtgjson_vendor_price_orphans (
  uuid uuid primary key,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  skipped_rows bigint not null default 1
);

alter table public.mtgjson_vendor_price_orphans enable row level security;

create or replace function public.skip_mtgjson_vendor_price_orphan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.mtgjson_cards c
    where c.uuid = new.uuid
  ) then
    insert into public.mtgjson_vendor_price_orphans (
      uuid,
      first_seen_at,
      last_seen_at,
      skipped_rows
    )
    values (new.uuid, now(), now(), 1)
    on conflict (uuid) do update
      set last_seen_at = excluded.last_seen_at,
          skipped_rows = public.mtgjson_vendor_price_orphans.skipped_rows + 1;

    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_skip_mtgjson_vendor_price_orphan
  on public.mtgjson_vendor_prices;

create trigger trg_skip_mtgjson_vendor_price_orphan
before insert or update of uuid on public.mtgjson_vendor_prices
for each row
execute function public.skip_mtgjson_vendor_price_orphan();
