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

## 2026-08-23 Scout shadow vendor-price cache

### Bottleneck

The V5 shadow refresh originally paged `scout_opportunities_24h` using a concatenated text cursor and, for every SKU, searched `mtgjson_vendor_prices` for the newest matching UUID/finish day. At the time of profiling:

- `mtgjson_vendor_prices`: ~4.84 million rows / ~924 MB
- `scout_opportunities_24h`: ~29k active rows
- historical `refresh_scout_v5_shadow_batch` mean: ~327 ms
- historical `refresh_scout_v5_shadow` mean: ~18 s

A measured full rebuild after only the cursor/direct-finish rewrite still took ~31.3 s because it touched roughly 859k shared buffers and read ~31k blocks from vendor-price history.

### Changes

Migration `optimize_scout_v5_shadow_batch` changed batch pagination to the existing `(user_id, sku_id)` primary-key order and removed redundant `lower(finish)` wrappers. A row-value cursor benchmark reduced the 350-row page lookup from roughly 62 ms of sequential scan/sort work to ~0.38 ms via an index-only scan.

Migration `cache_current_vendor_prices_for_scout_shadow` added `public.scout_vendor_price_current_cache`, materializing only the latest-day vendor values required by the shadow score:

- Card Kingdom retail
- Card Kingdom buylist
- ManaPool retail
- Cardmarket retail
- latest observed date

The cache preserves the previous semantics: for each UUID/finish, only provider rows from the globally latest `observed_on` day are eligible. A 500-key comparison against the old history lookup produced 0 mismatches.

The cache currently contains roughly 170k UUID/finish rows. Normal app roles cannot read it, and `refresh_scout_vendor_price_current_cache()` cannot be executed by `anon` or `authenticated`; the service role alone has table access and RPC execution. The refresh function also checks the JWT role claim before rebuilding the cache.

The daily MTGJSON price workflow refreshes this cache immediately after importing new vendor prices, so frequent Scout shadow rebuilds read the compact current snapshot instead of re-deriving current prices from history.

### Verified after the change

Representative production measurements:

- direct `finish` equality vs `lower(finish)` in the old history lookup: ~290 ms → ~138 ms for the 350-row lookup benchmark
- row-value Scout cursor: ~62 ms → ~0.38 ms for the 350-row page lookup
- full `refresh_scout_v5_shadow()`: ~31.3 s measured history-table run → ~5.9 s with the materialized current-price cache

The full rebuild improved roughly 5.3x versus the immediately preceding measured run while preserving sampled vendor-price inputs and all existing V5 score math.

## 2026-08-23 Scout 24h rollup and sales-enrichment candidates

### 24h refresh profiling

`refresh_scout_opportunities_24h()` was measured at ~11.1 s in a cold production run and roughly 8 s once the relevant pages were warm. The source window is approximately 34k recent scan rows collapsing to about 29k SKU rows. The raw scan table is roughly 312k rows / 665 MB.

A partial index was added for the all-history latest-demand lookup:

`marketplace_scan_rows_user_demand_latest_idx (user_id, product_name, coalesce(edhrec_observed_at, commander_enriched_at) desc nulls last, id desc)`

with the same signal-bearing predicate used by the refresh. A warm indexed latest-demand query is ~0.5 s; forcing a sequential scan/sort takes ~4.36 s and spills to disk.

The 24h `recent` CTE was also narrowed from `r.*` to only the fields actually needed by latest/earliest/aggregate/scoring logic. That reduced refresh temp spill from roughly 14.8k/7.9k temp read/write blocks to roughly 2.6k/1.8k, although end-to-end wall time remained around 8 s. Direct profiling showed the extraction, latest selection, and forced percentile aggregation are each only hundreds of milliseconds; the remaining cost is the full 29k-row score/JSON projection plus cache rewrite. A larger improvement would require an incremental refresh design rather than another simple index.

### Sales-enrichment candidate optimization

`get_scout_sales_enrichment_candidates()` historically recomputed latest raw SKU state directly from `marketplace_scan_rows`. A fresh production plan before the change was ~583 ms and still spilled temporary blocks.

To move this selector onto the already-computed 24h rollup without changing semantics, the rollup now preserves four latest-raw inputs separately from its joined demand/scoring fields:

- `structural_score_latest`
- `raw_demand_adjustment_latest`
- `raw_demand_signal_latest`
- `raw_demand_signal_score_latest`

After refreshing the rollup, all five candidate inputs—including `base_score_latest` as current score—were compared against independently re-derived latest raw scan values across 29,059 SKUs. Mismatches: 0 for every field.

`get_scout_sales_enrichment_candidates()` now groups directly from `scout_opportunities_24h` and no longer re-reads raw scan history.

Representative database timing:

- before: ~583 ms
- after: ~190 ms

That is roughly a 3x improvement, with no temporary spill in the post-change plan. The function remains service-role-only; neither `anon` nor `authenticated` can execute it.
