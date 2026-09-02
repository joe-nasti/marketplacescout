create table if not exists public.secret_lair_storefront_snapshots (
  storefront_snapshot_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  release_id uuid not null references public.secret_lair_releases(release_id) on delete cascade,
  offer_id uuid references public.secret_lair_drop_offers(offer_id) on delete cascade,
  bundle_offer_id uuid references public.secret_lair_bundle_offers(bundle_offer_id) on delete cascade,
  randomized_product_offer_id uuid references public.secret_lair_randomized_product_offers(randomized_product_offer_id) on delete cascade,
  region text,
  captured_at timestamptz not null,
  capture_source text not null,
  availability_state text,
  api_status integer,
  api_state text,
  waiting_list boolean,
  source_url text,
  content_hash text not null,
  payload jsonb not null default '{}'::jsonb,
  page_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint secret_lair_storefront_snapshots_offer_check check (
    num_nonnulls(offer_id,bundle_offer_id,randomized_product_offer_id)=1
  )
);

create unique index if not exists secret_lair_storefront_snapshots_content_uidx
  on public.secret_lair_storefront_snapshots (
    user_id,
    capture_source,
    coalesce(offer_id,bundle_offer_id,randomized_product_offer_id),
    content_hash
  );
create index if not exists secret_lair_storefront_snapshots_release_time_idx
  on public.secret_lair_storefront_snapshots(release_id,captured_at desc);

alter table public.secret_lair_storefront_snapshots enable row level security;
drop policy if exists secret_lair_storefront_snapshots_own on public.secret_lair_storefront_snapshots;
create policy secret_lair_storefront_snapshots_own
  on public.secret_lair_storefront_snapshots
  for select to authenticated
  using ((select auth.uid())=user_id);
revoke all on table public.secret_lair_storefront_snapshots from public,anon;
grant select on table public.secret_lair_storefront_snapshots to authenticated;
grant select,insert,update,delete on table public.secret_lair_storefront_snapshots to service_role;

alter table public.secret_lair_drop_offers
  add column if not exists watch_stopped_at timestamptz,
  add column if not exists watch_stop_reason text;
alter table public.secret_lair_bundle_offers
  add column if not exists watch_stopped_at timestamptz,
  add column if not exists watch_stop_reason text;
alter table public.secret_lair_randomized_product_offers
  add column if not exists watch_stopped_at timestamptz,
  add column if not exists watch_stop_reason text;

comment on table public.secret_lair_storefront_snapshots is
  'Deduplicated official storefront/API metadata captured before and during Secret Lair sales.';
comment on column public.secret_lair_storefront_snapshots.payload is
  'Public product metadata returned by the official Secret Lair ScaleFast product endpoint.';
comment on column public.secret_lair_storefront_snapshots.page_metadata is
  'Structured metadata extracted from the official storefront page when page fallback is used.';

update public.secret_lair_randomized_product_offers o
set metadata=o.metadata||jsonb_build_object(
  'official_launch',jsonb_build_object(
    'price_usd',19.92,
    'prequeue_start_at','2026-09-02T15:00:00Z',
    'sale_start_at','2026-09-02T16:00:00Z',
    'prequeue_assignment','randomized_at_sale_start',
    'cart_reserves_inventory',false,
    'source_url','https://magic.wizards.com/en/news/announcements/chaos-vault-the-zeta-set-puts-the-playtest-in-your-hands'
  ),
  'recovered_sellout_estimate',case when o.region='US' then jsonb_build_object(
    'lower_bound','2026-09-02T18:00:00Z',
    'upper_bound','2026-09-02T18:08:00Z',
    'confidence',0.65,
    'source_type','community_report',
    'source_url','https://www.reddit.com/r/magicTCG/comments/1w5i7we/secret_lair_drop_zeta_complaint_thread/',
    'is_exact_telemetry',false
  ) else coalesce(o.metadata->'recovered_sellout_estimate','null'::jsonb) end
),updated_at=now()
from public.secret_lair_randomized_products p
where p.randomized_product_id=o.randomized_product_id
  and p.product_name='Zeta Booster';

insert into public.secret_lair_evidence(
  user_id,release_id,source_type,source_name,source_url,author,observed_at,published_at,
  evidence_class,claim_dimension,direction,confidence,summary,metadata
)
select r.user_id,r.release_id,'reddit','Reddit launch reports',
  'https://www.reddit.com/r/magicTCG/comments/1w5i7we/secret_lair_drop_zeta_complaint_thread/',
  'Secret Lair customers','2026-09-02T18:08:00Z','2026-09-02T18:08:00Z',
  'observed_signal','supply','bullish',0.65,
  'Contemporary customer reports place the US queue reopening near 18:00 UTC and the displayed US sellout near 18:08 UTC. Treat this as an estimated interval, not exact first-party telemetry.',
  jsonb_build_object(
    'canonical_seed','zeta_recovered_us_sellout_estimate',
    'region','US','lower_bound','2026-09-02T18:00:00Z','upper_bound','2026-09-02T18:08:00Z',
    'is_exact_telemetry',false,'confidence_basis','multiple contemporary user reports'
  )
from public.secret_lair_releases r
where r.release_name='Secret Lair x MSCHF: The Zeta Set'
  and not exists (
    select 1 from public.secret_lair_evidence e
    where e.user_id=r.user_id and e.release_id=r.release_id
      and e.metadata->>'canonical_seed'='zeta_recovered_us_sellout_estimate'
  );

update public.secret_lair_observations ob
set metadata=ob.metadata||jsonb_build_object(
  'recovered_sellout_estimate',jsonb_build_object(
    'lower_bound','2026-09-02T18:00:00Z','upper_bound','2026-09-02T18:08:00Z',
    'confidence',0.65,'is_exact_telemetry',false,
    'source_url','https://www.reddit.com/r/magicTCG/comments/1w5i7we/secret_lair_drop_zeta_complaint_thread/'
  )
)
from public.secret_lair_randomized_product_offers o
join public.secret_lair_randomized_products p on p.randomized_product_id=o.randomized_product_id
where ob.randomized_product_offer_id=o.randomized_product_offer_id
  and p.product_name='Zeta Booster' and o.region='US'
  and ob.availability_state='sold_out';
