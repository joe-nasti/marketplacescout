# CardTrader API audit

- Auth: **OK** (app joenasti App 20211208153518)
- Response shapes: **{"info":{"type":"object","keys":["shared_secret","name","id","user_id"]},"games":{"type":"object","keys":["array"]},"categories":{"type":"array","length":27},"expansions":{"type":"array","length":3811},"blueprints":{"type":"array","length":1},"marketplace":{"type":"object","keys":["39903"]}}**
- Magic categories: **27**; sealed-like categories: **10**
- Magic expansions: **788**; sampled: **88**
- Unique sealed blueprints found in sample: **296**
- Sealed blueprints with TCGplayer ID: **48/296 (16.2%)**
- Sealed blueprints with Cardmarket ID: **265/296 (89.5%)**
- With neither external ID: **27/296 (9.1%)**
- Marketplace samples with offers: **22/40 (55%)**
- Marketplace samples with CardTrader Zero offers: **22/40 (55%)**
- Median offer count: **3**
- Median Zero offer count: **3**
- API latency p50/p95: **167 / 316 ms**
- HTTP statuses: **{"200":132}**

## Sealed categories detected

- 4: Magic Booster Boxes
- 5: Magic Boosters
- 6: Magic Complete Sets
- 7: Magic Starter Decks
- 10: Magic Extra - Box Sets & Displays
- 13: Magic Boxed Set
- 17: Magic Preconstructed Decks
- 23: Magic Bundles and Fat Packs
- 24: Magic Tournament Prerelease Packs
- 271: Magic Tins

## Marketplace samples

| Product | Expansion | TCG ID | Offers | Qty | Zero offers | Zero qty | Low cents | Zero low cents |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| WCD 1999: Matt Linde's Deck | WCD 1999: Matt Linde | 158287 | 0 | 0 | 0 | 0 |  |  |
| Ultimate Masters Booster Box | Ultimate Masters | 179444 | 3 | 6 | 2 | 5 | 41935 | 41935 |
| Zendikar Rising Theme Booster Box | Zendikar Rising | 220420 | 2 | 4 | 2 | 4 | 10542 | 10542 |
| Adventures in the Forgotten Realms Fat Pack Bundle | D&D: Adventures in the Forgotten Realms | 238732 | 0 | 0 | 0 | 0 |  |  |
| Murders at Karlov Manor Play Booster | Murders at Karlov Manor | 529962 | 33 | 801 | 32 | 793 | 459 | 459 |
| Star Trek Collector Booster Box | Star Trek | 706142 | 12 | 57 | 12 | 57 | 57542 | 57542 |
| Reality Fracture / Fat Pack Bundle Case | Reality Fracture | 692986 | 3 | 6 | 3 | 6 | 45596 | 45596 |
| The Dark Booster | The Dark |  | 7 | 37 | 7 | 37 | 11196 | 11196 |
| Legends Italian Uncommon Set | Legends Italian |  | 0 | 0 | 0 | 0 |  |  |
| Apocalypse: Swoop Theme Deck | Apocalypse |  | 0 | 0 | 0 | 0 |  |  |
| Fifth Dawn Booster | Fifth Dawn |  | 10 | 89 | 10 | 89 | 2644 | 2644 |
| Fifth Dawn Uncommon Set | Fifth Dawn |  | 0 | 0 | 0 | 0 |  |  |
| Dissension: Simic Mutology Theme Deck | Dissension |  | 0 | 0 | 0 | 0 |  |  |
| Premium Deck Series: Fire & Lightning | Premium Deck Series: Fire and Lightning |  | 0 | 0 | 0 | 0 |  |  |
| Modern Master Complete Set | Modern Masters |  | 1 | 1 | 1 | 1 | 52276 | 52276 |
| Shadows over Innistrad Basic Land Set | Shadows Over Innistrad |  | 0 | 0 | 0 | 0 |  |  |
| Shadows over Innistrad: "Ghostly Tide" Intro Pack | Shadows Over Innistrad |  | 1 | 2 | 1 | 2 | 2323 | 2323 |
| Shadows over Innistrad Intro Pack Set | Shadows Over Innistrad |  | 0 | 0 | 0 | 0 |  |  |
| From the Vault: Transform Complete Set | From the Vault: Transform |  | 0 | 0 | 0 | 0 |  |  |
| Ultimate Masters Rare Set | Ultimate Masters |  | 0 | 0 | 0 | 0 |  |  |
| Challenger Deck 2018: Second Sun Control | Challenger Decks |  | 6 | 14 | 6 | 14 | 2639 | 2639 |
| Challenger Deck 2018 Set | Challenger Decks |  | 1 | 1 | 1 | 1 | 13163 | 13163 |
| Core 2021 Booster | Core Set 2021 |  | 8 | 147 | 7 | 143 | 405 | 405 |
| Zendikar Rising Theme Booster | Zendikar Rising |  | 5 | 8 | 5 | 8 | 800 | 800 |
| Zendikar Rising: Uncommon Set | Zendikar Rising |  | 0 | 0 | 0 | 0 |  |  |
| Core 2021: Uncommon Set | Core Set 2021 |  | 0 | 0 | 0 | 0 |  |  |
| Kaldheim Collector Booster | Kaldheim |  | 2 | 11 | 2 | 11 | 3582 | 3582 |
| Kaldheim "Viking" Theme Booster | Kaldheim |  | 1 | 1 | 1 | 1 | 1658 | 1658 |
| Kaldheim: Prerelease Pack | Kaldheim |  | 2 | 5 | 2 | 5 | 3845 | 3845 |
| Adventures in the Forgotten Realms Set Booster | D&D: Adventures in the Forgotten Realms |  | 4 | 72 | 4 | 72 | 1320 | 1320 |
| Adventures in the Forgotten Realms Theme Booster | D&D: Adventures in the Forgotten Realms |  | 0 | 0 | 0 | 0 |  |  |
| Adventures in the Forgotten Realms: Mythic Set | D&D: Adventures in the Forgotten Realms |  | 0 | 0 | 0 | 0 |  |  |
| Gift Pack | Magic the Gathering Products |  | 1 | 4 | 1 | 4 | 2650 | 2650 |
| Challenger Decks 2022: Rakdos Vampires | Challenger Decks |  | 0 | 0 | 0 | 0 |  |  |
| Pioneer Challenger Decks 2022: Izzet Phoenix | Challenger Decks |  | 0 | 0 | 0 | 0 |  |  |
| The Lord of the Rings: "Elven Council" Deluxe Commander Kit | Commander: The Lord of the Rings Promos |  | 0 | 0 | 0 | 0 |  |  |
| Reality Fracture Fat Pack Bundle | Reality Fracture |  | 12 | 90 | 12 | 90 | 6174 | 6174 |
| Star Trek / "Federation Fleet" Commander Deck | Commander: Star Trek |  | 5 | 31 | 5 | 31 | 9762 | 9762 |
| Secret Lair Commander Deck: Hatsune Miku | Secret Lair Commander Deck: Hatsune Miku |  | 4 | 4 | 4 | 4 | 44557 | 44557 |
| Star Trek Scene Box Set | Star Trek |  | 3 | 9 | 3 | 9 | 13075 | 13075 |
