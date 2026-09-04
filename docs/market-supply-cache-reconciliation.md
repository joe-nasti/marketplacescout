# Market supply cache reconciliation

Unqualified card-name stock/supply questions resolve the Oracle-wide English NM + LP SKU family on demand without materializing LP rows into the normal Scout catalog.

`market-supply-sync` applies a 30-minute read-through cache to both TCGplayer exact-SKU marketplace snapshots and ManaPool exact retail depth. Cache misses refresh only the affected TCGplayer products, with one product listings fetch reused across all NM/LP SKUs for that product.

Fresh TCGplayer snapshots store exact seller keys in metadata so cached family responses can deduplicate seller identities across SKUs. Older cached snapshots without seller keys use a conservative seller lower bound rather than summing seller counts and overstating unique supply.

ManaPool remains exact-SKU and on-demand only. Family questions probe only the resolved NM/LP targets and never batch-scan unrelated Card Kingdom buylist rows.
