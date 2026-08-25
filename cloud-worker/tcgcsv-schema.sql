-- TCGCSV-backed TCGplayer pricing.
-- Production migration applied 2026-08-25.

create table if not exists public.tcgcsv_tcgplayer_prices (
  product_id bigint not null,
  group_id integer not null,
  sub_type_name text not null,
  low_price numeric,
  mid_price numeric,
  high_price numeric,
  market_price numeric,
  direct_low_price numeric,
  observed_on date not null,
  source_updated_at timestamptz not null default now(),
  primary key (product_id, sub_type_name, observed_on)
);

create index if not exists tcgcsv_tcgplayer_prices_product_latest_idx
  on public.tcgcsv_tcgplayer_prices (product_id, observed_on desc);
create index if not exists tcgcsv_tcgplayer_prices_group_latest_idx
  on public.tcgcsv_tcgplayer_prices (group_id, observed_on desc);

alter table public.tcgcsv_tcgplayer_prices enable row level security;
revoke all on table public.tcgcsv_tcgplayer_prices from anon, authenticated;

create table if not exists public.tcgcsv_sync_state (
  feed text primary key,
  source_updated_at timestamptz,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  row_count bigint,
  status text,
  detail jsonb not null default '{}'::jsonb
);
alter table public.tcgcsv_sync_state enable row level security;
revoke all on table public.tcgcsv_sync_state from anon, authenticated;

create or replace view public.tcgplayer_preferred_prices
with (security_invoker = true) as
with tcgcsv_latest as (
  select distinct on (product_id, lower(sub_type_name))
    product_id,
    lower(sub_type_name) as subtype,
    sub_type_name,
    low_price,
    mid_price,
    high_price,
    market_price,
    direct_low_price,
    observed_on,
    source_updated_at
  from public.tcgcsv_tcgplayer_prices
  order by product_id, lower(sub_type_name), observed_on desc, source_updated_at desc
), mapped as (
  select
    c.uuid,
    x.product_id,
    case
      when x.product_id::text = c.tcgplayer_etched_product_id then 'etched'
      when x.product_id::text = c.tcgplayer_alt_foil_product_id then 'foil'
      when x.subtype like '%etched%' then 'etched'
      when x.subtype like '%foil%' then 'foil'
      else 'normal'
    end as finish,
    x.low_price,
    x.mid_price,
    x.high_price,
    x.market_price,
    x.direct_low_price,
    x.observed_on,
    x.source_updated_at,
    'tcgcsv'::text as source
  from public.mtgjson_cards c
  join tcgcsv_latest x
    on x.product_id::text in (c.tcgplayer_product_id, c.tcgplayer_etched_product_id, c.tcgplayer_alt_foil_product_id)
), mtgjson_fallback as (
  select
    p.uuid,
    null::bigint as product_id,
    lower(p.finish) as finish,
    null::numeric as low_price,
    null::numeric as mid_price,
    null::numeric as high_price,
    p.price as market_price,
    null::numeric as direct_low_price,
    p.observed_on,
    p.source_updated_at,
    'mtgjson'::text as source
  from public.mtgjson_latest_vendor_prices p
  where p.provider='tcgplayer' and p.price_type='retail'
)
select * from mapped
union all
select f.* from mtgjson_fallback f
where not exists (
  select 1 from mapped m where m.uuid=f.uuid and m.finish=f.finish
);

revoke all on public.tcgplayer_preferred_prices from anon, authenticated;
