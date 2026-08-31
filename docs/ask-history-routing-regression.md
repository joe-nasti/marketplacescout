# Ask price-history routing regression

Regression phrase:

`show me the foil price history for Optimus Prime, Hero BOT #13`

Expected shared resolution:

- card: Optimus Prime, Hero
- set: BOT
- collector number: 13
- finish: Foil
- SKU: 6647138

The shared lookup must also accept the copied Discord form:

`/ask question: show me the foil price history for Optimus Prime, Hero BOT #13`

Price history must be read from `ask_card_price_history_v1` for the exact resolved SKU rather than falling through to the legacy general agent.
