drop policy if exists secret_lair_storefront_snapshots_own
  on public.secret_lair_storefront_snapshots;

create policy secret_lair_storefront_snapshots_own
  on public.secret_lair_storefront_snapshots
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  );
