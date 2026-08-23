# Marketplace source discovery with Chrome DevTools MCP

MarketplaceScout uses Chrome DevTools MCP as a development and validation tool for storefront integrations. It is intentionally not part of the production scraping/runtime path.

## Goals

Use a live Chrome session to discover the cheapest reliable way to retrieve marketplace inventory, then turn that discovery into a deterministic source adapter and regression tests.

Prefer source mechanisms in this order:

1. Public/documented API
2. Stable JSON/XHR/GraphQL requests used by the storefront itself
3. Server-rendered HTML
4. Browser automation as a last resort

## Setup

The repository includes `.mcp.json` with the `chrome-devtools` server and an npm helper:

```bash
npm run mcp:chrome
```

The MCP client still controls whether repository-local MCP configuration is loaded. If the client does not read `.mcp.json`, register the same server manually using:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["chrome-devtools-mcp@latest"]
    }
  }
}
```

## Source-discovery workflow

For a candidate storefront:

1. Open the storefront and identify its platform and search/catalog entry points.
2. Filter to Magic: The Gathering and in-stock products where possible.
3. Inspect network traffic while searching, filtering, paginating, opening a product, and changing variants.
4. Identify requests that carry product identity, set/printing, condition, finish, language, price, quantity/availability, pagination, and canonical URLs.
5. Determine whether the request can be reproduced without browser state. Record required headers, cookies, tokens, pagination parameters, rate limits, and cache behavior.
6. Prefer the smallest stable request surface. Do not scrape rendered DOM when a reliable structured payload exists.
7. Build a MarketplaceScout adapter that normalizes results into the existing card/source model.
8. Capture a small redacted fixture from the structured response where licensing/terms permit.
9. Validate adapter output against the visible storefront for several products and variants.
10. Add failure diagnostics for schema changes, empty inventories, pagination drift, and unexpected authentication/challenge pages.

## Discovery report

Every investigated source should produce a short report containing:

- Store name and base URL
- Platform/vendor
- Recommended extraction mode: `api`, `xhr`, `graphql`, `html`, or `browser`
- Endpoint/request pattern
- Pagination strategy
- Product/variant identity fields
- Price and quantity fields
- Condition/finish/language mapping
- Required session state
- Rate-limit or anti-bot observations
- Confidence: `high`, `medium`, or `low`
- Known failure modes
- Validation sample and date

Do not commit session cookies, authorization headers, customer data, HAR files containing secrets, or retailer credentials.

## Agent prompt

A reusable prompt is checked in at `.github/prompts/discover-marketplace-source.prompt.md`.

Start with TCGplayerPro storefronts because MarketplaceScout already has a concrete catalog use case and we can compare extracted inventory directly with storefront listings.
