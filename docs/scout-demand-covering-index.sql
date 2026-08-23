-- Reduce cold heap I/O in refresh_scout_opportunities_24h() demand context lookup.
-- Applied to production Supabase on 2026-08-23.
--
-- Measured production EXPLAIN ANALYZE for the exact DISTINCT ON demand lookup:
--   existing partial index: 13.2 s cold / 1.36 s warm
--   covering partial index: ~38 ms, Index Only Scan
--
-- Full refresh_scout_opportunities_24h() after adding this index:
--   13.16 s first measured pass, 9.88 s warm pass
--   (the remaining cost is aggregate/JSON projection, rewrite, and temp spill)
--
-- Keep marketplace_scan_rows_user_demand_latest_idx for now. Remove only after
-- sufficient production observation confirms the covering index remains preferred.

create index concurrently if not exists marketplace_scan_rows_user_demand_latest_cover_idx
on public.marketplace_scan_rows (
  user_id,
  product_name,
  coalesce(edhrec_observed_at, commander_enriched_at) desc nulls last,
  id desc
)
include (
  demand_adjustment,
  edhrec_adjustment,
  demand_signal,
  edhrec_signal,
  demand_signal_score,
  demand_sources,
  edhrec_rank,
  edhrec_observed_at,
  commander_enriched_at
)
where demand_signal is not null
   or edhrec_signal is not null
   or coalesce(demand_adjustment,edhrec_adjustment,0)<>0;
