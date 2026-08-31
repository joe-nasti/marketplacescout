alter table public.secret_lair_drops
  add column if not exists supply_prior text not null default 'unknown',
  add column if not exists supply_prior_confidence numeric(4,3) not null default 0.0,
  add column if not exists supply_prior_rationale text,
  add column if not exists supply_prior_source text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='secret_lair_drops_supply_prior_check') then
    alter table public.secret_lair_drops add constraint secret_lair_drops_supply_prior_check check (supply_prior = any(array['unknown','low','typical','high','very_high']));
  end if;
  if not exists (select 1 from pg_constraint where conname='secret_lair_drops_supply_prior_confidence_check') then
    alter table public.secret_lair_drops add constraint secret_lair_drops_supply_prior_confidence_check check (supply_prior_confidence between 0 and 1);
  end if;
end $$;

create table if not exists public.secret_lair_assets (
  asset_id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  release_id uuid not null references public.secret_lair_releases(release_id) on delete cascade,
  drop_id uuid references public.secret_lair_drops(drop_id) on delete cascade,
  bundle_id uuid references public.secret_lair_bundles(bundle_id) on delete cascade,
  asset_type text not null,
  source_url text not null,
  source_product_id text,
  source_region text,
  storage_bucket text not null default 'secret-lair-assets',
  storage_path text not null,
  public_url text,
  mime_type text,
  content_hash text,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  download_status text not null default 'pending',
  last_fetched_at timestamptz,
  width integer,
  height integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint secret_lair_assets_parent_check check ((drop_id is not null)::int + (bundle_id is not null)::int <= 1),
  constraint secret_lair_assets_type_check check (asset_type = any(array['thumbnail','hero','contents','gallery','discord','other'])),
  constraint secret_lair_assets_status_check check (download_status = any(array['pending','downloaded','error','stale']))
);
create unique index if not exists secret_lair_assets_storage_path_uq on public.secret_lair_assets(storage_bucket,storage_path);
create index if not exists secret_lair_assets_drop_idx on public.secret_lair_assets(drop_id,is_primary desc,asset_type,sort_order);
create index if not exists secret_lair_assets_bundle_idx on public.secret_lair_assets(bundle_id,is_primary desc,asset_type,sort_order);
create index if not exists secret_lair_assets_release_idx on public.secret_lair_assets(release_id,asset_type,sort_order);
alter table public.secret_lair_assets enable row level security;
drop policy if exists secret_lair_assets_owner_select on public.secret_lair_assets;
create policy secret_lair_assets_owner_select on public.secret_lair_assets for select to authenticated using (auth.uid()=user_id);
drop policy if exists secret_lair_assets_owner_insert on public.secret_lair_assets;
create policy secret_lair_assets_owner_insert on public.secret_lair_assets for insert to authenticated with check (auth.uid()=user_id);
drop policy if exists secret_lair_assets_owner_update on public.secret_lair_assets;
create policy secret_lair_assets_owner_update on public.secret_lair_assets for update to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
drop policy if exists secret_lair_assets_owner_delete on public.secret_lair_assets;
create policy secret_lair_assets_owner_delete on public.secret_lair_assets for delete to authenticated using (auth.uid()=user_id);
grant select,insert,update,delete on public.secret_lair_assets to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('secret-lair-assets','secret-lair-assets',true,15728640,array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types,updated_at=now();

create or replace view public.secret_lair_sellout_intervals with (security_invoker=true) as
with first_sold as (
  select user_id,release_id,drop_id,offer_id,bundle_offer_id,region,finish,
         min(observed_at) filter(where availability_state='sold_out') first_sold_out_at,
         min(elapsed_minutes_from_sale) filter(where availability_state='sold_out') first_sold_out_elapsed
  from public.secret_lair_observations
  group by user_id,release_id,drop_id,offer_id,bundle_offer_id,region,finish
)
select f.user_id,f.release_id,f.drop_id,f.offer_id,f.bundle_offer_id,f.region,f.finish,
       a.last_available_at,a.last_available_elapsed,f.first_sold_out_at,f.first_sold_out_elapsed,
       case when a.last_available_at is not null and f.first_sold_out_at is not null then extract(epoch from (f.first_sold_out_at-a.last_available_at))/60.0 end sellout_interval_minutes
from first_sold f
left join lateral (
  select max(o.observed_at) last_available_at,
         max(o.elapsed_minutes_from_sale) filter(where o.observed_at=(select max(o2.observed_at) from public.secret_lair_observations o2 where o2.user_id=f.user_id and o2.release_id=f.release_id and o2.drop_id is not distinct from f.drop_id and o2.offer_id is not distinct from f.offer_id and o2.bundle_offer_id is not distinct from f.bundle_offer_id and o2.region is not distinct from f.region and o2.finish is not distinct from f.finish and o2.availability_state='available' and (f.first_sold_out_at is null or o2.observed_at<=f.first_sold_out_at))) last_available_elapsed
  from public.secret_lair_observations o
  where o.user_id=f.user_id and o.release_id=f.release_id
    and o.drop_id is not distinct from f.drop_id and o.offer_id is not distinct from f.offer_id
    and o.bundle_offer_id is not distinct from f.bundle_offer_id and o.region is not distinct from f.region
    and o.finish is not distinct from f.finish and o.availability_state='available'
    and (f.first_sold_out_at is null or o.observed_at<=f.first_sold_out_at)
) a on true;
grant select on public.secret_lair_sellout_intervals to authenticated;
