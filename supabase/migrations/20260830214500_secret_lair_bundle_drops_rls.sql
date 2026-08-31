-- Security hardening for Secret Lair bundle composition.
-- Access follows ownership of the parent bundle.

alter table public.secret_lair_bundle_drops enable row level security;

create policy secret_lair_bundle_drops_own on public.secret_lair_bundle_drops
for all to authenticated
using (
  exists (
    select 1 from public.secret_lair_bundles b
    where b.bundle_id = secret_lair_bundle_drops.bundle_id
      and b.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.secret_lair_bundles b
    where b.bundle_id = secret_lair_bundle_drops.bundle_id
      and b.user_id = (select auth.uid())
  )
);
