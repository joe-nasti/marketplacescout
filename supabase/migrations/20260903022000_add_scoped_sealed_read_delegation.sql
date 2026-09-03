create table if not exists public.sealed_read_delegations (
  grantee_user_id uuid not null references auth.users(id) on delete cascade,
  source_user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null default 'scout_sealed_verification',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (grantee_user_id, source_user_id, scope),
  constraint sealed_read_delegations_no_self check (grantee_user_id <> source_user_id),
  constraint sealed_read_delegations_scope_check check (scope = 'scout_sealed_verification')
);

alter table public.sealed_read_delegations enable row level security;
revoke all on table public.sealed_read_delegations from anon, authenticated;

drop function if exists public.can_read_sealed_user(uuid);
create function public.can_read_sealed_user(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select target_user_id = auth.uid()
    or exists (
      select 1
      from public.sealed_read_delegations d
      where d.grantee_user_id = auth.uid()
        and d.source_user_id = target_user_id
        and d.scope = 'scout_sealed_verification'
        and d.enabled
    );
$$;

revoke all on function public.can_read_sealed_user(uuid) from public;
grant execute on function public.can_read_sealed_user(uuid) to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'sealed_component_ev_current',
    'sealed_component_tcg_current',
    'sealed_derived_single_source_cache',
    'sealed_ev_backtest_pool_items',
    'sealed_ev_backtest_slots',
    'sealed_ev_backtests',
    'sealed_ev_current',
    'sealed_expected_single_component_base',
    'sealed_out_optimization_current',
    'sealed_product_executable_ev_cache',
    'sealed_set_profiles',
    'sealed_single_source_compare_current'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_delegated_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.can_read_sealed_user(user_id))',
      t || '_delegated_select',
      t
    );
  end loop;
end
$$;
