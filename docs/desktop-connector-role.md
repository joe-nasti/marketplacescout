# Collectish desktop connector role

Collectish is cloud-first. The desktop Chrome extension is an authenticated/session agent and fallback executor, not a second application or the primary Marketplace scanner.

## Cloud-owned responsibilities

These should execute or render in Collectish Cloud and should not require the desktop extension for normal operation:

- Marketplace set scans using public Marketplace/search/pricepoint/Direct-quantity/sales-history endpoints.
- Exact-SKU normalization, scoring, HOT/WATCH classification, history, trend analysis, and cross-scan analytics.
- Scout, Cards, Sales, Direct, Money, Trends, Operations, and job/history UI.
- Durable job creation, job history, retries, cloud execution, and result persistence.
- Scryfall/other independent public metadata enrichment.

## Browser-owned responsibilities

Keep these in a browser agent because they depend on a signed-in TCGplayer session, private pages, or browser context:

- Seller Portal/private account collection.
- Session-only exports and APIs that cannot be called server-side without the user's authenticated browser.
- Any collector whose source explicitly requires cookies/session state; raw cookies are never uploaded to Collectish Cloud.
- Optional current-page context detection when a user is actively browsing TCGplayer.

## Browser fallback responsibilities

Marketplace scanning may run in the browser only when:

- a cloud Marketplace job explicitly fails and fallback is created; or
- a job explicitly requests `preferred_executor=browser_connector`.

The connector should not claim ordinary `cloud_worker` jobs and should not pollute normal cloud execution history with duplicate scans.

## UI responsibilities to retire from the extension

The desktop extension no longer needs to own:

- primary dashboard/history views;
- scan profile management as a separate local product;
- Marketplace analytics/charts/tables that already exist in the web app;
- routine manual "Run on PC" controls;
- local copies of canonical cloud scan history except what is necessary for active execution/recovery.

## Minimal target extension

The long-term extension UI should be limited to:

1. Collectish sign-in/session bridge status.
2. Connector online/offline + capability advertisement.
3. Auth-required collector status.
4. Active claimed job progress and errors.
5. Manual "check jobs now" / reconnect controls.
6. Optional lightweight TCGplayer page helper when useful.

All durable data and product-facing UI remain in Collectish Cloud.
