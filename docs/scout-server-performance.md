# Scout server performance

## 2026-08-23 MTGJSON print-stats cache

The Scout execution overlays were profiled directly in the production Supabase project using `pg_stat_statements` and `EXPLAIN (ANALYZE, BUFFERS)`.

### Bottleneck

`competitive_financial_opportunities(null)` repeatedly derived first release date, latest release date, and set count from the full `mtgjson_cards` catalog for each selected competitive card. `mtgjson_cards` contains roughly 122k rows, so those repeated lateral aggregates dominated the downstream actionable/sizing RPC chain.

Observed before the change:

- `competitive_financial_opportunities(null)`: ~3.84 s in a representative `EXPLAIN ANALYZE`
- historical PostgREST mean for `scout_position_sizing`: ~5.61 s
- historical PostgREST mean for `scout_portfolio_allocation`: ~3.74 s
- historical PostgREST mean for `actionable_emerging_opportunities`: ~6.10 s

### Change

Supabase migration `cache_mtgjson_print_stats_for_competitive_scout` added `public.mtgjson_print_stats_cache` with precomputed oracle-id and normalized-name print statistics:

- first release date
- latest release date
- distinct set count
- refresh timestamp

`competitive_financial_opportunities` now joins this cache instead of rescanning `mtgjson_cards` for those aggregates.

The cache contains only global MTGJSON metadata. RLS is enabled; authenticated users may read it, anon is not granted access. `refresh_mtgjson_print_stats_cache()` is `SECURITY INVOKER`, revoked from public/anon/authenticated, and executable only by `service_role`.

The MTGJSON identity workflow refreshes the cache immediately after the commerce catalog import, so the cache lifecycle follows the data that determines it.

The same migration also converted the Scout cache/volatility/shadow RLS predicates from per-row `auth.uid()` evaluation to `(select auth.uid())`, as recommended by the Supabase performance advisor.

### Verified after the change

Representative direct database timings after the cache was populated:

- `competitive_financial_opportunities(null)`: ~203 ms
- `actionable_emerging_opportunities(80)`: ~240 ms
- `scout_position_sizing(150)`: ~291 ms
- `scout_portfolio_allocation(1000,40)`: ~256 ms
- `cross_source_market_watches(60)`: ~164 ms

The competitive function improved by roughly 19x in the same production database measurement while returning the same 39 rows in the sampled run. The downstream cross-source signal path also moved from a historical multi-second profile into the sub-second range after the same cache change.

These figures are database execution measurements, not browser round-trip guarantees. Browser Runtime Health separately records real REST/RPC latency, bytes, errors, and endpoint totals from authenticated sessions.

## 2026-08-23 Scout freshness index

### Bottleneck

The browser health/freshness path asks for the newest `v5_computed_at` value from `scout_opportunities_v5_cache`. Historically, the PostgREST query family averaged roughly 126 ms because the cache did not have an index that matched both the RLS ownership predicate and timestamp ordering.

A representative pre-index database plan performed a sequential scan across roughly 29k cache rows plus a top-N sort just to return one timestamp.

### Change

Supabase migration `optimize_scout_freshness_indexes` added:

`scout_opportunities_v5_cache_user_fresh_idx (user_id, v5_computed_at desc nulls last)`

A candidate user-scoped volatility freshness index was also tested, but Postgres correctly continued to prefer the existing `fetched_at` index on the much smaller volatility table. The redundant candidate index was removed in migration `remove_redundant_volatility_freshness_index` rather than adding unnecessary write/index maintenance overhead.

### Verified after the change

Under the real `authenticated` database role with an actual user JWT claim, the latest-cache timestamp query now uses:

- one `auth.uid()` init plan
- `scout_opportunities_v5_cache_user_fresh_idx`
- an index-only scan
- 3 shared buffer hits
- 0 heap fetches

Representative execution time was ~0.16 ms at the database layer.

This preserves the existing RLS behavior and query contract while eliminating the full-cache scan/sort from the freshness path.
