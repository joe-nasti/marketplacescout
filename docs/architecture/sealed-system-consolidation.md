# Sealed and System route ownership

This checkpoint completes the single-route-owner consolidation for the remaining primary surfaces.

## Sealed
- `src/modules/sealed/renderer.js` owns first useful paint, filters, list rows, selection, and detail.
- Supporting Sealed modules may enrich detail, links, CardTrader context, mobile economics, or URL state.
- Supporting modules must not rewrite list-row structure after `collectish:sealed-rendered`.

## System / Admin
- `src/modules/admin/console.js` is the structural owner for Overview, Singles, Sealed, and System sections.
- The Admin console is established before alerts, health, catalog, scan, or runtime diagnostic modules mount.
- Generic lazy placeholders are disposable loading state and must never be adopted into the final Admin System panel.

## Loading rule
A route may progressively load datasets and evidence, but late modules must not reorganize the critical first-paint structure.
