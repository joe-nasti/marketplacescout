create or replace function public.internal_refresh_actionable_sealed_models()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  u uuid;
begin
  for u in select distinct user_id from public.sealed_ev_current loop
    perform set_config('request.jwt.claim.role','service_role',true);
    perform public.refresh_sealed_actionable_component_ev(u);
    perform public.rescore_sealed_actionable_v2(u);
    for r in select deck_key from public.precon_ev_current where user_id=u loop
      perform public.refresh_precon_actionable_ev(u,r.deck_key);
      perform public.rescore_precon_actionable_v2(u,r.deck_key);
    end loop;
    perform public.refresh_sealed_out_optimization(u);
    perform public.refresh_precon_out_optimization(u);
  end loop;

  -- The component refresh replaces rows, so restore stable exact-SKU identity and
  -- Direct observations after every scheduled model rebuild.
  perform public.refresh_sealed_inventory_fit_direct_observations();
end
$function$;

revoke all on function public.internal_refresh_actionable_sealed_models() from public, anon, authenticated;
grant execute on function public.internal_refresh_actionable_sealed_models() to service_role;

comment on function public.internal_refresh_actionable_sealed_models() is
  'Refreshes actionable sealed/precon models, then restores exact-SKU Direct observations that component rebuilds replace.';
