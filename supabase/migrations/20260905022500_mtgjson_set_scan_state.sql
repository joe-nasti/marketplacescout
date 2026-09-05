create table if not exists public.mtgjson_set_scan_state (
  set_code text primary key,
  scanned_at timestamptz not null default now(),
  status text not null default 'complete',
  card_count integer not null default 0,
  booster_config_count integer not null default 0,
  error_text text
);

alter table public.mtgjson_set_scan_state enable row level security;
revoke all on public.mtgjson_set_scan_state from public, anon, authenticated;
grant select, insert, update on public.mtgjson_set_scan_state to service_role;
