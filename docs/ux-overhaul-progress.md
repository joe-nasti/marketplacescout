# Collectish UX overhaul progress

This branch implements the approved Figma direction as one product system rather than a set of unrelated screen reskins.

## Foundation

- Dark / Light / System are first-class theme modes.
- Theme values are semantic tokens; screens do not own theme palettes.
- Browser/Android Back is the canonical navigation unwind mechanism.
- Native scrolling and system gestures win over custom gesture handlers.
- Desktop uses rail + work surface + inspector patterns.
- Mobile uses bottom navigation, compact work surfaces, and transient sheets/details.
- Global horizontal detail swipe navigation is retired.

## Migrated product language

### Scout
- Flat opportunity blotter replaces card-island styling.
- Saved views use text-rail navigation rather than pills.
- Inspector is a permanent desktop analysis pane and mobile transient sheet.
- Dense numeric hierarchy and restrained semantic signal markers.

### Signals
- Intelligence tape/list becomes the primary surface.
- Metrics are a flat strip, not standalone dashboard cards.
- View and filter navigation uses text rails.
- Signal, stage, and confidence markers are compact semantic labels.
- Feed cards collapse into a ruled evidence stream.
- Manual/source analysis remains available without visually dominating the workspace.

### Selling / SYP
- Selling tabs use the same text-rail grammar as Scout and Signals.
- Orders and SYP remain ledger/table-first experiences.
- Filters are compact operational controls rather than card containers.
- Event/status labels use compact semantic markers.

### Inventory
- KPI summary is a flat metric rail.
- Inventory results form a single ruled ledger/list rather than a grid of mini-cards.
- Selected inventory uses the shared selected-row treatment.
- Desktop detail becomes a sticky inspector separated by a hard rule.
- Mobile stacks list then detail without inventing a second product language.

## Still to finish before deployed checkpoint

- Apply the same cleanup to Admin/System surfaces.
- Review Sealed against the new Scout/ledger grammar.
- Normalize Ask Collectish overlays/sheets with the same transient-layer rules.
- Add/extend browser regression coverage for representative desktop and mobile states.
- Run CI/build checks and address any cascade regressions before the first deployed test checkpoint.
