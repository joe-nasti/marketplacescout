-- Compact, selective TCGCSV history for cards that participate in an active
-- sealed collation model. This is calibration evidence only: Market is never
-- promoted into executable EV.

create table if not exists public.modeled_booster_card_price_history (
  product_id bigint not null,
  observed_on date not null,
  sub_type_name text not null default 'Normal',
  market_price numeric,
  low_price numeric,
  direct_low_price numeric,
  source text not null,
  source_granularity text not null default 'sampled_7d',
  source_updated_at timestamptz,
  ingested_at timestamptz not null default now(),
  primary key(product_id,sub_type_name,observed_on)
);

create index if not exists modeled_booster_card_history_product_day_idx
  on public.modeled_booster_card_price_history(product_id,observed_on desc);

alter table public.modeled_booster_card_price_history enable row level security;
revoke all on public.modeled_booster_card_price_history from public,anon,authenticated;
grant select,insert,update on public.modeled_booster_card_price_history to service_role;

create table if not exists public.modeled_booster_card_archive_imports (
  archive_date date primary key,
  status text not null check(status in ('running','complete','missing','failed')),
  attempted_at timestamptz not null default now(),
  completed_at timestamptz,
  target_products integer not null default 0,
  imported_rows integer not null default 0,
  detail jsonb not null default '{}'::jsonb
);

alter table public.modeled_booster_card_archive_imports enable row level security;
revoke all on public.modeled_booster_card_archive_imports from public,anon,authenticated;
grant select,insert,update on public.modeled_booster_card_archive_imports to service_role;

create or replace view public.modeled_booster_card_history_health
with (security_invoker=true) as
select count(*)::bigint observation_count,count(distinct product_id)::integer product_count,
  min(observed_on) history_start,max(observed_on) history_end,
  count(distinct observed_on)::integer observation_days,
  case when count(distinct observed_on)>=12 and max(observed_on)-min(observed_on)>=75
    then 'CALIBRATION_READY' else 'BUILDING_HISTORY' end calibration_status,
  'TCGCSV Market history is calibration evidence only and is never used as executable EV.'::text policy
from public.modeled_booster_card_price_history;

grant select on public.modeled_booster_card_history_health to authenticated,service_role;

notify pgrst,'reload schema';
