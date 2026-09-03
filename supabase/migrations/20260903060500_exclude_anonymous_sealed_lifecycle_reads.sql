drop policy if exists sealed_lifecycle_state_owner_read on public.sealed_product_lifecycle_state;
create policy sealed_lifecycle_state_owner_read on public.sealed_product_lifecycle_state
for select to authenticated
using (
  coalesce((select auth.jwt()->>'is_anonymous'),'false')<>'true'
  and (select auth.uid())=user_id
);

drop policy if exists sealed_lifecycle_events_owner_read on public.sealed_product_lifecycle_events;
create policy sealed_lifecycle_events_owner_read on public.sealed_product_lifecycle_events
for select to authenticated
using (
  coalesce((select auth.jwt()->>'is_anonymous'),'false')<>'true'
  and (select auth.uid())=user_id
);
