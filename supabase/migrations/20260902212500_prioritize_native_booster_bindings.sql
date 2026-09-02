-- Exact-product native backtests must outrank provisional exact-product
-- placeholders, including the CMM Collector Sample Pack's old UNMODELED row.
update public.sealed_collation_profile_bindings
set priority=0,updated_at=now()
where enabled
  and sealed_uuid is not null
  and source_type in ('mtgjson_native_booster','wizards_official+mtgjson_native_booster')
  and priority>0;

notify pgrst, 'reload schema';
