drop policy if exists secret_lair_storefront_snapshots_own
  on public.secret_lair_storefront_snapshots;

create policy secret_lair_storefront_snapshots_own
  on public.secret_lair_storefront_snapshots
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    and coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false
  );

create index if not exists secret_lair_storefront_snapshots_offer_idx
  on public.secret_lair_storefront_snapshots(offer_id)
  where offer_id is not null;

create index if not exists secret_lair_storefront_snapshots_bundle_offer_idx
  on public.secret_lair_storefront_snapshots(bundle_offer_id)
  where bundle_offer_id is not null;

create index if not exists secret_lair_storefront_snapshots_randomized_offer_idx
  on public.secret_lair_storefront_snapshots(randomized_product_offer_id)
  where randomized_product_offer_id is not null;
