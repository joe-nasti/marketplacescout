# Card Kingdom and Mana Pool depth contract

Validated September 2–3, 2026 against Card Kingdom's complete v2 price list and Mana Pool API v1 schema 0.32.0.

## Card Kingdom

Source: `https://api.cardkingdom.com/api/v2/pricelist`

- `id` is the source product/listing identifier; `sku` is retained as a second source identifier.
- `scryfall_id` is the cross-source exact-printing identifier. Collectish resolves it to `mtgjson_uuid` when possible and retains both.
- `condition_values.{nm,ex,vg,g}_qty` is retail-owned inventory for that condition. In the full validation feed, the four values summed to `qty_retail` for 150,303 of 150,303 rows.
- `condition_values.{nm,ex,vg,g}_price` is the matching condition-specific retail price.
- `price_buy` and `qty_buying` are the cash bid and remaining copies Card Kingdom will accept for that printing/finish. The feed does not expose a condition breakdown for buylist demand.
- A price with quantity zero is non-executable. MTGJSON price-only data must not override this fact.
- `meta.created_at` has no UTC offset. Store it verbatim in `source_as_of_raw`; `observed_at` is Collectish's UTC fetch time. Do not silently reinterpret the source timestamp as UTC.

## Mana Pool

Sources:

- `GET /api/v1/products/singles`: exact MTGJSON-printing lookup with variant `product_id`, TCGplayer SKU when known, language, condition, finish, low price, total available quantity, and response `meta.as_of`.
- `POST /api/v1/buyer/optimizer`: authenticated selection of inventory IDs for a requested exact printing/variant.
- `GET /api/v1/inventory/listings`: authenticated price and available quantity for the selected inventory IDs.

Public variant totals are labeled `aggregate`. “Listings/copies at or below CK buylist” is derived from optimizer-selected inventory and labeled `optimizer_derived`; it is `capped` when the requested quantity cap is filled. It is not described as a guaranteed exhaustive order book.

## TCGplayer extension

The same observation contract can accept exact-SKU listing count and quantity from unofficial endpoints. That adapter should remain targeted, cached, rate-limited, and explicitly marked unofficial. Failure must degrade to unknown rather than changing CK or Mana Pool evidence.

## Retention

`vendor_depth_current` is overwritten in place. A trigger writes `vendor_depth_events` only when the material value hash changes, so unchanged daily polls do not grow history. Every event links to `vendor_depth_runs`, retaining Collectish observation time, raw source time, endpoint, payload hash, schema version, and run status.

