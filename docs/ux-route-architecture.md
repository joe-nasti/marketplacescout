# Collectish UX route architecture

Baseline introduced with web `0.10.0`.

## Product hierarchy

The primary product model is intentionally smaller than the implementation route list.

| Product group | Routes | User job |
| --- | --- | --- |
| Scout | `scout`, `sealed` | Find opportunities worth attention |
| Signals | `signals` | Understand market changes and evidence |
| Selling | `seller`, `syp`, `inventory` | Manage sales, eligibility, and inventory |
| System | `admin` | Operate and diagnose the platform |

Route IDs remain stable for deep links and existing feature integrations. The shell owns how those routes are grouped and presented.

## One route owner

Every route must have one module that owns first paint and the durable structure of the screen.

A route owner may call shared helpers and render shared primitives, but secondary modules must not become competing renderers for the same surface.

Examples:

- Selling overview: `seller/orders.js` owns core state/data rendering; `dashboard-vnext.js` owns the action-first overview surface.
- SYP: `seller/syp-feed.js` owns first paint and feed interaction.
- Scout: the promoted Scout renderer remains the first-paint owner while its remaining DOM adoption layers are consolidated in follow-up work.

## Critical render path

Opening a route should require only what is necessary to make the route understandable and usable.

Critical modules:

1. render the page frame,
2. load the minimum useful dataset,
3. expose primary navigation and actions,
4. report route readiness.

Everything else is an enhancer.

Enhancers should be scheduled after first paint or on user intent. They may add evidence, formatting, drilldowns, or secondary workflows. They must not block route navigation.

## Progressive enhancement rules

Enhancers may:

- decorate content already owned by the route,
- attach non-blocking evidence,
- add optional drilldowns or actions,
- hydrate secondary metrics,
- improve density or responsive presentation.

Enhancers must not:

- replace the route's primary renderer,
- re-parent large regions of route DOM as a normal composition strategy,
- require repeated timeout passes to reach a stable structure,
- make correctness depend on module arrival order,
- hide a route until unrelated data is loaded.

If an enhancer repeatedly rearranges the route, its behavior belongs in the route owner.

## Data loading contract

Use `state/resources.js` for reusable datasets when possible. Prefer:

- persistent cache for durable read-heavy data,
- stale-while-revalidate for fast revisits,
- independent section hydration over page-wide blocking,
- request deduplication through named resources,
- detail-only loads for expensive evidence.

Lazy loading is for routes, expensive datasets, and optional workflows. UI correctness must not be lazy.

## Navigation contract

Desktop navigation may expose nested routes inside a product group. Mobile navigation exposes product groups first and uses the route-context strip for nested routes.

Switching groups remembers the most recently used route in that group for the current session. Direct route URLs still open the exact requested route.

Ask Collectish is a global capability and should remain context-aware rather than becoming another primary destination.

## Migration rule

When a new owner replaces an adoption layer, delete the obsolete layer in the same migration whenever practical. Avoid permanent `v2`/`v3` parallel implementations.

A consolidation change is successful when route ownership becomes clearer and lifecycle complexity decreases, not merely when another abstraction is added.
