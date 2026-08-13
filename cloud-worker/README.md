# Collectish Marketplace cloud worker

This is the first server-side executor for the shared `collector_jobs` queue.

## Current mode

Verification only. The worker claims only Marketplace jobs whose `preferred_executor` is one of:

- `cloud_worker`
- `server`
- `verification`

Normal mobile jobs currently target `browser_connector`, so this worker will not steal PC jobs during validation.

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

## GitHub Actions verification

The workflow `.github/workflows/marketplace-cloud-worker.yml` is manual-only during validation.

Add this repository Actions secret before running it:

`SUPABASE_SERVICE_ROLE_KEY`

Do not put the service-role key in source code, issues, logs, or the web/mobile app.

The Supabase project URL is public and is set directly in the workflow.

After the secret exists, queue a `marketplace / scan_set` job with `preferred_executor=verification`, then run **Collectish Marketplace cloud worker** from the repository Actions page. The workflow processes at most one job by default.

## Promotion plan

Do not enable a schedule yet. First compare a cloud verification scan against a PC scan of the same small set/profile. Check exact SKU IDs, row count, Direct Low, Direct Available, Marketplace listing count, sales enrichment, and Supply Structure v2 score. Once parity is acceptable, the cloud worker can become the preferred executor and the workflow can move to scheduled/always-on hosting.
