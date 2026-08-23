# Discover a MarketplaceScout source

Investigate the supplied storefront with Chrome DevTools MCP and determine the most efficient, reliable, and maintainable way for MarketplaceScout to retrieve its in-stock Magic: The Gathering inventory.

## Inputs

- Storefront URL: `<URL>`
- Store/source name: `<NAME>`

## Instructions

1. Open the storefront in Chrome.
2. Identify the ecommerce/storefront platform if possible.
3. Navigate the Magic: The Gathering catalog and exercise search, filters, pagination/infinite scroll, product detail, and variant selection.
4. Inspect network activity during those actions.
5. Prefer structured data sources over DOM scraping in this order:
   - documented/public API
   - JSON/XHR/GraphQL requests used by the storefront
   - server-rendered HTML
   - browser automation only when necessary
6. Determine how to retrieve all currently available MTG inventory and map, where available:
   - store product/listing ID
   - card/product name
   - set/printing
   - collector number or other printing identifier
   - condition
   - foil/nonfoil or finish
   - language
   - price
   - quantity or availability
   - product URL
   - pagination/cursor data
7. Identify required headers, cookies, tokens, session state, and request parameters. Never expose or commit credentials, authorization values, customer information, or sensitive cookies.
8. Determine whether the structured request can be reproduced directly outside the browser. Prefer this for the production adapter.
9. Check for rate limits, bot/challenge behavior, caching, unstable request identifiers, and other likely failure modes.
10. Compare a sample of extracted records to the visible storefront to verify variant, price, and availability accuracy.
11. Review the existing MarketplaceScout source/normalization architecture before writing code. Reuse existing abstractions and naming conventions rather than creating a parallel framework.
12. Implement or propose the smallest source adapter necessary, with clear diagnostics for schema changes and incomplete crawls.
13. Add representative tests/fixtures where legally and technically appropriate. Redact any session-specific or sensitive values.

## Required output

Produce a concise discovery report with:

- Platform
- Recommended extraction mode (`api`, `xhr`, `graphql`, `html`, or `browser`)
- Request/endpoint pattern
- Pagination strategy
- Field mapping
- Session/auth requirements
- Rate-limit/anti-bot observations
- Known failure modes
- Confidence (`high`, `medium`, or `low`)
- Validation results
- Recommended MarketplaceScout implementation

If a direct structured request is available, do not choose full browser automation merely because Chrome DevTools MCP was used to discover it.
