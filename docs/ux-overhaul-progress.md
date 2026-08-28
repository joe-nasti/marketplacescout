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

### Sealed
- Sealed now follows the same list + inspector grammar as Scout rather than a separate card-grid language.
- Product rows are flattened into a ruled work surface with restrained selected state.
- Buylist / Direct / risk badges use the same compact semantic markers as Singles.
- Economics remain table-first and dense.
- Mobile detail is treated as a transient bottom sheet rather than a full-screen bespoke navigation mode.

### Admin / System
- Admin tabs are text rails rather than pills.
- Health and source status are compact semantic labels.
- Summary metrics form a flat status strip.
- Source and catalog rows use ruled operational surfaces.
- Admin remains intentionally denser than end-user Scout, but uses the same shell, type, rules, and theme tokens.

### Ask Collectish
- Ask is treated as a utility inspector, not a floating consumer-chat experience.
- Desktop panel docks hard to the right edge and shares the app's pane geometry.
- Starter prompts are flattened into a text rail.
- Messages, rich response surfaces, action cards, and compose controls use restrained geometry.
- Mobile remains full-height when invoked, with safe-area handling and the same theme system.

## Still to finish before deployed checkpoint

- Extend representative browser regression coverage across Scout, Signals, Sealed, Selling, Inventory, Admin and Ask in both desktop and mobile viewports.
- Review cascade conflicts caused by older domain CSS overriding the new workbench layers.
- Run build / hygiene / style checks and fix any failures.
- Validate navigation unwind behavior for transient layers after the visual migration.
- Then deploy the first coherent checkpoint for real PC + Android testing.
