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

The competitive function improved by roughly 19x in the same production database measurement while returning the same 39 rows in the sampled run.

These figures are database execution measurements, not browser round-trip guarantees. Browser Runtime Health separately records real REST/RPC latency, bytes, errors, and endpoint totals from authenticated sessions.
