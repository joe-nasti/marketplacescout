alter function public.refresh_sealed_inventory_fit_direct_observations()
  set statement_timeout = '60s';

comment on function public.refresh_sealed_inventory_fit_direct_observations() is
  'Hydrates the latest complete exact-SKU Direct scan into sealed inventory-fit components; its bounded timeout exceeds the API role default for the full cache update.';
