-- Secret Lair intelligence v1
-- Purpose: preserve pre-sale product theses, evidence provenance, scoring inputs,
-- launch/sell-through observations, and post-release outcomes without rewriting history.

-- Expand the shared market-intel entity graph so Secret Lair findings are diggable
-- at the release/drop/artist/treatment level instead of being flattened into `other`.
alter table public.market_intel_entities
  drop constraint if exists market_intel_entities_entity_type_check;

alter table public.market_intel_entities
  add constraint market_intel_entities_entity_type_check
  check (entity_type in (
    'card','set','sealed_product','retailer','format',
    'secret_lair_release','secret_lair_drop','artist','treatment','ip','other'
  ));

create table if not exists public.secret_lair_releases (
  release_id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  release_name text not null,
  release_slug text,
  official_url text,
  announced_at timestamptz,
  sale_start_at timestamptz,
  sale_end_at timestamptz,
  sale_format text not null default 'unknown'
    check (sale_format in ('fixed_quantity','print_to_demand','hybrid','convention','unknown')),
  supply_confidence numeric(4,3) not null default 0.250 check (supply_confidence between 0 and 1),
  supply_notes text,
  preorder_or_queue_notes text,
  promo_notes text,
  bundle_notes text,
  lifecycle_state text not null default 'announced'
    check (lifecycle_state in ('announced','fully_revealed','pre_sale','live','ended','shipping','post_release','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint secret_lair_releases_user_name_key unique (user_id, release_name)
);

create table if not exists public.secret_lair_drops (
  drop_id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.secret_lair_releases(release_id) on delete cascade,
  user_id uuid not null default auth.uid(),
  drop_name text not null,
  ip_name text,
  artist_name text,
  treatment_name text,
  nonfoil_msrp numeric(10,2),
  foil_msrp numeric(10,2),
  currency text not null default 'USD',
  distribution_notes text,
  wpn_nonfoil boolean not null default false,
  mechanically_unique_count integer not null default 0,
  included_in_bundle boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint secret_lair_drops_release_name_key unique (release_id, drop_name)
);

create table if not exists public.secret_lair_drop_cards (
  drop_card_id uuid primary key default gen_random_uuid(),
  drop_id uuid not null references public.secret_lair_drops(drop_id) on delete cascade,
  user_id uuid not null default auth.uid(),
  card_name text not null,
  display_name text,
  scryfall_id uuid,
  oracle_id uuid,
  is_token boolean not null default false,
  is_mechanically_unique boolean not null default false,
  is_bonus_card boolean not null default false,
  collector_number text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.secret_lair_evidence (
  evidence_id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  release_id uuid references public.secret_lair_releases(release_id) on delete cascade,
  drop_id uuid references public.secret_lair_drops(drop_id) on delete cascade,
  intel_id uuid,
  source_type text not null default 'other'
    check (source_type in ('official','reddit','youtube','article','discord','expert_review','market','manual','other')),
  source_name text,
  source_url text,
  author text,
  observed_at timestamptz not null default now(),
  published_at timestamptz,
  evidence_class text not null default 'observed_signal'
    check (evidence_class in ('known_fact','observed_signal','expert_opinion','speculation','market_state','outcome')),
  claim_dimension text not null default 'other'
    check (claim_dimension in (
      'card_quality','anchor_strength','playable_depth','staple_breadth','obscurity',
      'art','treatment','version_of_choice','premium_competition','ip_heat','ip_fit',
      'cute_meme_nostalgia','supply','sale_mechanics','distribution','wait_aversion',
      'promo','bundle','merchandise','value','liquidity','reprint_risk','sell_through','other'
    )),
  direction text not null default 'neutral' check (direction in ('bullish','bearish','neutral')),
  confidence numeric(4,3) not null default 0.500 check (confidence between 0 and 1),
  normalized_score numeric(5,2) check (normalized_score between 0 and 100),
  summary text not null,
  raw_rating numeric(5,2),
  raw_rating_scale numeric(5,2),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.secret_lair_evaluations (
  evaluation_id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  release_id uuid not null references public.secret_lair_releases(release_id) on delete cascade,
  drop_id uuid not null references public.secret_lair_drops(drop_id) on delete cascade,
  evaluated_at timestamptz not null default now(),
  evaluation_phase text not null default 'pre_sale'
    check (evaluation_phase in ('announcement','pre_sale','launch','post_launch','shipping','7d','30d','90d','180d')),

  -- Interpretable sub-scores.
  cards_score numeric(5,2) check (cards_score between 0 and 100),
  treatment_score numeric(5,2) check (treatment_score between 0 and 100),
  audience_score numeric(5,2) check (audience_score between 0 and 100),
  supply_score numeric(5,2) check (supply_score between 0 and 100),

  -- Key derived concepts.
  anchor_strength numeric(5,2) check (anchor_strength between 0 and 100),
  playable_depth numeric(5,2) check (playable_depth between 0 and 100),
  bling_gap numeric(5,2) check (bling_gap between 0 and 100),
  version_of_choice_probability numeric(5,2) check (version_of_choice_probability between 0 and 100),
  premium_competition_penalty numeric(5,2) check (premium_competition_penalty between 0 and 100),
  obscurity_penalty numeric(5,2) check (obscurity_penalty between 0 and 100),
  reprint_compression_penalty numeric(5,2) check (reprint_compression_penalty between 0 and 100),
  value_concentration_risk numeric(5,2) check (value_concentration_risk between 0 and 100),

  collector_score numeric(5,2) check (collector_score between 0 and 100),
  opportunity_score numeric(5,2) check (opportunity_score between 0 and 100),
  confidence numeric(4,3) not null default 0.500 check (confidence between 0 and 1),

  naive_comparable_ev numeric(10,2),
  compression_adjusted_ev numeric(10,2),
  early_liquidity_ev numeric(10,2),
  settled_ev numeric(10,2),
  acquisition_cost numeric(10,2),
  expected_net_after_fees numeric(10,2),
  expected_roi_pct numeric(8,2),

  recommendation text not null default 'watch'
    check (recommendation in ('pot_of_gold','strong_buy','buy','selective_buy','speculative','personal_only','watch','pass')),
  position_size_min integer,
  position_size_max integer,
  thesis text,
  upside_case text,
  downside_case text,
  what_changes_grade text,
  model_version text not null default 'secret-lair-v1',
  score_components jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Immutable-ish snapshots of what actually happened. Do not overwrite pre-sale evaluations.
create table if not exists public.secret_lair_observations (
  observation_id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  release_id uuid not null references public.secret_lair_releases(release_id) on delete cascade,
  drop_id uuid references public.secret_lair_drops(drop_id) on delete cascade,
  observed_at timestamptz not null default now(),
  observation_type text not null
    check (observation_type in ('availability','queue','sold_out','restock','order_limit','bundle_status','shipping','tcg_market','tcg_sales','other')),
  availability_state text check (availability_state in ('available','low_stock','sold_out','unknown')),
  elapsed_minutes_from_sale integer,
  market_price numeric(10,2),
  direct_low numeric(10,2),
  sales_count integer,
  sales_velocity_per_day numeric(10,3),
  source_url text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists secret_lair_releases_sale_idx on public.secret_lair_releases(user_id, sale_start_at desc);
create index if not exists secret_lair_drops_release_idx on public.secret_lair_drops(release_id);
create index if not exists secret_lair_drop_cards_drop_idx on public.secret_lair_drop_cards(drop_id);
create index if not exists secret_lair_drop_cards_oracle_idx on public.secret_lair_drop_cards(user_id, oracle_id) where oracle_id is not null;
create index if not exists secret_lair_evidence_drop_idx on public.secret_lair_evidence(drop_id, observed_at desc);
create index if not exists secret_lair_evidence_dimension_idx on public.secret_lair_evidence(user_id, claim_dimension, observed_at desc);
create index if not exists secret_lair_evaluations_drop_phase_idx on public.secret_lair_evaluations(drop_id, evaluation_phase, evaluated_at desc);
create index if not exists secret_lair_observations_drop_time_idx on public.secret_lair_observations(drop_id, observed_at desc);

alter table public.secret_lair_releases enable row level security;
alter table public.secret_lair_drops enable row level security;
alter table public.secret_lair_drop_cards enable row level security;
alter table public.secret_lair_evidence enable row level security;
alter table public.secret_lair_evaluations enable row level security;
alter table public.secret_lair_observations enable row level security;

create policy secret_lair_releases_own on public.secret_lair_releases for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy secret_lair_drops_own on public.secret_lair_drops for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy secret_lair_drop_cards_own on public.secret_lair_drop_cards for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy secret_lair_evidence_own on public.secret_lair_evidence for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy secret_lair_evaluations_own on public.secret_lair_evaluations for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy secret_lair_observations_own on public.secret_lair_observations for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.secret_lair_releases to authenticated;
grant select, insert, update, delete on public.secret_lair_drops to authenticated;
grant select, insert, update, delete on public.secret_lair_drop_cards to authenticated;
grant select, insert, update, delete on public.secret_lair_evidence to authenticated;
grant select, insert, update, delete on public.secret_lair_evaluations to authenticated;
grant select, insert, update, delete on public.secret_lair_observations to authenticated;
