create table if not exists public.scout_tcgplayer_sku_discovery_cache (
  sku_id text primary key,
  product_id text not null,
  card_name text,
  set_code text,
  collector_number text,
  variant text,
  printing text,
  condition text,
  language text,
  mtgjson_uuid uuid,
  scryfall_id uuid,
  source text not null default 'tcgplayer_product_details',
  raw_json jsonb not null default '{}'::jsonb,
  discovered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  catalog_materialized_at timestamptz
);

create index if not exists scout_tcgplayer_sku_discovery_product_idx
  on public.scout_tcgplayer_sku_discovery_cache(product_id, last_seen_at desc);

create index if not exists scout_tcgplayer_sku_discovery_identity_idx
  on public.scout_tcgplayer_sku_discovery_cache(
    lower(card_name),
    upper(coalesce(language,'')),
    upper(coalesce(condition,'')),
    upper(coalesce(printing,''))
  );

alter table public.scout_tcgplayer_sku_discovery_cache enable row level security;

drop policy if exists "public read discovered tcg skus" on public.scout_tcgplayer_sku_discovery_cache;
create policy "public read discovered tcg skus"
  on public.scout_tcgplayer_sku_discovery_cache
  for select
  to anon, authenticated
  using (true);

grant select on public.scout_tcgplayer_sku_discovery_cache to anon, authenticated;
grant insert, update on public.scout_tcgplayer_sku_discovery_cache to service_role;
