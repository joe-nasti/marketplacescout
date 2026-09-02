-- Make randomized Secret Lair products first-class regional launch-monitor targets.
create table if not exists public.secret_lair_randomized_product_offers (
  randomized_product_offer_id uuid primary key default gen_random_uuid(),
  randomized_product_id uuid not null references public.secret_lair_randomized_products(randomized_product_id) on delete cascade,
  release_id uuid not null references public.secret_lair_releases(release_id) on delete cascade,
  user_id uuid not null default auth.uid(),
  region text not null check (region in ('US','REU','UK')),
  currency text not null,
  price numeric(10,2),
  product_url text not null,
  external_product_id text not null,
  order_limit integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (randomized_product_id, region),
  unique (region, external_product_id)
);

alter table public.secret_lair_observations
  add column if not exists randomized_product_offer_id uuid
  references public.secret_lair_randomized_product_offers(randomized_product_offer_id) on delete set null;

create index if not exists secret_lair_randomized_product_offers_release_idx
  on public.secret_lair_randomized_product_offers(release_id, region);
create index if not exists secret_lair_observations_randomized_offer_time_idx
  on public.secret_lair_observations(randomized_product_offer_id, observed_at desc)
  where randomized_product_offer_id is not null;

alter table public.secret_lair_randomized_product_offers enable row level security;
drop policy if exists secret_lair_randomized_product_offers_own on public.secret_lair_randomized_product_offers;
create policy secret_lair_randomized_product_offers_own
  on public.secret_lair_randomized_product_offers for all to authenticated
  using ((select auth.uid()) = user_id and (select (auth.jwt()->>'is_anonymous')::boolean) is false)
  with check ((select auth.uid()) = user_id and (select (auth.jwt()->>'is_anonymous')::boolean) is false);
grant select, insert, update, delete on public.secret_lair_randomized_product_offers to authenticated;
grant select, insert, update, delete on public.secret_lair_randomized_product_offers to service_role;

insert into public.secret_lair_randomized_product_offers
  (randomized_product_id,release_id,user_id,region,currency,price,product_url,external_product_id,order_limit,metadata)
select rp.randomized_product_id,rp.release_id,rp.user_id,x.region,x.currency,19.92,x.product_url,x.external_product_id,12,
  jsonb_build_object('source','official_secret_lair_product_metadata','provider_sku',x.provider_sku,'refid','sku::'||x.provider_sku,
    'shipping_begins',x.shipping_begins,'product_created_at','2026-08-12 09:38:50','event_start_raw','2026/09/02 18:00',
    'prequeue_enabled',true,'recovered_api_snapshot',x.api_snapshot,'recovered_at','2026-09-02T19:29:00Z')
from public.secret_lair_randomized_products rp
cross join (values
  ('US'::text,'USD'::text,'https://secretlair.wizards.com/us/en/product/1254424/secret-lair-x-mschf-the-zeta-set','1254424'::text,'D62800000_US'::text,'2026-11-05'::text,'{"waiting_list":true,"stock":"10","stock_policy":"DENY_PURCHASE","low_stock":true}'::jsonb),
  ('REU','EUR','https://secretlair.wizards.com/eu/en/product/1254425/secret-lair-x-mschf-the-zeta-set','1254425','D62800000-EU','2026-12-08','{"waiting_list":true,"stock":"10","stock_policy":"DENY_PURCHASE","low_stock":false}'::jsonb),
  ('UK','GBP','https://secretlair.wizards.com/uk/en/product/1254426/secret-lair-x-mschf-the-zeta-set','1254426','D62800000_UK','2026-12-08','{"waiting_list":true,"stock":"0","stock_policy":"DENY_PURCHASE","low_stock":true}'::jsonb)
) x(region,currency,product_url,external_product_id,provider_sku,shipping_begins,api_snapshot)
where rp.product_name='Zeta Booster'
on conflict (randomized_product_id,region) do update set
  currency=excluded.currency,price=excluded.price,product_url=excluded.product_url,
  external_product_id=excluded.external_product_id,order_limit=excluded.order_limit,
  metadata=public.secret_lair_randomized_product_offers.metadata||excluded.metadata,updated_at=now();

