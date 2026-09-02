alter table public.sealed_collation_adapters enable row level security;
alter table public.sealed_collation_profile_bindings enable row level security;

drop policy if exists sealed_collation_adapters_authenticated_read on public.sealed_collation_adapters;
create policy sealed_collation_adapters_authenticated_read
on public.sealed_collation_adapters for select to authenticated using (true);

drop policy if exists sealed_collation_profile_bindings_authenticated_read on public.sealed_collation_profile_bindings;
create policy sealed_collation_profile_bindings_authenticated_read
on public.sealed_collation_profile_bindings for select to authenticated using (true);

revoke insert,update,delete on public.sealed_collation_adapters from anon,authenticated;
revoke insert,update,delete on public.sealed_collation_profile_bindings from anon,authenticated;
grant select on public.sealed_collation_adapters,public.sealed_collation_profile_bindings to authenticated;
grant select,insert,update,delete on public.sealed_collation_adapters,public.sealed_collation_profile_bindings to service_role;

alter view public.sealed_product_model_coverage set (security_invoker=true);
notify pgrst, 'reload schema';
