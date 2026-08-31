-- Distinguish a frozen research capture from a fully scored Secret Lair evaluation.
-- A research-only row may carry a WATCH placeholder for schema compatibility, but
-- consumers must not present that as the actual business recommendation.

alter table public.secret_lair_evaluations
  add column if not exists evaluation_status text not null default 'scored'
    check (evaluation_status in ('research_only','scored'));

create index if not exists secret_lair_evaluations_status_idx
  on public.secret_lair_evaluations(drop_id, evaluation_status, evaluation_phase, evaluated_at desc);

-- Harden the bundle membership table introduced with the regional model.
alter table public.secret_lair_bundle_drops enable row level security;

drop policy if exists secret_lair_bundle_drops_own on public.secret_lair_bundle_drops;
create policy secret_lair_bundle_drops_own on public.secret_lair_bundle_drops
for all to authenticated
using (
  exists (
    select 1
    from public.secret_lair_bundles b
    where b.bundle_id = secret_lair_bundle_drops.bundle_id
      and b.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.secret_lair_bundles b
    where b.bundle_id = secret_lair_bundle_drops.bundle_id
      and b.user_id = (select auth.uid())
  )
);

grant select, insert, update, delete on public.secret_lair_bundle_drops to authenticated;
