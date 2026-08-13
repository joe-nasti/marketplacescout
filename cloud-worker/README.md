# Collectish Marketplace cloud worker

This is the server-side executor for the shared `collector_jobs` queue.

## Current mode

Cloud-primary Marketplace execution with PC fallback.

The worker claims Marketplace jobs whose `preferred_executor` is one of:

- `cloud_worker`
- `server`
- `verification`

Normal mobile Marketplace scans now target `cloud_worker`. If a cloud-targeted scan reaches `failed`, the fallback step requeues the same profile as a new `browser_connector` job so Marketplace Scout PC can finish it.

## What it reproduces

The worker mirrors the Marketplace Scout PC pipeline using the same public TCGplayer endpoints and exact-SKU semantics:

1. Direct Marketplace search (Normal/Foil remain distinct)
2. Total Marketplace competition pass
3. SKU market/low pricepoints
4. Direct quantity-at-price enrichment
5. Optional quarterly sales-history enrichment
6. Supply Structure v2 scoring
7. Save to `marketplace_scans` + `marketplace_scan_rows`
8. Durable status/progress in `collector_jobs` + `collector_job_events`

No TCGplayer cookie or seller-session credential is used by this worker.

## GitHub Actions

The workflow `.github/workflows/marketplace-cloud-worker.yml` runs about every 5 minutes and can also be run manually.

Required Actions secret:

`SUPABASE_SERVICE_ROLE_KEY`

Do not put the service-role key in source code, issues, logs, or the web/mobile app.

The workflow processes up to two cloud-targeted jobs per cycle by default, then checks failed cloud work for PC fallback and continues the linked PC/cloud parity verification path.

## Verification

Paired verification remains available. It queues the same profile to `browser_connector` and `verification`, links the two jobs with a shared pair ID, and compares exact SKU coverage, prices, inventory, listings, sales velocity, scores, and flags.
