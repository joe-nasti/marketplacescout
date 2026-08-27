# Scout universal catalog

Scout coverage is split into three layers so historical Magic printings do not need to stay in the expensive recurring scanner.

- **Catalog:** every English Near Mint TCGplayer SKU known to MTGJSON is addressable through `scout_card_catalog`.
- **Baseline:** `scout_card_state` stores the last real Scout evaluation for a user/sku. Existing V5 shadow evaluations seed this layer.
- **Active:** normal configured Scout scans continue to provide current recurring coverage for the sets/cards already selected for regular monitoring.

`scout_refresh_queue` is the event-driven wake queue. `wake_scout_card(...)` can nominate an exact product/Scryfall identity without changing its score. The five-minute Marketplace cloud worker runs `cloud-worker/scout-universe-backfill.mjs`, which prioritizes wake requests and otherwise queues one low-priority, one-time Full set scan at a time. `scout_universe_set_state` prevents completed cold-baseline sets from becoming recurring scans.

The production database migration also installs triggers from `marketplace_scan_rows` and `scout_v5_shadow` into `scout_card_state`, so a genuine Scout evaluation completes any pending wake request. External Signals movement never contributes directly to the grade.

A printing with no live Marketplace/Direct listing can remain catalog-only. That is intentional: it is searchable/addressable without manufacturing a score from missing market evidence, and a future signal can wake its set for fresh evaluation.