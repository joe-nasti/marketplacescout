-- Secret Lair regional storefront/allocation model
-- Secret Lair has one global product supply, but inventory is allocated across US, REU and UK storefronts.
-- Product identity and total print supply stay global. Price, storefront allocation, local demand,
-- availability, sell-through and pull/end timing are observed regionally.
-- A regional sellout is therefore evidence about allocation + local demand, not proof that global supply is exhausted.

create table if not exists public.secret_lair_release_regions (
  release_region_id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.secret_lair_releases(release_id) on delete cascade,
  user_id uuid not null default auth.uid(),
  region text not null check (region in ('US','REU','UK')),
  storefront_url text,
  currency text not null,
  sale_start_at timestamptz,
  sale_end_at timestamptz,
  queue_start_at timestamptz,
  order_limit_notes text,
  shipping_notes text,
  allocation_notes text,
  local_demand_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint secret_lair_release_regions_release_region_key unique (release_id, region)
);

-- A drop can have multiple separately purchasable finishes/offers per storefront.
-- Keeping this separate avoids assuming US USD pricing or US availability applies to REU/UK.
create table if not exists public.secret_lair_drop_offers (
  offer_id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.secret_lair_releases(release_id) on delete cascade,
  drop_id uuid not null references public.secret_lair_drops(drop_id) on delete cascade,
  user_id uuid not null default auth.uid(),
  region text not null check (region in ('US','REU','UK')),
  finish text not null check (finish in ('nonfoil','foil','other')),
  currency text not null,
  price numeric(10,2),
  product_url text,
  external_product_id text,
  sale_format text check (sale_format in ('fixed_quantity','print_to_demand','hybrid','convention','unknown')),
  available_from timestamptz,
  available_until timestamptz,
  order_limit integer,
  distribution_channel text not null default 'secret_lair'
    check (distribution_channel in ('secret_lair','wpn','convention','other')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint secret_lair_drop_offers_unique unique (drop_id, region, finish, distribution_channel)
);

-- Bundle storefront availability can consume allocated underlying drop inventory and must be observed separately.
create table if not exists public.secret_lair_bundles (
  bundle_id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.secret_lair_releases(release_id) on delete cascade,
  user_id uuid not null default auth.uid(),
  bundle_name text not null,
  bundle_type text not null default 'other'
    check (bundle_type in ('everything','all_foil','all_nonfoil','ip','custom','other')),
  created_at timestamptz not null default now(),
  constraint secret_lair_bundles_release_name_key unique (release_id, bundle_name)
);

create table if not exists public.secret_lair_bundle_drops (
  bundle_id uuid not null references public.secret_lair_bundles(bundle_id) on delete cascade,
  drop_id uuid not null references public.secret_lair_drops(drop_id) on delete cascade,
  finish text not null check (finish in ('nonfoil','foil','other')),
  quantity integer not null default 1 check (quantity > 0),
  primary key (bundle_id, drop_id, finish)
);

create table if not exists public.secret_lair_bundle_offers (
  bundle_offer_id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references public.secret_lair_bundles(bundle_id) on delete cascade,
  release_id uuid not null references public.secret_lair_releases(release_id) on delete cascade,
  user_id uuid not null default auth.uid(),
  region text not null check (region in ('US','REU','UK')),
  currency text not null,
  price numeric(10,2),
  product_url text,
  external_product_id text,
  order_limit integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint secret_lair_bundle_offers_unique unique (bundle_id, region)
);

alter table public.secret_lair_observations
  add column if not exists region text check (region in ('US','REU','UK')),
  add column if not exists offer_id uuid references public.secret_lair_drop_offers(offer_id) on delete set null,
  add column if not exists bundle_offer_id uuid references public.secret_lair_bundle_offers(bundle_offer_id) on delete set null;

-- NULL region means the evaluation is intentionally global/cross-region.
-- Regional evaluations adjust economics and market confirmation for storefront price/allocation/local demand;
-- they must not reinterpret the global print supply as three separate supplies.
alter table public.secret_lair_evaluations
  add column if not exists region text check (region in ('US','REU','UK'));

alter table public.secret_lair_evidence
  add column if not exists region text check (region in ('US','REU','UK'));

create index if not exists secret_lair_release_regions_region_idx
  on public.secret_lair_release_regions(user_id, region, sale_start_at desc);
create index if not exists secret_lair_drop_offers_region_idx
  on public.secret_lair_drop_offers(drop_id, region, finish);
create index if not exists secret_lair_bundle_offers_region_idx
  on public.secret_lair_bundle_offers(bundle_id, region);
create index if not exists secret_lair_observations_region_time_idx
  on public.secret_lair_observations(release_id, region, observed_at desc);
create index if not exists secret_lair_evaluations_region_phase_idx
  on public.secret_lair_evaluations(drop_id, region, evaluation_phase, evaluated_at desc);

alter table public.secret_lair_release_regions enable row level security;
alter table public.secret_lair_drop_offers enable row level security;
alter table public.secret_lair_bundles enable row level security;
alter table public.secret_lair_bundle_offers enable row level security;

create policy secret_lair_release_regions_own on public.secret_lair_release_regions for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy secret_lair_drop_offers_own on public.secret_lair_drop_offers for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy secret_lair_bundles_own on public.secret_lair_bundles for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy secret_lair_bundle_offers_own on public.secret_lair_bundle_offers for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.secret_lair_release_regions to authenticated;
grant select, insert, update, delete on public.secret_lair_drop_offers to authenticated;
grant select, insert, update, delete on public.secret_lair_bundles to authenticated;
grant select, insert, update, delete on public.secret_lair_bundle_drops to authenticated;
grant select, insert, update, delete on public.secret_lair_bundle_offers to authenticated;
