# Scout payload split

Scout cold startup now uses a lightweight ranked-list payload. The full `scout_opportunities_v5` row is fetched only for the selected card detail and cached in memory for the session.

## Contracts

- Ranking order and grades are unchanged.
- Search, set, grade, liquidity, signal matching, and list-image metadata remain available locally.
- The 500-row list request does not use `select=*`.
- Detail uses a single-row full fetch, preferring the promoted cache and falling back to the live view.
- Warm IndexedDB persistence stores the lightweight list payload.
- List images are owned by the viewport-based TCGplayer CDN loader; the renderer does not launch a parallel Scryfall image burst.
- Detail failures leave the list usable.

Browser regression tests enforce the list/detail request shape and warm-cache behavior.
