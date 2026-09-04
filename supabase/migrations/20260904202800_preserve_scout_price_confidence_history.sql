insert into public.data_preservation_registry(
  table_name,data_class,preservation_tier,minimum_granularity,future_features,authoritative_source,can_rebuild,destructive_change_blocked,notes,reviewed_at
) values (
  'scout_price_confidence_history','derived_history','PRESERVE_DERIVED','material exact-SKU confidence state changes and opportunity starts',
  array['Price confidence calibration','Microstructure reliability','Opportunity outcome calibration','Scout historical replay'],
  false,true,true,
  'Append-only derived recommendation/evidence ledger. Historical rows preserve point-in-time price/depth/sales coverage without look-ahead. Rebuild is theoretically possible only while all upstream raw histories remain intact; preserve for reproducibility and calibration.',now()
)
on conflict(table_name) do update set
  data_class=excluded.data_class,
  preservation_tier=excluded.preservation_tier,
  minimum_granularity=excluded.minimum_granularity,
  future_features=excluded.future_features,
  authoritative_source=excluded.authoritative_source,
  can_rebuild=excluded.can_rebuild,
  destructive_change_blocked=true,
  notes=excluded.notes,
  reviewed_at=now();
