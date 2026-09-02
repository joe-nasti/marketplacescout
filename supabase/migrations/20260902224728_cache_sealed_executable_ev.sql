create table if not exists public.sealed_product_executable_ev_cache (
  user_id uuid not null,
  sealed_uuid uuid not null references public.mtgjson_sealed_products(uuid) on delete cascade,
  tcg_low_ev numeric,
  direct_first_net_ev numeric,
  collectish_live_out_ev numeric,
  fixed_tcg_low_ev numeric,
  fixed_collectish_live_out_ev numeric,
  modeled_child_units numeric,
  price_coverage_pct numeric,
  valuation_basis text not null,
  model_key text,
  model_version text,
  valuation_as_of timestamptz,
  refreshed_at timestamptz not null default now(),
  primary key(user_id,sealed_uuid)
);

alter table public.sealed_product_executable_ev_cache enable row level security;
drop policy if exists sealed_product_executable_ev_cache_own on public.sealed_product_executable_ev_cache;
create policy sealed_product_executable_ev_cache_own
on public.sealed_product_executable_ev_cache for select to authenticated
using ((select auth.uid())=user_id);
revoke all on public.sealed_product_executable_ev_cache from anon;
grant select on public.sealed_product_executable_ev_cache to authenticated;
grant select,insert,update,delete on public.sealed_product_executable_ev_cache to service_role;

create or replace function public.refresh_sealed_product_executable_ev_cache()
returns integer
language plpgsql
security definer
set search_path=public
set statement_timeout='180s'
as $$
declare n integer;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then
    raise exception 'service_role required';
  end if;
  truncate table public.sealed_product_executable_ev_cache;
  insert into public.sealed_product_executable_ev_cache(
    user_id,sealed_uuid,tcg_low_ev,direct_first_net_ev,collectish_live_out_ev,
    fixed_tcg_low_ev,fixed_collectish_live_out_ev,modeled_child_units,
    price_coverage_pct,valuation_basis,model_key,model_version,valuation_as_of,refreshed_at)
  select user_id,sealed_uuid,tcg_low_ev,direct_first_net_ev,collectish_live_out_ev,
    fixed_tcg_low_ev,fixed_collectish_live_out_ev,modeled_child_units,
    price_coverage_pct,valuation_basis,model_key,model_version,valuation_as_of,now()
  from public.sealed_product_executable_ev_current;
  get diagnostics n=row_count;
  analyze public.sealed_product_executable_ev_cache;
  return n;
end $$;

revoke all on function public.refresh_sealed_product_executable_ev_cache() from public,anon,authenticated;
grant execute on function public.refresh_sealed_product_executable_ev_cache() to service_role;

notify pgrst,'reload schema';
