# Generic read-only Android probe executor

Goal: make one strategic native Android install unlock many Seller Portal iterations without shipping a new APK for every selector, route, or parser change.

## Split responsibilities

### Native Android bridge (rarely changes)

Expose a small, constrained interface only:

- `startReadOnlyProbe(configJson)`
- `getReadOnlyProbeState()`
- `getReadOnlyProbeSnapshot()`
- `getVersion()` / session health / collector ID

The native bridge must reject any config that violates the safety contract below.

### Remote Collectish agent (`current-agent.js`, changes without APK install)

Own all frequently changing behavior:

- collector job types and queueing
- probe recipes
- route selection
- timeout/retry policy
- assertions and PASS/FAIL decisions
- parsing/normalization into Supabase
- Operations UI and diagnostics

Because the Android app loads the hosted Collectish web app, these changes can ship through GitHub Pages without reinstalling Android.

## Probe safety contract

A probe config is declarative JSON, never executable JavaScript.

Allowed operations:

1. navigate with HTTPS GET to an allowlisted TCGplayer host
2. wait for document load / bounded delay
3. capture generic DOM metadata
4. capture Performance Resource Timing URLs
5. optionally perform an authenticated GET through the existing WebView context when the target host is allowlisted
6. return bounded JSON

Disallowed:

- POST/PUT/PATCH/DELETE
- form submission
- button clicks that mutate seller state
- arbitrary JavaScript from Supabase/GitHub/job payloads
- navigation outside allowlisted TCGplayer domains
- unbounded response/body capture

Initial host allowlist:

- `sellerportal.tcgplayer.com`
- `store.tcgplayer.com`
- other TCGplayer-owned API hosts only after observed from authenticated captures and explicitly added in native code

## Generic capture payload

Each probe should return:

- final URL, host, path, title
- authentication/login indicators
- tables: headers + bounded rows
- ARIA grids: bounded rows/cells
- links: text + href
- buttons: text only
- forms: action/method/control names, but never passwords and never non-hidden field values
- Performance Resource Timing URLs
- bounded body text
- timestamps
- counts

## Remote assertions

`current-agent.js` evaluates probe results with declarative assertions, e.g.:

```json
{
  "expect": {
    "hostIn": ["store.tcgplayer.com"],
    "pathContains": "/admin/orders/",
    "notLoginPage": true,
    "minimumUsefulSignals": 1
  }
}
```

A useful signal can be a table row, grid row, matching resource URL, or matching domain link.

Failures are recorded as structured assertion failures rather than requiring visual inspection.

## Iteration loop after one native install

1. Change remote probe recipe in `current-agent.js` or queue a declarative probe job in Supabase.
2. Android claims the job using the stable native bridge.
3. Native executor validates the config against its allowlist and read-only rules.
4. Probe executes in the authenticated Seller Portal WebView.
5. Snapshot is stored in `collector_jobs` / `collector_job_events` / `source_captures`.
6. Remote assertions classify PASS/FAIL.
7. Parser/normalizer changes are tested against stored fixtures in GitHub Actions.
8. Repeat without APK installation.

A new APK should be required only when the native safety boundary itself needs a new capability or new allowlisted host.

## Background execution

Separate concern from install churn. The current app heartbeat depends on the Activity/WebView being active. Do not couple this to the generic executor initially.

Preferred progression:

1. First eliminate APK-per-probe iteration with the generic executor.
2. Then add an Android foreground worker/background strategy for queued jobs.
3. Keep actual TCGplayer mutation operations out of the background worker; the worker remains read-only.

This ordering reduces risk and gives immediate iteration leverage even if the user still needs to open the app occasionally.
