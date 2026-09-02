create table if not exists public.sealed_ev_backtests (
  backtest_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  sealed_uuid uuid not null,
  set_code text not null,
  product_name text not null,
  model_key text not null,
  model_version text not null,
  valuation_as_of timestamptz not null default now(),
  sealed_reference_price numeric,
  reference_price_source text,
  sample_count integer,
  booster_count integer,
  booster_mean_ev numeric,
  topper_mean_ev numeric,
  gross_mean_ev numeric,
  gross_median_ev numeric,
  p10_ev numeric,
  p90_ev numeric,
  net_mean_ev_after_fees numeric,
  break_even_probability numeric,
  two_x_probability numeric,
  five_x_probability numeric,
  top10_ev_share numeric,
  excluded_jackpot jsonb not null default '{}'::jsonb,
  assumptions jsonb not null default '{}'::jsonb,
  results jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists sealed_ev_backtests_product_idx on public.sealed_ev_backtests(user_id,sealed_uuid,valuation_as_of desc);
alter table public.sealed_ev_backtests enable row level security;
drop policy if exists sealed_ev_backtests_own on public.sealed_ev_backtests;
create policy sealed_ev_backtests_own on public.sealed_ev_backtests for select to authenticated using (user_id=auth.uid());

create table if not exists public.sealed_ev_backtest_pool_items (
  pool_item_id uuid primary key default gen_random_uuid(),
  backtest_id uuid not null references public.sealed_ev_backtests(backtest_id) on delete cascade,
  user_id uuid not null,
  pool_key text not null,
  set_code text not null,
  collector_number text not null,
  card_name text not null,
  rarity text,
  finish text not null,
  tcgplayer_product_id text,
  market_value numeric,
  value_source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(backtest_id,pool_key,set_code,collector_number,finish,tcgplayer_product_id)
);
create index if not exists sealed_ev_backtest_pool_items_idx on public.sealed_ev_backtest_pool_items(backtest_id,pool_key);
alter table public.sealed_ev_backtest_pool_items enable row level security;
drop policy if exists sealed_ev_backtest_pool_items_own on public.sealed_ev_backtest_pool_items;
create policy sealed_ev_backtest_pool_items_own on public.sealed_ev_backtest_pool_items for select to authenticated using (user_id=auth.uid());

create table if not exists public.sealed_ev_backtest_slots (
  slot_id uuid primary key default gen_random_uuid(),
  backtest_id uuid not null references public.sealed_ev_backtests(backtest_id) on delete cascade,
  user_id uuid not null,
  slot_group text not null,
  draws_per_booster numeric not null,
  pool_key text not null,
  probability numeric not null,
  finish text not null,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists sealed_ev_backtest_slots_idx on public.sealed_ev_backtest_slots(backtest_id,slot_group);
alter table public.sealed_ev_backtest_slots enable row level security;
drop policy if exists sealed_ev_backtest_slots_own on public.sealed_ev_backtest_slots;
create policy sealed_ev_backtest_slots_own on public.sealed_ev_backtest_slots for select to authenticated using (user_id=auth.uid());
