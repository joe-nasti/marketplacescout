# Generic read-only Android probe

## Goal

Make native Android installs exceptional rather than part of normal collector iteration.

The Android app exposes one constrained executor. Hosted Collectish JavaScript and Supabase jobs describe *what* read-only target to inspect, while native code enforces *where* and *how* it may execute.

## Safety boundary

Remote jobs may provide only structured data:

- `mode`: `navigate_capture`, `fetch_json`, or `fetch_text`
- `url`: HTTPS URL on the native TCGplayer allowlist
- `method`: GET, or POST only for explicitly allowlisted read-only endpoints
- `body`: bounded JSON only when an allowlisted read-only POST requires it
- `waitMs`: bounded delay before navigation capture

Remote jobs may not provide:

- JavaScript source
- arbitrary methods or mutation endpoints
- arbitrary headers, authorization values, or credentials
- arbitrary hosts
- unbounded request or response bodies

Native code caps returned DOM/body/network data and rejects requests outside the allowlist.

## Initial allowlist

- `sellerportal.tcgplayer.com`
- `store.tcgplayer.com`
- `order-management-api.tcgplayer.com`
- `sp-api.tcgplayer.com`
- `seller-settings-api.tcgplayer.com`

GET access is path-restricted. POST is restricted to the two Seller History extension operations already established as read-only:

- `/orders/search`
- `/orders/export`

No write/mutation Seller Portal actions are permitted.

## First production target

The v0.1.9 Orders reconnaissance reached the authenticated current Seller Portal `/orders` route and exposed these resources:

- `https://order-management-api.tcgplayer.com/orders/search?api-version=2.0`
- `https://order-management-api.tcgplayer.com/orders/actionable-count?api-version=2.0`
- `https://order-management-api.tcgplayer.com/products/lines?api-version=2.0`
- `https://sp-api.tcgplayer.com/Account/auth-detail?api-version=1.0`

The prior Seller History extension establishes that Orders search is an authenticated read-only POST using the normal Seller Portal browser session. v0.1.10 therefore supports that request shape without exposing arbitrary POST capability.

## Native bridge contract

- `startReadOnlyProbe(configJson)`
- `getReadOnlyProbeState()`
- `getReadOnlyProbeResult()`

The existing Orders-specific bridge remains available as a compatibility canary until the generic executor proves reliable.

## Remote iteration loop

1. Hosted Collectish code queues a structured probe recipe.
2. Android validates the recipe against native host/path/method policy.
3. Android executes the request inside the authenticated Seller Portal WebView session.
4. The bounded result is stored in the collector job.
5. Assertions verify host, HTTP status, response shape, and expected fields.
6. Parsers/normalizers can then be updated remotely.
7. Repeat without another APK install.

A new APK is required only when the native security/capability boundary itself must change.

## v0.1.10 milestone

v0.1.10 is the first strategic generic-executor build. Its immediate validation sequence is:

1. authenticated `auth-detail` GET
2. authenticated `/orders/search` read-only POST using the known Seller History request body
3. authenticated order-detail GET for one returned order

If those pass, subsequent Seller History discovery and parser iteration should no longer require an APK per endpoint.
