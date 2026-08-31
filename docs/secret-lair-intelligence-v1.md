# Secret Lair Intelligence V1

## Goal

Treat Secret Lair releases as first-class market-intelligence events that combine collector appeal, card economics, supply mechanics, community sentiment, and observed sell-through. Preserve pre-sale theses so later outcomes can calibrate the model instead of rewriting history.

## Core principles

1. **Do not equate reprint value with opportunity.** Existing scarce foils can overstate the value of a new Secret Lair printing. Always retain both naive comparable EV and reprint-compression-adjusted EV.
2. **Cheap is not automatically bad. Obscure cheap is.** A ubiquitous low-dollar staple can support a valuable premium printing. A niche low-dollar card usually cannot.
3. **Version-of-choice matters.** Compare a new treatment to the best existing premium alternatives, not only to the cheapest printing.
4. **Supply is first-class evidence.** Fixed quantity, print-to-demand, WPN distribution, convention allocation, purchase limits, wave fulfillment, and buyer wait aversion create different market curves.
5. **Do not fake unit counts.** Store supply as unknown when unknown. Convert launch availability and time-to-sellout into observed evidence later.
6. **Separate intrinsic thesis from market confirmation.** Pre-sale scores are immutable historical snapshots. Launch and post-launch evaluations are new rows.
7. **Separate facts, signals, expert opinions, and speculation.** Speculation contributes no base EV until confirmed.
8. **Provenance must remain diggable.** Every external or expert claim must link to the release/drop/card and retain source identity.

## Interpretable scores

### Cards score

Measures the strength of the underlying card portfolio.

Primary features:
- anchor strength
- playable depth
- staple breadth
- card demand / liquidity
- current replacement value
- obscurity penalty
- reprint fatigue
- value concentration risk

### Treatment score

Measures whether this exact treatment can become desirable independent of baseline card value.

Primary features:
- art execution
- treatment uniqueness
- IP/card resonance
- readability / usability
- version-of-choice probability
- existing premium competition
- foil/treatment execution risk

### Audience score

Measures demand that exists beyond generic Magic card economics.

Primary features:
- IP/fandom heat
- artist heat
- nostalgia / cute / meme appeal
- completionist behavior
- prior collaboration performance
- adjacent branded merchandise / ecosystem

### Supply score

Measures scarcity relative to likely demand, not raw unit count unless raw unit count is known.

Primary features:
- fixed quantity vs print-to-demand
- order-window duration
- WPN/retail parallel distribution
- convention/regional allocation
- purchase limits
- fulfillment waves
- observed launch availability
- time-to-sellout
- bundle interactions
- wait-aversion premium

## Derived concepts

### Bling Gap

`desirability of the new treatment - desirability/availability of the best existing premium alternatives`

High Bling Gap examples include cards with strong play demand but no satisfying premium printing, or treatments that clearly displace unattractive prior premium options.

Low Bling Gap examples include heavily treated staples where the new art is merely another reasonable option.

### Version-of-choice probability

Estimated probability that collectors/players seeking a premium copy will disproportionately choose this version over other premium alternatives.

### Value concentration risk

Penalty when most modeled value depends on one card succeeding. Distributed playable depth offers better downside protection.

### Reprint-compression penalty

Penalty applied when existing comparable value is substantially driven by scarcity of older premium printings that the new Secret Lair is likely to compress.

## Summary scores

### Collector Score

Collector desirability of the exact product/version. Primarily driven by Treatment + Audience, with card relevance and scarcity context.

### Opportunity Score

Business attractiveness at acquisition cost. Incorporates Cards, Treatment, Audience, Supply, adjusted EV, liquidity, fee-adjusted net, and confidence.

Opportunity Score must never silently inherit a high Collector Score when economics or supply are unfavorable.

## Recommendation taxonomy

- `pot_of_gold` — rare asymmetric setup with multiple independent strengths and good downside protection
- `strong_buy`
- `buy`
- `selective_buy`
- `speculative`
- `personal_only`
- `watch`
- `pass`

