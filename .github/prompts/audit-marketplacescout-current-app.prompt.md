# Audit MarketplaceScout current app with Chrome DevTools MCP

Use Chrome DevTools MCP against the current MarketplaceScout app. Focus on the app itself; do not investigate external storefronts in this task.

## Goals

1. Measure startup and Scout performance bottlenecks.
2. Run regression checks across desktop and mobile viewports.
3. Inspect mobile layout and interaction quality.
4. Test session/auth behavior under success and failure scenarios.
5. Find other concrete reliability, accessibility, caching, rendering, and network improvements.

## Performance pass

- Test a cold load and a warm/repeat load.
- Record TTFB, FCP, LCP, DOMContentLoaded, load, CLS, long tasks, transfer size, request count, and Scout-ready timing when available.
- Inspect the network waterfall for blocking/sequential requests, duplicate requests, cache misses, oversized responses, failed requests, and slow Supabase calls.
- Inspect performance traces for scripting/render/layout hotspots and expensive handlers.
- Compare browser findings with `window.CollectishRuntimeHealthCard?.get?.()`.
- Identify the top bottlenecks by user-visible impact, not merely by request duration.

## Regression pass

Run the main user paths available to the test account:

- startup/login shell
- Scout load, filters, card detail, navigation state/deep links
- Signals
- Sealed
- Seller
- SYP
- Inventory
- Admin/system health
- theme switching
- browser back/forward navigation
- reload on a non-default tab

Look for console errors, unhandled promises, failed requests, duplicate renders, broken controls, stale state, URL/state disagreement, and visual regressions.

## Mobile pass

Test at minimum:

- 393x852 (Pixel-class)
- 360x800 (narrow Android)
- one landscape mobile viewport

Check:

- no horizontal page overflow
- bottom navigation stays one row and all seven destinations remain reachable
- safe-area/system-bar spacing
- 44px minimum primary touch targets
- filters and cards fit without clipped text or controls
- dialogs/detail views remain dismissible
- virtual keyboard does not hide the active auth/filter control where observable
- sticky/fixed controls do not cover content
- tables/cards preserve useful information hierarchy

Make targeted CSS/layout fixes when evidence supports them; avoid broad redesigns without a measured problem.

## Session/auth pass

Exercise and inspect:

- no saved session
- valid saved session
- expired access token + successful refresh
- expired access token + rotated refresh token
- transient refresh 5xx/network failure (saved refresh state must survive for retry)
- rejected/expired refresh token (saved session must be cleared)
- 401 on a protected REST call followed by refresh/retry
- sign out
- reload after sign out
- concurrent protected requests during token refresh (only one refresh should be in flight)

Never log or commit real credentials or tokens. Redact secrets from screenshots/traces/notes.

## Other app-health checks

Inspect for:

- unnecessary module or data loading before the active page needs it
- large or repeated Scryfall/image fetches and ineffective caches
- long-lived event listeners or lifecycle leaks
- accessibility issues visible in DevTools (labels, focus, contrast, keyboard path)
- layout shifts caused by images or async content
- offline/poor-network behavior
- stale-service-worker/PWA behavior if applicable
- failed resource recovery
- opportunities to reduce DOM size or work on mobile

## Output / implementation rule

For every finding, provide evidence (trace/network/console/DOM observation), user impact, and proposed fix. Implement small high-confidence fixes directly with regression coverage. For larger changes, create a clearly scoped follow-up rather than mixing unrelated redesign work into the audit.

After changes, rerun the affected scenario and report before/after measurements where measurable.
