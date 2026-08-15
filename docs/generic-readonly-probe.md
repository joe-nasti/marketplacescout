# Generic read-only Android probe

## Goal

Make native Android installs exceptional rather than part of normal collector iteration.

The Android app should expose one constrained executor. Hosted Collectish JavaScript and Supabase jobs should describe *what* read-only target to inspect, while native code enforces *where* and *how* it may execute.

## Safety boundary

Remote jobs may provide only structured data:

- `mode`: `navigate_capture` or `fetch_get`
- `url`: HTTPS URL on the native TCGplayer allowlist
- `waitMs`: bounded delay before capture

Remote jobs may not provide:

- JavaScript source
- request bodies
- POST/PUT/PATCH/DELETE methods
- arbitrary headers or credentials
- arbitrary hosts

Native code must cap returned DOM/body/network metadata.

## Initial allowlist

- `sellerportal.tcgplayer.com`
- `store.tcgplayer.com`
- `order-management-api.tcgplayer.com`
- `sp-api.tcgplayer.com`
- `seller-settings-api.tcgplayer.com`

## First production target

The v0.1.9 Orders reconnaissance found the current Seller Portal route `/orders` and these important resources:

- `https://order-management-api.tcgplayer.com/orders/search?api-version=2.0`
- `https://order-management-api.tcgplayer.com/orders/actionable-count?api-version=2.0`
- `https://order-management-api.tcgplayer.com/products/lines?api-version=2.0`

The generic executor should first be used to determine the read-only request semantics and response shape for Orders search, then order details/items, pagination, and historical date windows.

## Native bridge contract

Proposed methods:

- `startReadOnlyProbe(configJson)`
- `getReadOnlyProbeState()`
- `getReadOnlyProbeResult()`

The existing Orders-specific bridge remains available as a compatibility canary until the generic executor proves reliable.

## Network metadata

For navigations, the native WebView client should record a bounded list of requests to allowlisted hosts with:

- URL
- HTTP method
- request header names only, never values

This reveals whether an observed Seller Portal endpoint uses GET or a read-only POST search without exposing authorization tokens. If a necessary read-only Seller Portal query uses POST, add it later as a separately reviewed native capability rather than allowing generic POST.

## Remote iteration loop

1. Hosted Collectish code queues a structured probe recipe.
2. Android validates the recipe against native policy.
3. Android executes and stores a bounded result in the collector job.
4. Assertions verify host, status, shape, and expected fields.
5. Parsers/normalizers are updated remotely.
6. Repeat without another APK install.

A new APK is required only when the native security/capability boundary itself must change.
