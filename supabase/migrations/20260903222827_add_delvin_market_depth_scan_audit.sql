create table if not exists public.delvin_market_depth_scans (
  id bigint generated always as identity primary key,
  requested_at timestamptz not null default now(),
  card_name text not null,
  set_name text not null,
  set_code text,
  target_count integer not null default 0,
  scanned_count integer not null default 0,
  failed_count integer not null default 0,
  result jsonb not null default '{}'::jsonb
);
alter table public.delvin_market_depth_scans enable row level security;
revoke all on table public.delvin_market_depth_scans from public,anon,authenticated;
grant select,insert,update on table public.delvin_market_depth_scans to service_role;
grant usage,select on sequence public.delvin_market_depth_scans_id_seq to service_role;