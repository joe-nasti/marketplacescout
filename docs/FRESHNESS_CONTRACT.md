# Collectish freshness contract

Collectish must treat **source freshness**, **derived-data freshness**, and **scheduler health** as different clocks. A workflow completing successfully is not itself proof that the data served to the user is fresh.

## Contract

Every production data pipeline should define:

1. **Source clock** — timestamp of the newest upstream observation actually consumed.
2. **Derived clock** — timestamp when the user-facing cache/materialization was recomputed.
3. **Expected cadence** — how old each clock may normally be before it is considered aging or stale.
4. **Independent check** — freshness must be checked by a scheduler that is not the same scheduler responsible for producing the data whenever practical.
5. **Recovery action** — safe deterministic recovery should run automatically when available. Otherwise create an operational alert; never silently present stale data as current.
6. **UX provenance** — UI labels must name the clock being displayed and should identify naturally slow sources (for example `daily TCGCSV`) rather than using one ambiguous `updated` timestamp.

## Current production expectations

| Pipeline | Producer cadence | Freshness clock | Warning/stale expectation | Independent protection |
| --- | --- | --- | --- | --- |
| Scout v5 score/cache | hourly reconciliation, plus upstream-triggered rebuilds | `scout_opportunities_v5_cache.v5_computed_at` | aging >75m; stale >105m | `Collectish alerts` every 15m runs `watch-scout-rankings.mjs` and can recover |
| TCGplayer preferred prices | daily TCGCSV after upstream daily build | `tcgcsv_sync_state.source_updated_at` | warn when >30h or sync failed | central freshness audit; Scout UI displays this clock separately |
| SYP captured dataset | orchestrator every 30m, authenticated capture availability varies | newest `syp_products.collected_at` | operational alert >36h | `collectish-alerts.mjs` |
| Seller History orchestration | every 5m | worker/check-in + normalized order progress | queue/check-in semantics, not a single age clock | seller orchestration watchdog in `Collectish alerts` |
| Scout shared sales history | every 3h | sales-history observation/materialization timestamps | candidate-level freshness; do not equate workflow age with every SKU age | workflow failure + downstream Scout score freshness |
| Scout volatility | every 6h, candidate-level 24h staleness target | per-SKU volatility observation | candidate-level | workflow failure; should gain a surfaced derived clock before stronger auto-recovery |
| Article/Signals feeds | every 2h for generic article feeds; source-specific workflows vary | source/event ingestion timestamp | source-specific because feeds publish irregularly | workflow failure today; source-specific freshness/provenance is the next normalization target |

## Rules for new data sources

- A new source is not complete until its expected cadence and freshness clock are documented.
- If changing a preferred source (for example MTGJSON -> TCGCSV for TCGplayer prices), audit every consumer, scheduled recomputation, watchdog threshold, admin status, and user-facing freshness label in the same change.
- Never use ingestion completion time as the source timestamp when the upstream provides its own observation timestamp.
- Derived caches must preserve enough provenance to explain which source snapshot they were built from when that distinction matters.
- Independent watchdogs should use leases/idempotent recovery and must not create overlapping expensive rebuilds.
- The UI should warn on the derived clock that affects the displayed result; slower upstream clocks should be shown separately rather than making a freshly recomputed result appear stale.

## Remaining audit backlog

1. Materialize explicit freshness/provenance for shared Marketplace sales history so Scout can show `Sales` independently from `Score`.
2. Materialize a global/per-candidate volatility watermark and surface it in Admin.
3. Normalize Signals source health across articles, EDHREC, TCGplayer blog, social, YouTube, and tournament/deck ingestion without penalizing naturally quiet feeds.
4. Add one Admin data-health view backed by these contracts instead of scattered workflow-specific status cards.
5. Keep recovery logic separate from the producer scheduler for any pipeline where a safe recovery operation exists.
