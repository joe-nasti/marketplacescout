# Collectish navigation and gesture contract

This is the canonical interaction contract for desktop web, mobile web/PWA, and the Android wrapper during the UX overhaul.

## Principles

1. **Native system navigation wins.** Android edge-back, browser Back/Forward, home gestures, browser overscroll, and platform accessibility behaviors must not be shadowed by app-wide gesture handlers.
2. **One navigation model everywhere.** Route, selected detail, transient layer, and scroll position are one ordered state model. Desktop and mobile render that state differently but unwind it in the same order.
3. **Visible affordances before hidden gestures.** Gestures may accelerate an action, but every essential action must also have an obvious tap/click control.
4. **No global swipe navigation.** Horizontal page swipes are reserved for local content such as carousels and overflow regions. They must not switch major app tabs.
5. **History is meaningful.** Browser/Android Back reverses the most recent user-visible navigation step instead of jumping to Scout or leaving unexpectedly.

## Information architecture

Primary destinations:

- Scout
  - Singles
  - Sealed
- Signals
- Selling
  - Overview
  - SYP
  - Inventory
- System / More
  - Admin and utility controls

Desktop uses the left rail plus contextual child-route tabs. Mobile uses bottom navigation for primary destinations and an in-context child-route control. Each primary destination remembers the last child route used during the session.

## Back priority

Back must unwind in this order:

1. Close the top transient layer: menu, popover, filter sheet, dialog, utility drawer.
2. Reduce an expanded mobile inspector/bottom sheet one step when appropriate.
3. Close the selected detail/inspector and restore the source list position.
4. Return to the previous child route or primary destination through browser/Android history.
5. If no app history remains, allow the browser/OS to leave naturally.

Never hijack Android Back to force the user to Scout. Never swallow browser Back unless a visible transient UI layer is actually being dismissed.

## Detail behavior

### Desktop

- Selecting a card/article/list item keeps the source list mounted and updates the right inspector.
- A shareable selection should be URL/history aware.
- Browser Back clears the selection before leaving the route.
- Closing detail preserves the exact list scroll position.
- `Esc` may close a dismissible inspector/overlay when focus is not inside a text editor.

### Mobile / Android

- Detail opens as a bottom sheet with defined stages: peek/medium/expanded as the experience requires.
- Vertical dragging is allowed only on the sheet or its explicit drag region.
- Android Back unwinds sheet state before route navigation.
- No custom horizontal edge-swipe is implemented; Android owns that gesture.

## Gesture policy

Allowed:

- Vertical drag on an explicitly draggable bottom sheet.
- Swipe within a media carousel when the gesture begins inside that carousel.
- Horizontal pan inside a table or chart overflow container.
- Utility shelf reveal from an explicit handle/safe region when it does not conflict with system gestures.

Avoid/remove:

- Page-level left/right swipe to change tabs.
- Duplicate pointer + touch gesture listeners for the same behavior.
- Repeated `scrollTo` calls while a touch/pointer gesture is active.
- Edge hit zones that compete with Android predictive/system Back.
- Hidden gestures with no visible affordance.

## Scroll behavior

- Each major route owns its last meaningful scroll position.
- Opening/closing detail never loses the list position.
- Route switches may reset to the designed route origin only when explicitly intended.
- Mobile utility-shelf snap may occur only after interaction has ended and only when the shelf is partially revealed.
- Pull-to-refresh and platform overscroll must not be broken by page-level gesture interception.

## Android integration

- WebView and web UI share the same route/history state; do not create a parallel native navigation stack for web destinations.
- Native Back / predictive Back should first allow the web app to consume a visible transient/detail state, then fall through to WebView/browser history, then OS navigation.
- Respect display cutouts, status bar, gesture-navigation inset, and bottom safe area.
- Light/Dark/System theme should also update Android system-bar appearance.

## History semantics

- Primary or child-route navigation: push history.
- Opening a shareable detail: push reversible history state.
- Closing detail via Back: pop history.
- Ephemeral filter/sort changes: replace history unless the state is intentionally shareable.
- Reload/deep link: restore the same route and supported selected-detail state.

## Test matrix

Validate every primary route and representative detail flow on:

- Desktop Chrome: mouse + keyboard + trackpad Back/Forward.
- Android Chrome/PWA: gesture navigation and 3-button navigation where available.
- Collectish Android wrapper: system Back, predictive Back, home gesture, cutout/safe-area layout.
- Narrow landscape mobile.

For each route test: enter, select detail, expand/collapse detail, open/close filter sheet, Back repeatedly, Forward where supported, switch primary destination, return, and confirm scroll/state restoration.
