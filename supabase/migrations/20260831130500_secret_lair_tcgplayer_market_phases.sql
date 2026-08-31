alter table public.secret_lair_releases
  add column if not exists tcgplayer_presale_start_at timestamptz,
  add column if not exists tcgplayer_general_listing_at timestamptz,
  add column if not exists tcgplayer_release_weekend_end_at timestamptz,
  add column if not exists tcgplayer_market_phase_notes text;

create table if not exists public.secret_lair_market_observations (
  market_observation_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  release_id uuid not null references public.secret_lair_releases(release_id) on delete cascade,
  drop_id uuid references public.secret_lair_drops(drop_id) on delete cascade,
  drop_card_id uuid references public.secret_lair_drop_cards(drop_card_id) on delete cascade,
  region text,
  finish text,
  source_market text not null default 'tcgplayer',
  observation_type text not null check (observation_type in ('listing','sale','market_snapshot','supply_snapshot')),
  observed_at timestamptz not null,
  market_phase text not null check (market_phase in ('presale_restricted','release_weekend_supply_shock','early_settlement','post_release_settled','mature','unknown')),
  price numeric,
  quantity numeric,
  listing_count integer,
  sales_count integer,
  market_price numeric,
  low_price numeric,
  direct_low numeric,
  phase_weight numeric not null default 1 check (phase_weight >= 0 and phase_weight <= 1),
  equilibrium_weight numeric not null default 1 check (equilibrium_weight >= 0 and equilibrium_weight <= 1),
  urgency_signal_weight numeric not null default 0 check (urgency_signal_weight >= 0 and urgency_signal_weight <= 1),
  source_url text,
  source_record_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists secret_lair_market_obs_release_time_idx on public.secret_lair_market_observations(release_id, observed_at);
create index if not exists secret_lair_market_obs_drop_phase_idx on public.secret_lair_market_observations(drop_id, market_phase, observed_at);
create index if not exists secret_lair_market_obs_card_phase_idx on public.secret_lair_market_observations(drop_card_id, market_phase, observed_at);

alter table public.secret_lair_market_observations enable row level security;

drop policy if exists secret_lair_market_observations_own on public.secret_lair_market_observations;
create policy secret_lair_market_observations_own on public.secret_lair_market_observations
for all to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select, insert, update, delete on public.secret_lair_market_observations to authenticated;

create or replace function public.secret_lair_market_phase(
  p_observed_at timestamptz,
  p_presale_start timestamptz,
  p_general_listing timestamptz,
  p_release_weekend_end timestamptz
) returns text
language sql immutable as $$
  select case
    when p_observed_at is null then 'unknown'
    when p_general_listing is not null and p_observed_at < p_general_listing
      and (p_presale_start is null or p_observed_at >= p_presale_start) then 'presale_restricted'
    when p_general_listing is not null and p_observed_at >= p_general_listing
      and p_release_weekend_end is not null and p_observed_at <= p_release_weekend_end then 'release_weekend_supply_shock'
    when p_general_listing is not null and p_observed_at > coalesce(p_release_weekend_end,p_general_listing)
      and p_observed_at <= coalesce(p_release_weekend_end,p_general_listing) + interval '14 days' then 'early_settlement'
    when p_general_listing is not null and p_observed_at > coalesce(p_release_weekend_end,p_general_listing) + interval '14 days'
      and p_observed_at <= coalesce(p_release_weekend_end,p_general_listing) + interval '90 days' then 'post_release_settled'
    when p_general_listing is not null and p_observed_at > coalesce(p_release_weekend_end,p_general_listing) + interval '90 days' then 'mature'
    else 'unknown'
  end;
$$;

create or replace function public.secret_lair_phase_equilibrium_weight(p_phase text) returns numeric
language sql immutable as $$
  select case p_phase
    when 'presale_restricted' then 0.15
    when 'release_weekend_supply_shock' then 0.35
    when 'early_settlement' then 0.70
    when 'post_release_settled' then 1.00
    when 'mature' then 1.00
    else 0.25
  end;
$$;

create or replace function public.secret_lair_phase_urgency_weight(p_phase text) returns numeric
language sql immutable as $$
  select case p_phase
    when 'presale_restricted' then 1.00
    when 'release_weekend_supply_shock' then 0.55
    when 'early_settlement' then 0.30
    when 'post_release_settled' then 0.10
    when 'mature' then 0.05
    else 0.10
  end;
$$;

comment on column public.secret_lair_market_observations.equilibrium_weight is 'Weight for estimating durable market-clearing value. Restricted TCGplayer presale prices are intentionally heavily discounted.';
comment on column public.secret_lair_market_observations.urgency_signal_weight is 'Weight for measuring missed-sale/FOMO urgency. Restricted presale observations can be strong urgency evidence even when weak equilibrium evidence.';
comment on column public.secret_lair_releases.tcgplayer_general_listing_at is 'Approximate time ordinary TCGplayer sellers can broadly list/sell the Secret Lair; do not assume restricted presale transactions before this timestamp represent equilibrium value.';
