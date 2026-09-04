create or replace function public.refresh_sealed_inventory_fit_direct_observations()
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  changed integer;
begin
  with latest_scan as (
    select distinct on (user_id)
      user_id, scan_id, captured_at
    from public.marketplace_scans
    where set_slug = 'sealed-precon-direct-refresh'
    order by user_id, captured_at desc
  ),
  latest as (
    select
      r.user_id, r.sku_id, r.direct_available, r.direct_low, s.captured_at
    from latest_scan s
    join public.marketplace_scan_rows r
      on r.user_id = s.user_id and r.scan_id = s.scan_id
    where r.raw_json->>'coverage' = 'COMPLETE'
      and r.direct_available is not null
  )
  update public.sealed_component_ev_current c
  set
    sku_id = t.sku_id,
    product_id = t.product_id,
    direct_available_current = l.direct_available,
    direct_low_current = l.direct_low,
    direct_observed_at = l.captured_at,
    direct_net_current = case when l.direct_low is not null then round(l.direct_low * .80, 2) end,
    direct_status = case when l.direct_available > 0 then 'direct_live' else 'direct_observed_zero' end
  from public.sealed_inventory_fit_component_targets t
  join latest l on l.user_id = t.user_id and l.sku_id = t.sku_id
  where c.user_id = t.user_id
    and c.sealed_uuid = t.sealed_uuid
    and c.card_name is not distinct from t.card_name
    and c.set_code is not distinct from t.set_code
    and c.collector_number is not distinct from t.collector_number
    and c.finish is not distinct from t.finish
    and (
      c.sku_id is distinct from t.sku_id
      or c.product_id is distinct from t.product_id
      or c.direct_available_current is distinct from l.direct_available
      or c.direct_low_current is distinct from l.direct_low
      or c.direct_observed_at is distinct from l.captured_at
    );
  get diagnostics changed = row_count;
  return changed;
end;
$function$;

revoke all on function public.refresh_sealed_inventory_fit_direct_observations() from public, anon, authenticated;
grant execute on function public.refresh_sealed_inventory_fit_direct_observations() to service_role;

comment on function public.refresh_sealed_inventory_fit_direct_observations() is
  'Hydrates the latest complete exact-SKU Direct scan into sealed inventory-fit components, updating only changed observations.';
