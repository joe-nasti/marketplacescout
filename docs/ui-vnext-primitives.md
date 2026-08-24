# vNext UI primitives

Shared presentation contract for dense decision surfaces.

## Shared shell primitives

Use these only for repeated shell patterns. Domain-specific row anatomy remains in each feature module.

- `.cx-ui-tabs` — compact horizontally scrollable view/tab selector.
- `.cx-ui-metrics` — responsive metric strip container.
- `.cx-ui-metric` — individual metric tile with label/value/subtext.
- `.cx-ui-list` — bordered dense-list container.
- `.cx-ui-status` — semantic status pill. Combine with one of `.success`, `.accent`, `.warning`, `.danger`, `.muted`.

These classes are theme-token driven and should not contain domain-specific colors, labels, or business logic.
