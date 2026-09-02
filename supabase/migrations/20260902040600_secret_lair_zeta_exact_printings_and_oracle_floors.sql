create table if not exists public.secret_lair_randomized_card_printings (
  randomized_card_printing_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  randomized_product_id uuid not null references public.secret_lair_randomized_products(randomized_product_id) on delete cascade,
  randomized_card_id uuid not null references public.secret_lair_randomized_cards(randomized_card_id) on delete cascade,
  mtgjson_uuid uuid not null,
  scryfall_id uuid,
  oracle_id uuid,
  collector_number text not null,
  rarity text not null,
  treatment text not null check (treatment in ('photocopy','negative','color_banding')),
  treatment_canonical_name text not null,
  per_pack_probability numeric not null check (per_pack_probability >= 0 and per_pack_probability <= 1),
  packs_per_hit numeric,
  expected_per_100k numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, randomized_product_id, mtgjson_uuid)
);
alter table public.secret_lair_randomized_card_printings enable row level security;
drop policy if exists secret_lair_randomized_card_printings_own on public.secret_lair_randomized_card_printings;
create policy secret_lair_randomized_card_printings_own on public.secret_lair_randomized_card_printings
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

insert into public.secret_lair_randomized_card_printings(
  user_id, randomized_product_id, randomized_card_id, mtgjson_uuid, scryfall_id, oracle_id,
  collector_number, rarity, treatment, treatment_canonical_name, per_pack_probability, packs_per_hit,
  expected_per_100k, metadata
)
select
  rc.user_id, rc.randomized_product_id, rc.randomized_card_id, mc.uuid, mc.scryfall_id, mc.scryfall_oracle_id,
  mc.collector_number, rc.rarity,
  case when mc.collector_number::int between 1 and 121 then 'photocopy'
       when mc.collector_number::int between 122 and 242 then 'negative'
       else 'color_banding' end,
  case when mc.collector_number::int between 1 and 121 then 'Photocopy'
       when mc.collector_number::int between 122 and 242 then 'Photocopy Negative'
       else 'Color Banding' end,
  ro.specific_card_probability * rt.probability,
  1/(ro.specific_card_probability * rt.probability),
  100000 * ro.specific_card_probability * rt.probability,
  jsonb_build_object('set_code','SLZ','source','mtgjson_cards','treatment_mapping_basis','collector-number blocks 1-121 / 122-242 / 243-363')
from public.secret_lair_randomized_cards rc
join public.secret_lair_randomized_products rp on rp.randomized_product_id=rc.randomized_product_id
join public.secret_lair_releases r on r.release_id=rp.release_id and r.release_name='Secret Lair x MSCHF: The Zeta Set'
join public.mtgjson_cards mc on mc.set_code='SLZ' and mc.name=rc.card_name and mc.scryfall_oracle_id=rc.oracle_id
join public.secret_lair_randomized_rarity_odds ro on ro.randomized_product_id=rp.randomized_product_id and ro.rarity=rc.rarity
join public.secret_lair_randomized_treatments rt on rt.randomized_product_id=rp.randomized_product_id and rt.treatment_name=(case when mc.collector_number::int between 1 and 121 then 'photocopy' when mc.collector_number::int between 122 and 242 then 'negative' else 'color_banding' end)
where mc.collector_number ~ '^[0-9]+$' and mc.collector_number::int between 1 and 363
on conflict (user_id, randomized_product_id, mtgjson_uuid) do update set
  randomized_card_id=excluded.randomized_card_id,scryfall_id=excluded.scryfall_id,oracle_id=excluded.oracle_id,
  collector_number=excluded.collector_number,rarity=excluded.rarity,treatment=excluded.treatment,
  treatment_canonical_name=excluded.treatment_canonical_name,per_pack_probability=excluded.per_pack_probability,
  packs_per_hit=excluded.packs_per_hit,expected_per_100k=excluded.expected_per_100k,metadata=excluded.metadata,updated_at=now();

create or replace view public.secret_lair_randomized_oracle_floors with (security_invoker=true) as
with latest_vendor as (
  select distinct on (v.uuid,v.provider,v.price_type,v.finish,v.currency)
    v.uuid,v.provider,v.price_type,v.finish,v.currency,v.price,v.observed_on
  from public.mtgjson_vendor_prices v
  where v.currency='USD' and v.provider='tcgplayer' and v.price_type='retail' and v.finish='normal' and v.price>0
  order by v.uuid,v.provider,v.price_type,v.finish,v.currency,v.observed_on desc
), family as (
  select rc.user_id,rc.randomized_product_id,rc.randomized_card_id,rc.card_name,rc.rarity,rc.oracle_id,c.uuid,lv.price,lv.observed_on
  from public.secret_lair_randomized_cards rc
  join public.mtgjson_cards c on c.scryfall_oracle_id=rc.oracle_id and c.set_code<>'SLZ'
  join latest_vendor lv on lv.uuid=c.uuid
)
select user_id,randomized_product_id,randomized_card_id,card_name,rarity,oracle_id,
       min(price) normal_market_floor,
       percentile_cont(0.5) within group (order by price) normal_market_median,
       count(*) priced_printing_count,max(observed_on) price_as_of
from family
group by user_id,randomized_product_id,randomized_card_id,card_name,rarity,oracle_id;

create or replace view public.secret_lair_randomized_card_variant_context with (security_invoker=true) as
select p.user_id,p.randomized_product_id,p.randomized_card_id,rc.card_name,rc.rarity,p.mtgjson_uuid,p.scryfall_id,p.oracle_id,p.collector_number,
       p.treatment,p.treatment_canonical_name,p.per_pack_probability,p.packs_per_hit,p.expected_per_100k,
       f.normal_market_floor,f.normal_market_median,f.priced_printing_count,f.price_as_of
from public.secret_lair_randomized_card_printings p
join public.secret_lair_randomized_cards rc on rc.randomized_card_id=p.randomized_card_id
left join public.secret_lair_randomized_oracle_floors f on f.randomized_card_id=p.randomized_card_id;
