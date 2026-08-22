-- MarketplaceScout market intelligence v0.1
-- Stores derived/user-entered signal data and entity links, not full third-party article content.

create table if not exists public.market_intel_items (
  intel_id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  source_type text not null default 'article' check (source_type in ('article','x','discord','reddit','youtube','official','manual','other')),
  source_name text,
  source_url text not null,
  title text,
  author text,
  summary text,
  claim_type text not null default 'other' check (claim_type in ('demand','supply','price','buylist','meta','reprint','competitive','product','other')),
  direction text not null default 'neutral' check (direction in ('bullish','bearish','neutral')),
  signal_stage text not null default 'unclassified' check (signal_stage in ('leading','confirming','lagging','neutral','noise','unclassified')),
  confidence numeric(4,3) not null default 0.500 check (confidence >= 0 and confidence <= 1),
  published_at timestamptz,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_intel_items_intel_id_user_id_key unique (intel_id,user_id)
);

create table if not exists public.market_intel_entities (
  intel_entity_id uuid primary key default gen_random_uuid(),
  intel_id uuid not null,
  user_id uuid not null default auth.uid(),
  entity_type text not null default 'card' check (entity_type in ('card','set','sealed_product','retailer','format','other')),
  entity_name text not null,
  scryfall_id uuid,
  product_id text,
  set_code text,
  confidence numeric(4,3) not null default 0.750 check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  constraint market_intel_entities_intel_user_fkey foreign key (intel_id,user_id)
    references public.market_intel_items(intel_id,user_id) on delete cascade
);

create index if not exists market_intel_items_user_observed_idx on public.market_intel_items(user_id, observed_at desc);
create index if not exists market_intel_items_user_stage_idx on public.market_intel_items(user_id, signal_stage, observed_at desc);
create index if not exists market_intel_entities_user_scryfall_idx on public.market_intel_entities(user_id, scryfall_id) where scryfall_id is not null;
create index if not exists market_intel_entities_user_product_idx on public.market_intel_entities(user_id, product_id) where product_id is not null;
create index if not exists market_intel_entities_user_name_idx on public.market_intel_entities(user_id, lower(entity_name));

alter table public.market_intel_items enable row level security;
alter table public.market_intel_entities enable row level security;

drop policy if exists market_intel_items_own on public.market_intel_items;
create policy market_intel_items_own on public.market_intel_items for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists market_intel_entities_own on public.market_intel_entities;
create policy market_intel_entities_own on public.market_intel_entities for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.market_intel_items to authenticated;
grant select, insert, update, delete on public.market_intel_entities to authenticated;
