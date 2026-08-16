-- Keep the per-row Scout commander-context carry-forward lookup cheap while
-- Marketplace scans are persisted in bounded batches. This matches the lookup
-- performed by apply_latest_commander_context_to_scout_row() without changing
-- scoring or trigger behavior.
create index if not exists marketplace_scan_rows_commander_context_lookup_idx
on public.marketplace_scan_rows (
  product_name,
  (coalesce(edhrec_observed_at, commander_enriched_at)) desc nulls last,
  id desc
)
where demand_signal is not null or edhrec_observed_at is not null;
