-- Secret Lair per-card valuation snapshots
-- Stores the evidence behind a drop-level EV so the UI can drill into every card.

create table if not exists public.secret_lair_card_valuations (
  card_valuation_id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  evaluation_id uuid not null references public.secret_lair_evaluations(evaluation_id) on delete cascade,
  release_id uuid not null references public.secret_lair_releases(release_id) on delete cascade,
  drop_id uuid not null references public.secret_lair_drops(drop_id) on delete cascade,
  drop_card_id uuid references public.secret_lair_drop_cards(drop_card_id) on delete set null,
  card_name text not null,
  oracle_id uuid,
  resolved_printing_count integer,
  premium_printing_count integer,
  normal_market_floor numeric(10,2),
  normal_market_median numeric(10,2),
  liquid_premium_comparable numeric(10,2),
  premium_sales_90d numeric(12,2),
  total_sales_90d numeric(12,2),
  premium_competition_score numeric(5,2) check (premium_competition_score between 0 and 100),
  reprint_compression_penalty numeric(5,2) check (reprint_compression_penalty between 0 and 100),
  bling_gap numeric(5,2) check (bling_gap between 0 and 100),
  naive_comparable_value numeric(10,2),
  compression_adjusted_value numeric(10,2),
  liquidity_score numeric(5,2) check (liquidity_score between 0 and 100),
  coverage_confidence numeric(4,3) not null default 0.250 check (coverage_confidence between 0 and 1),
  comparable_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists secret_lair_card_valuations_eval_idx
  on public.secret_lair_card_valuations(evaluation_id, card_name);
create index if not exists secret_lair_card_valuations_oracle_idx
  on public.secret_lair_card_valuations(user_id, oracle_id) where oracle_id is not null;

alter table public.secret_lair_card_valuations enable row level security;
drop policy if exists secret_lair_card_valuations_own on public.secret_lair_card_valuations;
create policy secret_lair_card_valuations_own on public.secret_lair_card_valuations for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.secret_lair_card_valuations to authenticated;