Expert 1–10 review mapping is initially interpreted approximately as:
- 1–3: pass
- 4–5: pass / personal-only
- 6: speculative
- 7: selective buy
- 8: buy
- 9: strong buy
- 10: pot of gold

This mapping is a seed only and should later be calibrated against actual outcomes.

## EV horizons

Every economic evaluation should support four distinct values where data permits:

- **Naive comparable EV** — direct use of existing comparable-printing values
- **Compression-adjusted EV** — comparable EV after reprint/premium-scarcity compression assumptions
- **Early liquidity EV** — likely value during initial scarcity / first-arrival demand
- **Settled EV** — expected value after broader fulfillment and supply discovery

## Evidence classes

- `known_fact` — official contents, MSRP, sale times, distribution terms
- `observed_signal` — community reaction, repeated demand signals, artist/IP engagement
- `expert_opinion` — named/attributed reviewer thesis
- `speculation` — unconfirmed bonus cards, rumored quantities, guesses
- `market_state` — current prices, current premium alternatives, sales velocity
- `outcome` — sellout timing, actual TCG sales/prices, realized demand

Speculation is displayed but receives zero base EV until promoted by confirmation.

## Expert review ingestion

Expert reviews should retain:
- reviewer identity or stable anonymous label
- review timestamp
- release/drop mapping
- original numeric rating and scale
- verbatim review text only if private/internal rights allow; otherwise retain a concise derived summary
- structured assertions by claim dimension
- recommendation

Do not blend an expert review into anonymous community sentiment. It is an independent evidence family and can later receive calibrated source weight based on historical outcomes.

## Research queries

Research should run at multiple scopes:

1. superdrop/release
2. individual drop
3. artist/IP/treatment
4. high-impact individual cards
5. version-specific premium alternatives

Priority sources:
- official Secret Lair / Wizards
- Reddit: mtgfinance, Secret Lair communities, MagicTCG and relevant reveal threads
- YouTube finance/collector discussion
- Magic editorial/blog sources
- artist or IP posts when materially relevant

The research layer must distinguish generic card pages and price pages (background state) from actual event/sentiment evidence.

## Lifecycle

Recommended snapshots:

- T0 announcement
- T1 full reveal
- T2 24h pre-sale
- T3 launch
- T4 +15m / +30m / +60m / +2h / +6h availability observations as appropriate
- T5 sale end / sold out
- T6 shipment / first market arrivals
- T7 7d outcome
- T8 30d outcome
- T9 90d outcome
- T10 180d outcome

The original T2 pre-sale evaluation is never overwritten.

## V1 UI

Signals should expose a first-class event card:

`SECRET LAIR · PRE-SALE`

Header:
- release name
- sale timing
- overall confidence / supply confidence
- best opportunities

Drop rows:
- Opportunity Score
- Collector Score
- recommendation
- Cards / Treatment / Audience / Supply mini scores
- adjusted EV vs cost
- primary upside
- primary risk

Drill-down:
- score explanation
- every included card and premium-version comparison
- Bling Gap / version-of-choice rationale
- known facts
- expert reviews
- community findings
- speculation clearly separated
- launch/outcome timeline

## Ask contract

Collectish Ask should be able to answer:
- What should I buy from tomorrow's Superdrop?
- Which foils have the most upside?
- Ignore resale; which drop is most collectible?
- Which cards have the biggest Bling Gap?
- What does the community think of this drop?
- What changed since the pre-sale snapshot?
- Which recommendation has weakened because it did not sell out?
- What would you max out at 5 copies?

Ask responses should include recommendation, confidence, economic horizon, primary risks, and provenance.

## First forward test

Use the next live Secret Lair sale as the first forward-scored case. Freeze the pre-sale evaluation before launch, then collect launch observations and compare them later. Do not tune the pre-sale score after observing sell-through.
