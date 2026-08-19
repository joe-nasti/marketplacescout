create table if not exists public.cardtrader_blueprints (
  blueprint_id bigint primary key,
  game_id integer not null,
  category_id integer not null,
  expansion_id integer,
  name text not null,
  version text,
  cardmarket_ids text[] not null default '{}',
  tcgplayer_product_id text,
  image_url text,
  raw_json jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create index if not exists cardtrader_blueprints_expansion_idx on public.cardtrader_blueprints(expansion_id);
create index if not exists cardtrader_blueprints_category_idx on public.cardtrader_blueprints(category_id);
create index if not exists cardtrader_blueprints_tcgplayer_idx on public.cardtrader_blueprints(tcgplayer_product_id) where tcgplayer_product_id is not null;
create index if not exists cardtrader_blueprints_cardmarket_gin on public.cardtrader_blueprints using gin(cardmarket_ids);

alter table public.cardtrader_blueprints enable row level security;
grant select on public.cardtrader_blueprints to authenticated;
drop policy if exists cardtrader_blueprints_authenticated_read on public.cardtrader_blueprints;
create policy cardtrader_blueprints_authenticated_read on public.cardtrader_blueprints for select to authenticated using (true);

create table if not exists public.cardtrader_sealed_map (
  sealed_uuid uuid primary key references public.mtgjson_sealed_products(uuid) on delete cascade,
  cardtrader_blueprint_id bigint not null unique references public.cardtrader_blueprints(blueprint_id) on delete cascade,
  cardmarket_id text,
  tcgplayer_product_id text,
  match_method text not null,
  match_confidence text not null,
  identity_conflict boolean not null default false,
  conflict_detail jsonb not null default '{}'::jsonb,
  verified_at timestamptz not null default now()
);

create index if not exists cardtrader_sealed_map_cardmarket_idx on public.cardtrader_sealed_map(cardmarket_id) where cardmarket_id is not null;
create index if not exists cardtrader_sealed_map_tcgplayer_idx on public.cardtrader_sealed_map(tcgplayer_product_id) where tcgplayer_product_id is not null;

alter table public.cardtrader_sealed_map enable row level security;
grant select on public.cardtrader_sealed_map to authenticated;
drop policy if exists cardtrader_sealed_map_authenticated_read on public.cardtrader_sealed_map;
create policy cardtrader_sealed_map_authenticated_read on public.cardtrader_sealed_map for select to authenticated using (true);
