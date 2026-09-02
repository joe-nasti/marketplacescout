-- Exact-printing TCGplayer discovery for randomized Secret Lair products (Zeta).
-- Production-safe and idempotent: never infers collector-number/treatment identity from fuzzy matches.

create table if not exists public.secret_lair_randomized_tcgplayer_printings (
  mapping_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  randomized_product_id uuid not null references public.secret_lair_randomized_products(randomized_product_id) on delete cascade,
  randomized_card_printing_id uuid not null references public.secret_lair_randomized_card_printings(randomized_card_printing_id) on delete cascade,
  tcgplayer_product_id text,
  tcgplayer_sku_ids jsonb not null default '[]'::jsonb,
  product_name text,
  set_name text,
  discovery_query text,
  discovery_confidence numeric,
  discovery_status text not null default 'pending' check (discovery_status in ('pending','candidate','confirmed','not_found','stale','error')),
  discovery_source text,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  last_attempt_at timestamptz,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, randomized_card_printing_id)
);

alter table public.secret_lair_randomized_tcgplayer_printings enable row level security;
drop policy if exists secret_lair_randomized_tcgplayer_printings_own on public.secret_lair_randomized_tcgplayer_printings;
create policy secret_lair_randomized_tcgplayer_printings_own
  on public.secret_lair_randomized_tcgplayer_printings
  for all to authenticated
  using (user_id=auth.uid())
  with check (user_id=auth.uid());

create index if not exists secret_lair_randomized_tcgplayer_printings_product_idx
  on public.secret_lair_randomized_tcgplayer_printings(randomized_product_id, discovery_status, updated_at);
create index if not exists secret_lair_randomized_tcgplayer_printings_tcg_idx
  on public.secret_lair_randomized_tcgplayer_printings(tcgplayer_product_id)
  where tcgplayer_product_id is not null;

create or replace view public.secret_lair_randomized_card_variant_context with (security_invoker=true) as
select
  p.user_id,
  p.randomized_product_id,
  p.randomized_card_id,
  rc.card_name,
  rc.rarity,
  p.mtgjson_uuid,
  p.scryfall_id,
  p.oracle_id,
  p.collector_number,
  p.treatment,
  p.treatment_canonical_name,
  p.per_pack_probability,
  p.packs_per_hit,
  p.expected_per_100k,
  f.normal_market_floor,
  f.normal_market_median,
  f.priced_printing_count,
  f.price_as_of,
  p.randomized_card_printing_id
from public.secret_lair_randomized_card_printings p
join public.secret_lair_randomized_cards rc on rc.randomized_card_id=p.randomized_card_id
left join public.secret_lair_randomized_oracle_floors f on f.randomized_card_id=p.randomized_card_id;

grant select on public.secret_lair_randomized_card_variant_context to authenticated;

-- Lightweight identity-only view so the launch poller never invokes expensive valuation aggregation.
create or replace view public.secret_lair_randomized_tcg_discovery_context with (security_invoker=true) as
select
  p.user_id,
  p.randomized_product_id,
  p.randomized_card_printing_id,
  p.randomized_card_id,
  c.card_name,
  p.rarity,
  p.collector_number,
  p.treatment,
  p.treatment_canonical_name,
  p.mtgjson_uuid,
  p.scryfall_id,
  p.oracle_id
from public.secret_lair_randomized_card_printings p
join public.secret_lair_randomized_cards c on c.randomized_card_id=p.randomized_card_id;

grant select on public.secret_lair_randomized_tcg_discovery_context to authenticated;

-- Actual SLZ market values replace the conservative Oracle floor only after an exact printing is confirmed.
create or replace view public.secret_lair_randomized_market_values with (security_invoker=true) as
select
  p.user_id,
  p.randomized_product_id,
  p.randomized_card_printing_id,
  c.randomized_card_id,
  c.card_name,
  p.rarity,
  p.collector_number,
  p.treatment,
  p.treatment_canonical_name,
  p.per_pack_probability,
  p.packs_per_hit,
  f.normal_market_floor,
  m.discovery_status,
  m.discovery_confidence,
  m.tcgplayer_product_id,
  m.tcgplayer_sku_ids,
  px.low_price as observed_low_price,
  px.market_price as observed_market_price,
  px.lowest_listing_price as observed_lowest_listing_price,
  px.observed_at as observed_market_at,
  coalesce(px.market_price, px.lowest_listing_price, px.low_price, f.normal_market_floor) as modeled_value,
  case
    when px.market_price is not null or px.lowest_listing_price is not null or px.low_price is not null then 'slz_market'
    else 'oracle_floor'
  end as value_source
from public.secret_lair_randomized_card_printings p
join public.secret_lair_randomized_cards c on c.randomized_card_id=p.randomized_card_id
left join public.secret_lair_randomized_oracle_floors f on f.randomized_card_id=c.randomized_card_id
left join public.secret_lair_randomized_tcgplayer_printings m
  on m.randomized_card_printing_id=p.randomized_card_printing_id
 and m.user_id=p.user_id
 and m.discovery_status='confirmed'
left join lateral (
  select q.low_price,q.market_price,q.lowest_listing_price,q.observed_at
  from public.tcgplayer_official_sku_price_current q
  where q.sku_id in (select jsonb_array_elements_text(coalesce(m.tcgplayer_sku_ids,'[]'::jsonb)))
  order by q.observed_at desc nulls last
  limit 1
) px on true;

grant select on public.secret_lair_randomized_market_values to authenticated;

-- Keep the launch watcher inexpensive and frequent. The function itself retries unconfirmed rows only
-- after a cooldown and prioritizes mythic/chase treatments first.
do $$ begin
  perform cron.unschedule('secret-lair-zeta-market-sync');
exception when others then null;
end $$;

select cron.schedule(
  'secret-lair-zeta-market-sync',
  '*/10 * * * *',
  $$select net.http_post(
    url := 'https://bnsnlikjeogzdubgyvxk.supabase.co/functions/v1/secret-lair-zeta-market-sync',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-collectish-cron-key',(select decrypted_secret from vault.decrypted_secrets where name='tcgplayer_price_cron' limit 1)
    ),
    body := '{"limit":8}'::jsonb,
    timeout_milliseconds := 120000
  );$$
);