-- The three storefront pages were generated with an embedded SOLD_OUT state at this
-- shared Last-Modified timestamp. This is an official upper-bound observation, not an
-- assertion that the inventory transition happened at this exact second.
insert into public.secret_lair_observations
  (user_id,release_id,randomized_product_offer_id,region,observed_at,observation_type,
   availability_state,elapsed_minutes_from_sale,source_url,notes,metadata)
select o.user_id,o.release_id,o.randomized_product_offer_id,o.region,'2026-09-02T18:51:28Z','sold_out',
  'sold_out',171,o.product_url,
  'Recovered official storefront upper bound: page source embedded SOLD_OUT by its shared Last-Modified timestamp.',
  jsonb_build_object('capture_source','recovered_official_page_metadata','timestamp_semantics','upper_bound_not_exact_transition','page_last_modified','2026-09-02T18:51:28Z','external_product_id',o.external_product_id,'confidence',0.85)
from public.secret_lair_randomized_product_offers o
where o.external_product_id in ('1254424','1254425','1254426')
  and not exists (
    select 1 from public.secret_lair_observations existing
    where existing.randomized_product_offer_id=o.randomized_product_offer_id
      and existing.metadata->>'capture_source'='recovered_official_page_metadata'
  );

create or replace view public.secret_lair_sellout_intervals with (security_invoker=true) as
with first_sold as (
  select user_id,release_id,drop_id,offer_id,bundle_offer_id,randomized_product_offer_id,region,finish,
         min(observed_at) filter(where availability_state='sold_out') first_sold_out_at,
         min(elapsed_minutes_from_sale) filter(where availability_state='sold_out') first_sold_out_elapsed
  from public.secret_lair_observations
  group by user_id,release_id,drop_id,offer_id,bundle_offer_id,randomized_product_offer_id,region,finish
)
select f.user_id,f.release_id,f.drop_id,f.offer_id,f.bundle_offer_id,f.region,f.finish,
       a.last_available_at,a.last_available_elapsed,f.first_sold_out_at,f.first_sold_out_elapsed,
       case when a.last_available_at is not null and f.first_sold_out_at is not null then extract(epoch from (f.first_sold_out_at-a.last_available_at))/60.0 end sellout_interval_minutes,
       f.randomized_product_offer_id
from first_sold f
left join lateral (
  select max(o.observed_at) last_available_at,
         max(o.elapsed_minutes_from_sale) filter(where o.observed_at=(select max(o2.observed_at) from public.secret_lair_observations o2 where o2.user_id=f.user_id and o2.release_id=f.release_id and o2.drop_id is not distinct from f.drop_id and o2.offer_id is not distinct from f.offer_id and o2.bundle_offer_id is not distinct from f.bundle_offer_id and o2.randomized_product_offer_id is not distinct from f.randomized_product_offer_id and o2.region is not distinct from f.region and o2.finish is not distinct from f.finish and o2.availability_state in ('available','low_stock') and (f.first_sold_out_at is null or o2.observed_at<=f.first_sold_out_at))) last_available_elapsed
  from public.secret_lair_observations o
  where o.user_id=f.user_id and o.release_id=f.release_id
    and o.drop_id is not distinct from f.drop_id and o.offer_id is not distinct from f.offer_id
    and o.bundle_offer_id is not distinct from f.bundle_offer_id and o.randomized_product_offer_id is not distinct from f.randomized_product_offer_id
    and o.region is not distinct from f.region and o.finish is not distinct from f.finish
    and o.availability_state in ('available','low_stock')
    and (f.first_sold_out_at is null or o.observed_at<=f.first_sold_out_at)
) a on true;
grant select on public.secret_lair_sellout_intervals to authenticated;
