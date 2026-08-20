# Collectish Marketplace cloud worker

This directory contains the server-side workers for Collectish cloud pipelines and the shared `collector_jobs` queue.

## Marketplace execution

Marketplace scanning is cloud-primary and cloud-only. Normal Marketplace jobs target `preferred_executor=cloud_worker` with `required_capability=marketplace_public_api`.

The canonical Marketplace worker uses public TCGplayer Marketplace endpoints and Supabase REST. It does not require a TCGplayer seller session, browser connector, PC agent, or runtime source patching.

Transient Marketplace failures remain in the cloud recovery path. Recovery may defer and recreate bounded cloud jobs, but it does not fall back to a browser or PC executor.

## Marketplace scan pipeline

The current worker performs:

1. Exact set-filtered Marketplace search, keeping Normal and Foil distinct
2. Marketplace competition/listing-count enrichment
3. SKU market/low pricepoints
4. Direct quantity-at-price enrichment
5. Optional quarterly sales-history enrichment
6. Supply-structure opportunity metrics
7. Persistence to `marketplace_scans` and `marketplace_scan_rows`
8. Durable status/progress in `collector_jobs` and `collector_job_events`
9. Scryfall metadata enrichment and promoted Scout v5 ranking refresh in the workflow

A set-filter guard rejects suspicious responses above 10,000 positions rather than silently ingesting an unfiltered result set.

## Seller History and authenticated work

Authenticated TCGplayer Seller History and SYP reads are not executed by the Marketplace cloud worker. Those jobs are explicitly routed to the authenticated Collectish Android agent using `required_capability=tcgplayer_authenticated_session`.

The cloud Seller History orchestrator only coordinates, validates, normalizes, and persists those read-only Android results.

## GitHub Actions

`.github/workflows/marketplace-cloud-worker.yml` runs on a schedule and can be run manually. Production-mutating push triggers are restricted to `main`.

The Marketplace workflow drains already-valid queued cloud jobs before scheduler/recovery maintenance so bookkeeping failures cannot starve useful work. It then admits/recoveries configured work and performs another worker pass.

Required Actions secret:

`SUPABASE_SERVICE_ROLE_KEY`

Do not put the service-role key in source code, issues, logs, or the web/mobile app.

## Deprecated architecture

Browser-agent Marketplace execution, PC fallback, linked PC/cloud parity runs, runtime patch scripts, and older Scout v3/v4 scoring entry points are not part of the current production architecture. They should not be used as recovery paths for current Collectish jobs.
