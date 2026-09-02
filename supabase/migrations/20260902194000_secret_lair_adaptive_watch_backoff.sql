-- The cron remains a lightweight dispatcher, while external storefront checks are
-- scheduled per offer and back off exponentially while state remains unchanged.
alter table public.secret_lair_drop_offers
  add column if not exists watch_last_state text,
  add column if not exists watch_last_checked_at timestamptz,
  add column if not exists watch_next_check_at timestamptz,
  add column if not exists watch_unchanged_checks integer not null default 0 check (watch_unchanged_checks >= 0),
  add column if not exists watch_interval_minutes integer check (watch_interval_minutes >= 2);

alter table public.secret_lair_bundle_offers
  add column if not exists watch_last_state text,
  add column if not exists watch_last_checked_at timestamptz,
  add column if not exists watch_next_check_at timestamptz,
  add column if not exists watch_unchanged_checks integer not null default 0 check (watch_unchanged_checks >= 0),
  add column if not exists watch_interval_minutes integer check (watch_interval_minutes >= 2);

alter table public.secret_lair_randomized_product_offers
  add column if not exists watch_last_state text,
  add column if not exists watch_last_checked_at timestamptz,
  add column if not exists watch_next_check_at timestamptz,
  add column if not exists watch_unchanged_checks integer not null default 0 check (watch_unchanged_checks >= 0),
  add column if not exists watch_interval_minutes integer check (watch_interval_minutes >= 2);

create index if not exists secret_lair_drop_offers_watch_due_idx
  on public.secret_lair_drop_offers(watch_next_check_at) where external_product_id is not null;
create index if not exists secret_lair_bundle_offers_watch_due_idx
  on public.secret_lair_bundle_offers(watch_next_check_at) where external_product_id is not null;
create index if not exists secret_lair_randomized_offers_watch_due_idx
  on public.secret_lair_randomized_product_offers(watch_next_check_at) where external_product_id is not null;

with latest as (
  select distinct on (randomized_product_offer_id) randomized_product_offer_id,availability_state,observed_at
  from public.secret_lair_observations where randomized_product_offer_id is not null
  order by randomized_product_offer_id,observed_at desc
)
update public.secret_lair_randomized_product_offers o set
  watch_last_state=latest.availability_state,
  watch_last_checked_at=latest.observed_at,
  watch_next_check_at=case when latest.availability_state='sold_out' then now()+interval '30 minutes' when latest.availability_state='pulled' then now()+interval '1 day' else now() end,
  watch_interval_minutes=case when latest.availability_state='sold_out' then 30 when latest.availability_state='pulled' then 1440 else 2 end
from latest where latest.randomized_product_offer_id=o.randomized_product_offer_id and o.watch_last_checked_at is null;

with latest as (
  select distinct on (offer_id) offer_id,availability_state,observed_at
  from public.secret_lair_observations where offer_id is not null
  order by offer_id,observed_at desc
)
update public.secret_lair_drop_offers o set
  watch_last_state=latest.availability_state,watch_last_checked_at=latest.observed_at,
  watch_next_check_at=case when latest.availability_state='sold_out' then now()+interval '30 minutes' when latest.availability_state='pulled' then now()+interval '1 day' else now() end,
  watch_interval_minutes=case when latest.availability_state='sold_out' then 30 when latest.availability_state='pulled' then 1440 else 2 end
from latest where latest.offer_id=o.offer_id and o.watch_last_checked_at is null;

with latest as (
  select distinct on (bundle_offer_id) bundle_offer_id,availability_state,observed_at
  from public.secret_lair_observations where bundle_offer_id is not null
  order by bundle_offer_id,observed_at desc
)
update public.secret_lair_bundle_offers o set
  watch_last_state=latest.availability_state,watch_last_checked_at=latest.observed_at,
  watch_next_check_at=case when latest.availability_state='sold_out' then now()+interval '30 minutes' when latest.availability_state='pulled' then now()+interval '1 day' else now() end,
  watch_interval_minutes=case when latest.availability_state='sold_out' then 30 when latest.availability_state='pulled' then 1440 else 2 end
from latest where latest.bundle_offer_id=o.bundle_offer_id and o.watch_last_checked_at is null;
